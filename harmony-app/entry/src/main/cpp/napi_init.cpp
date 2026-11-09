#include <napi/native_api.h>
#include <hilog/log.h>

#include <dlfcn.h>
#include <pthread.h>
#include <signal.h>
#include <ucontext.h>
#include <filesystem>
#include <sys/stat.h>
#include <unistd.h>
#include <fcntl.h>

#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <mutex>

#undef LOG_DOMAIN
#undef LOG_TAG
#define LOG_DOMAIN 0x3200
#define LOG_TAG "DSHNode"

using NodeStartFn = int (*)(int, char **);

namespace {
void *g_node = nullptr;
NodeStartFn g_start = nullptr;
pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
std::mutex g_url_mutex;
std::string g_web_url;

struct StartContext {
    std::string root;
    int port;
};

/**
 * Seccomp 把被拦截的 syscall 配成 SECCOMP_RET_TRAP 时会发 SIGSYS。
 * libuv 会无条件探测 io_uring_setup(425)，OHOS 沙箱会 trap 它。
 * 处理器跳过触发指令并把返回值置为“正好 -1”，libuv 才会回退到 epoll。
 */
void OnSigSys(int sig, siginfo_t *info, void *context) {
    (void)sig;
    int nr = info == nullptr ? -1 : info->si_syscall;
    struct ucontext *uc = static_cast<struct ucontext *>(context);
    OH_LOG_ERROR(LOG_APP, "SIGSYS syscall=%{public}d pc=%{public}p call=%{public}p",
                 nr,
                 uc == nullptr ? nullptr : reinterpret_cast<void *>(uc->uc_mcontext.pc),
                 info == nullptr ? nullptr : info->si_call_addr);
    if (uc != nullptr) {
        /* OpenHarmony 的 libuv 守卫只认“正好 -1”，不能返回 -ENOSYS。
           aarch64: 跳过触发 seccomp 的 svc 指令（固定 4 字节），把 x0 设为 -1。 */
        uc->uc_mcontext.pc += 4;
        errno = ENOSYS;
        uc->uc_mcontext.regs[0] = static_cast<unsigned long>(-1);
    }
}

void HandleNodeLine(const std::string &line) {
    if (line.empty()) return;
    const bool interesting =
        line.find("cloud-github") != std::string::npos ||
        line.find("dsh web:") != std::string::npos ||
        line.find("MODULE_NOT_FOUND") != std::string::npos ||
        line.find("SyntaxError") != std::string::npos ||
        line.find("TypeError") != std::string::npos ||
        line.find("Unhandled") != std::string::npos ||
        line.find("FATAL") != std::string::npos ||
        line.find("Error:") != std::string::npos ||
        line.find("ERR_") != std::string::npos;
    if (interesting) OH_LOG_INFO(LOG_APP, "node output: %{public}s", line.c_str());
    const std::string marker = "dsh web: ";
    size_t at = line.find(marker);
    if (at != std::string::npos) {
        size_t http = line.find("http", at);
        if (http != std::string::npos) {
            std::string url = line.substr(http);
            while (!url.empty() && (url.back() == '\r' || url.back() == ' ')) url.pop_back();
            std::lock_guard<std::mutex> lock(g_url_mutex);
            g_web_url = url;
            OH_LOG_INFO(LOG_APP, "web url captured");
        }
    }
}

void *NodeLogPump(void *raw) {
    int fd = static_cast<int>(reinterpret_cast<intptr_t>(raw));
    char buf[1024];
    std::string pending;
    while (true) {
        ssize_t n = read(fd, buf, sizeof(buf));
        if (n <= 0) break;
        pending.append(buf, static_cast<size_t>(n));
        size_t pos = 0;
        while ((pos = pending.find('\n')) != std::string::npos) {
            std::string line = pending.substr(0, pos);
            pending.erase(0, pos + 1);
            HandleNodeLine(line);
        }
        if (pending.size() > 8192) {
            HandleNodeLine(pending);
            pending.clear();
        }
    }
    if (!pending.empty()) HandleNodeLine(pending);
    close(fd);
    return nullptr;
}

napi_value GetWebUrl(napi_env env, napi_callback_info info) {
    (void)info;
    std::lock_guard<std::mutex> lock(g_url_mutex);
    napi_value result = nullptr;
    napi_create_string_utf8(env, g_web_url.c_str(), NAPI_AUTO_LENGTH, &result);
    return result;
}
void EnsureStandardFds() {
    int in = open("/dev/null", O_RDONLY);
    if (in >= 0) {
        if (in != STDIN_FILENO) {
            dup2(in, STDIN_FILENO);
            close(in);
        }
    }
    int out = open("/dev/null", O_WRONLY);
    if (out >= 0) {
        if (out != STDOUT_FILENO) dup2(out, STDOUT_FILENO);
        if (out != STDERR_FILENO) dup2(out, STDERR_FILENO);
        if (out > STDERR_FILENO) close(out);
    }
}

bool WriteCloudGithubPatch(const std::string &root) {
    std::string patch = root + "/cloud-github.patch.yml";
    std::string plugin = root + "/lib/node_modules/cloud-github.mjs";
    std::string settings = root + "/cloud-github.json";
    FILE *f = fopen(patch.c_str(), "w");
    if (f == nullptr) {
        OH_LOG_ERROR(LOG_APP, "cannot write %{public}s: %{public}s", patch.c_str(), strerror(errno));
        return false;
    }
    fprintf(f, "- insert:\n    - id: cloud-github\n      name: 'file://%s'\n      config:\n        settingsPath: '%s'\n        profileDir: '%s/home/profiles/web'\n",
            plugin.c_str(), settings.c_str(), root.c_str());
    const char *localRows[] = {
        "tool-fs", "tool-fs-search", "tool-bash", "tool-pwsh", "tool-jobs", "tool-plugin-manager",
    };
    for (const char *row : localRows) {
        fprintf(f, "- id: %s\n  disabled: true\n", row);
    }
    fclose(f);
    OH_LOG_INFO(LOG_APP, "cloud-github patch written: %{public}s", patch.c_str());
    return true;
}
void *NodeThread(void *raw) {
    StartContext *ctx = static_cast<StartContext *>(raw);
    if (ctx == nullptr) return nullptr;

    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_sigaction = OnSigSys;
    sa.sa_flags = SA_SIGINFO | SA_RESTART;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGSYS, &sa, nullptr);

    setenv("UV_USE_IO_URING", "0", 1);
    setenv("NODE_OPTIONS", "--no-warnings", 1);

    std::string home = ctx->root + "/home";
    std::error_code ec;
    std::filesystem::create_directories(home, ec);
    setenv("HOME", home.c_str(), 1);
    setenv("DSH_HOME", home.c_str(), 1);

    std::string path = ctx->root + "/bin:/system/bin:/system/bin";
    setenv("PATH", path.c_str(), 1);
    std::string libPath = ctx->root + "/lib";
    setenv("LD_LIBRARY_PATH", libPath.c_str(), 1);

    OH_LOG_INFO(LOG_APP, "entry exists=%{public}d root=%{public}s", access((ctx->root + "/lib/node_modules/@deepseek-ai/dsh/lib/bin.js").c_str(), R_OK), ctx->root.c_str());
    {
        struct stat st;
        if (fstat(STDIN_FILENO, &st) == 0) {
            OH_LOG_INFO(LOG_APP, "stdin before: mode=%{public}o rdev=%{public}llu",
                        st.st_mode, static_cast<unsigned long long>(st.st_rdev));
        } else {
            OH_LOG_WARN(LOG_APP, "stdin before: fstat failed: %{public}s", strerror(errno));
        }
        char link[256] = {0};
        ssize_t n = readlink("/proc/self/fd/0", link, sizeof(link) - 1);
        OH_LOG_INFO(LOG_APP, "stdin link: %{public}s", n > 0 ? link : "(none)");
    }

    EnsureStandardFds();

    int log_pipe[2] = {-1, -1};
    if (pipe(log_pipe) == 0) {
        OH_LOG_INFO(LOG_APP, "log pipe fds=%{public}d/%{public}d", log_pipe[0], log_pipe[1]);
        dup2(log_pipe[1], STDOUT_FILENO);
        dup2(log_pipe[1], STDERR_FILENO);
        if (log_pipe[1] > STDERR_FILENO) close(log_pipe[1]);
        pthread_t log_thread;
        if (pthread_create(&log_thread, nullptr, NodeLogPump,
                           reinterpret_cast<void *>(static_cast<intptr_t>(log_pipe[0]))) == 0) {
            pthread_detach(log_thread);
        }
    } else {
        OH_LOG_WARN(LOG_APP, "pipe failed: %{public}s", strerror(errno));
    }
    if (chdir(home.c_str()) != 0) {
        OH_LOG_WARN(LOG_APP, "chdir(%{public}s) failed: %{public}s", home.c_str(), strerror(errno));
    }

    WriteCloudGithubPatch(ctx->root);
    std::vector<std::string> args = {
        "node",
        "--expose-internals",
        "--no-verify-heap",
        ctx->root + "/bootstrap.cjs",
        ctx->root + "/runtime-js.tar.gz",
        ctx->root,
        ctx->root + "/lib/node_modules/@deepseek-ai/dsh/lib/bin.js",
        std::to_string(ctx->port),
    };

    std::vector<char *> argv;
    argv.reserve(args.size() + 1);
    for (std::string &arg : args) argv.push_back(const_cast<char *>(arg.c_str()));
    argv.push_back(nullptr);

    OH_LOG_INFO(LOG_APP, "calling node::Start on detached thread, root=%{public}s", ctx->root.c_str());
    int rc = g_start(static_cast<int>(args.size()), argv.data());
    OH_LOG_INFO(LOG_APP, "node::Start returned %{public}d", rc);

    delete ctx;
    return nullptr;
}

napi_value StartNode(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2] = {nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc < 1 || argv[0] == nullptr) return nullptr;

    char root[4096] = {0};
    size_t rootLen = 0;
    if (napi_get_value_string_utf8(env, argv[0], root, sizeof(root), &rootLen) != napi_ok) {
        return nullptr;
    }

    int32_t port = 3080;
    if (argc > 1 && argv[1] != nullptr) {
        napi_get_value_int32(env, argv[1], &port);
    }

    std::string bootstrap = std::string(root) + "/bootstrap.cjs";
    if (access(bootstrap.c_str(), R_OK) != 0) {
        OH_LOG_ERROR(LOG_APP, "bootstrap missing: %{public}s", bootstrap.c_str());
        napi_value missing = nullptr;
        napi_get_boolean(env, false, &missing);
        return missing;
    }

    napi_value result = nullptr;
    pthread_mutex_lock(&g_lock);
    /* libuv may create its global signal pipe in a library constructor at
       dlopen time. Ensure fd 0/1/2 are valid *before* dlopen, otherwise that
       pipe can land on fd 1/2 and later be clobbered by the log pipe. */
    EnsureStandardFds();
    /* libuv may read this at library load; set before dlopen. */
    setenv("UV_USE_IO_URING", "0", 1);
    if (g_start == nullptr) {
        g_node = dlopen("libnode.so", RTLD_NOW | RTLD_GLOBAL);
        if (g_node == nullptr) {
            OH_LOG_ERROR(LOG_APP, "dlopen(libnode.so) failed: %{public}s", dlerror());
            pthread_mutex_unlock(&g_lock);
            napi_get_boolean(env, false, &result);
            return result;
        }
        g_start = reinterpret_cast<NodeStartFn>(dlsym(g_node, "_ZN4node5StartEiPPc"));
        if (g_start == nullptr) {
            g_start = reinterpret_cast<NodeStartFn>(dlsym(g_node, "node::Start"));
        }
        if (g_start == nullptr) {
            OH_LOG_ERROR(LOG_APP, "dlsym(node::Start) failed: %{public}s", dlerror());
            pthread_mutex_unlock(&g_lock);
            napi_get_boolean(env, false, &result);
            return result;
        }
    }

    auto *ctx = new StartContext{std::string(root), static_cast<int>(port)};
    pthread_t tid;
    if (pthread_create(&tid, nullptr, NodeThread, ctx) != 0) {
        delete ctx;
        pthread_mutex_unlock(&g_lock);
        napi_get_boolean(env, false, &result);
        return result;
    }
    pthread_detach(tid);
    pthread_mutex_unlock(&g_lock);

    napi_get_boolean(env, true, &result);
    return result;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor desc[] = {
        {"startNode", nullptr, StartNode, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"getWebUrl", nullptr, GetWebUrl, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
    return exports;
}

napi_module g_module = {
    1,
    0,
    nullptr,
    Init,
    "entry",
    nullptr,
    {0},
};
}  // namespace

extern "C" __attribute__((constructor)) void RegisterEntryModule(void) {
    napi_module_register(&g_module);
}

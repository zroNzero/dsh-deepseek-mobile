#define _GNU_SOURCE

#include <napi/native_api.h>
#include <hilog/log.h>

#include <dlfcn.h>
#include <pthread.h>
#include <signal.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#undef LOG_DOMAIN
#undef LOG_TAG
#define LOG_DOMAIN 0x3200
#define LOG_TAG "DSHNode"

using NodeStartFn = int (*)(int, char **);

namespace {
void *g_node = nullptr;
NodeStartFn g_start = nullptr;
pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;

struct StartContext {
    std::string root;
    int port;
};

/**
 * Seccomp 把被拦截的 syscall 配成 SECCOMP_RET_TRAP 时会发 SIGSYS。
 * 本工程通过 UV_USE_IO_URING=0 避免最常见的 io_uring 触发点；这里安装
 * SIGSYS 处理器，至少把 syscall 上下文写进 hilog，避免无声崩溃。
 *
 * 注意：不同 OHOS libc 的 ucontext 布局不同，不能安全地改写 PC 后继续执行；
 * 如果真走到这里，说明 libnode.so 内部仍有被容器禁止的 syscall。
 */
void OnSigSys(int sig, siginfo_t *info, void *context) {
    (void)sig;
    (void)info;
    (void)context;
    OH_LOG_ERROR(LOG_APP, "SIGSYS captured: a syscall was blocked by seccomp");
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
    mkdir(home.c_str(), 0700);
    setenv("HOME", home.c_str(), 1);
    setenv("DSH_HOME", home.c_str(), 1);

    std::string path = ctx->root + "/bin:/system/bin:/system/bin";
    setenv("PATH", path.c_str(), 1);
    std::string libPath = ctx->root + "/lib";
    setenv("LD_LIBRARY_PATH", libPath.c_str(), 1);

    if (chdir(home.c_str()) != 0) {
        OH_LOG_WARN(LOG_APP, "chdir(%{public}s) failed: %{public}s", home.c_str(), strerror(errno));
    }

    std::vector<std::string> args = {
        "node",
        "--expose-internals",
        ctx->root + "/lib/node_modules/@deepseek-ai/dsh/lib/bin.js",
        "web",
        "--no-open",
        "--port",
        std::to_string(ctx->port),
    };

    std::string overlay = ctx->root + "/android-overlay.yml";
    if (access(overlay.c_str(), R_OK) == 0) {
        args.push_back("--patch");
        args.push_back(overlay);
    }

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

    napi_value result = nullptr;
    pthread_mutex_lock(&g_lock);
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

/*
 * dsh_pty.c — DSH Kxxy 原生 PTY 层
 *
 * 为什么自研而不用 flutter_pty / node-pty：
 *   参考项目与 flutter_pty 都缺三样东西，缺任何一样都会导致引擎在生产环境
 *   反复重启或变孤儿。本文件把它们一次补齐（记为 G1/G2/G3）。
 *
 *   G1 关闭继承的 fd
 *       App 进程里的 java.net.ServerSocket（设备桥）**不带 O_CLOEXEC**
 *       （实测 fdinfo flags: 04002 = O_RDWR|O_NONBLOCK）。fork 后引擎会带着
 *       这块监听 socket 一起跑，父进程死后孤儿仍占着端口，新桥 bind 失败
 *       EADDRINUSE。参考项目记录用户实测「62 次仍在增长」。
 *       刻意不用 close_range(2)：需 Linux 5.9+，Android 内核版本跨度过大。
 *
 *   G2 父进程死亡信号
 *       prctl(PR_SET_PDEATHSIG, SIGTERM) 让子进程随父进程退出。
 *       选 SIGTERM 而非 SIGKILL，给引擎收尾机会。
 *       并处理「prctl 生效前父进程已死」的竞态：getppid() == 1 时立即退出。
 *
 *   G3 环境变量完整替换
 *       execve(cmd, argv, envp) 而非 putenv()+execvp()。
 *       后者是「继承 + 覆盖」，引擎会带上宿主 App 的全部环境变量。
 *       参考项目刻意用完整替换数组，PATH 首位放 engine/bin 以遮蔽系统命令。
 *
 * 另外：execve 不搜索 PATH —— executable 必须是绝对路径，
 * 否则子进程已 chdir 到工作区，会按相对路径解析并报 ENOENT / exit 127。
 */

#include <jni.h>
#include <android/log.h>

#include <errno.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <pthread.h>
#include <dirent.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/wait.h>
#include <termios.h>

#define LOG_TAG "DshPty"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

/* ── G1：关闭所有继承的 fd ────────────────────────────────────────────────
 *
 * 遍历 /proc/self/fd 关闭除 0/1/2 之外的每一个 fd。
 *
 * ⚠️ 必须保留 [preserve] 指定的 fd —— 那是 PTY 从设备，它在 fork 之前就已打开
 * （先开 slave 再 fork 是标准做法，避免子进程里做更多可能失败的工作）。
 * 若把它一并关掉，后续 ioctl(TIOCSCTTY) 与 dup2 都会失败。
 *
 * 同时跳过遍历用的目录 fd 自身。
 *
 * 刻意不用 close_range(2)：需 Linux 5.9+，而 Android 内核版本跨度过大
 * （minSdk 26 覆盖到 Android 8.0）。
 */
static void close_inherited_fds(int preserve)
{
    DIR *dir = opendir("/proc/self/fd");
    if (dir == NULL) {
        LOGE("close_inherited_fds: opendir failed: %s", strerror(errno));
        return;
    }

    /* 注意变量名不要叫 dirfd —— 那是 <dirent.h> 里的函数名，会遮蔽声明 */
    int scan_fd = dirfd(dir);
    struct dirent *entry;

    while ((entry = readdir(dir)) != NULL) {
        if (entry->d_name[0] == '.') continue;

        char *end = NULL;
        long fd = strtol(entry->d_name, &end, 10);
        if (end == entry->d_name || *end != '\0') continue;

        /* 保留标准三件套 */
        if (fd <= STDERR_FILENO) continue;
        /* 保留 PTY 从设备 */
        if (fd == preserve) continue;
        /* 保留遍历目录 fd 自身 */
        if (fd == scan_fd) continue;

        /* 静默关闭：失败也不影响主流程 */
        close((int)fd);
    }

    closedir(dir);
}

/* ── 启动一个 PTY 子进程 ─────────────────────────────────────────────────
 *
 * 返回 master fd（>= 0 成功），并把子进程 pid 写入 *out_pid。
 * 失败返回负 errno。
 *
 * argv / envp 都是 NULL 结尾的字符串数组，由 Dart 侧构造。
 * executable 必须绝对路径（execve 不搜 PATH）。
 */
/**
 * `fork()` 被容器拒绝时的备用进程创建路径。
 *
 * 卓易通/鸿蒙容器会把 `fork()`（bionic 的 clone 封装）直接拒绝成 EACCES，
 * 此时 execve 根本没有机会执行。posix_spawn 走 bionic 的另一条
 * `clone(CLONE_VM|CLONE_VFORK)` + execve 路径，部分容器的 seccomp 过滤器
 * 只拦 fork 的系统调用形态，因此这里作为最后兜底。
 *
 * 限制：posix_spawn 的 file_actions 无法做 setsid/TIOCSCTTY，所以子进程没有
 * 控制终端；PTY 的 stdin/stdout/stderr 仍然可用，Node 不依赖控制终端。
 * cwd 用父进程临时 fchdir 的方式传递，spawn 后立即恢复。
 *
 * 返回值：0 成功；负 errno 失败。
 */
typedef struct { unsigned long long opaque[64]; } kxxy_ps_fa;
typedef struct { unsigned long long opaque[16]; } kxxy_ps_attr;

typedef int (*kxxy_ps_spawn_fn)(pid_t *, const char *, const kxxy_ps_fa *,
                                const kxxy_ps_attr *, char *const[], char *const[]);
typedef int (*kxxy_ps_fa_init_fn)(kxxy_ps_fa *);
typedef int (*kxxy_ps_fa_destroy_fn)(kxxy_ps_fa *);
typedef int (*kxxy_ps_fa_adddup2_fn)(kxxy_ps_fa *, int, int);
typedef int (*kxxy_ps_fa_addclose_fn)(kxxy_ps_fa *, int);
typedef int (*kxxy_ps_attr_init_fn)(kxxy_ps_attr *);
typedef int (*kxxy_ps_attr_destroy_fn)(kxxy_ps_attr *);
typedef int (*kxxy_ps_attr_setflags_fn)(kxxy_ps_attr *, short);

/*
 * fork() 被容器拒绝时的备用进程创建路径。
 *
 * 卓易通/鸿蒙容器会把 fork()（bionic 的 clone 封装）直接拒绝成 EACCES，
 * execve 根本没有机会执行。posix_spawn 走 bionic 的另一条
 * clone(CLONE_VM|CLONE_VFORK) + execve 路径，部分容器的 seccomp 过滤器只拦
 * fork 的系统调用形态，因此这里作为最后兜底。
 *
 * 这些符号在 targetSdk 26 的头文件里被 __INTRODUCED_IN 隐藏，但设备实际是
 * API 36，所以用 dlsym 解析；解析不到就返回 -ENOSYS，不影响老设备。
 */
static int spawn_via_posix_spawn(const char *executable,
                                 char *const argv[],
                                 char *const envp[],
                                 int master,
                                 int slave,
                                 const char *cwd,
                                 pid_t *pid_out)
{
    kxxy_ps_spawn_fn p_spawn = (kxxy_ps_spawn_fn)dlsym(RTLD_DEFAULT, "posix_spawn");
    kxxy_ps_fa_init_fn p_fa_init =
        (kxxy_ps_fa_init_fn)dlsym(RTLD_DEFAULT, "posix_spawn_file_actions_init");
    kxxy_ps_fa_destroy_fn p_fa_destroy =
        (kxxy_ps_fa_destroy_fn)dlsym(RTLD_DEFAULT, "posix_spawn_file_actions_destroy");
    kxxy_ps_fa_adddup2_fn p_fa_dup2 =
        (kxxy_ps_fa_adddup2_fn)dlsym(RTLD_DEFAULT, "posix_spawn_file_actions_adddup2");
    kxxy_ps_fa_addclose_fn p_fa_close =
        (kxxy_ps_fa_addclose_fn)dlsym(RTLD_DEFAULT, "posix_spawn_file_actions_addclose");
    kxxy_ps_attr_init_fn p_attr_init =
        (kxxy_ps_attr_init_fn)dlsym(RTLD_DEFAULT, "posix_spawnattr_init");
    kxxy_ps_attr_destroy_fn p_attr_destroy =
        (kxxy_ps_attr_destroy_fn)dlsym(RTLD_DEFAULT, "posix_spawnattr_destroy");
    kxxy_ps_attr_setflags_fn p_attr_setflags =
        (kxxy_ps_attr_setflags_fn)dlsym(RTLD_DEFAULT, "posix_spawnattr_setflags");

    if (p_spawn == NULL || p_fa_init == NULL || p_fa_destroy == NULL ||
        p_fa_dup2 == NULL || p_fa_close == NULL || p_attr_init == NULL ||
        p_attr_destroy == NULL || p_attr_setflags == NULL) {
        LOGE("posix_spawn symbols unavailable (API < 28?)");
        return -ENOSYS;
    }

    kxxy_ps_fa actions;
    kxxy_ps_attr attr;
    memset(&actions, 0, sizeof(actions));
    memset(&attr, 0, sizeof(attr));

    int rc = p_fa_init(&actions);
    if (rc != 0) return -rc;
    rc = p_attr_init(&attr);
    if (rc != 0) {
        p_fa_destroy(&actions);
        return -rc;
    }

    /* bionic 的 POSIX_SPAWN_CLOEXEC_DEFAULT；目标设备 API 36 支持 */
    p_attr_setflags(&attr, 0x4000);

    p_fa_dup2(&actions, slave, STDIN_FILENO);
    p_fa_dup2(&actions, slave, STDOUT_FILENO);
    p_fa_dup2(&actions, slave, STDERR_FILENO);
    p_fa_close(&actions, master);
    if (slave > STDERR_FILENO) {
        p_fa_close(&actions, slave);
    }

    int saved_cwd = -1;
    if (cwd != NULL && cwd[0] != '\0') {
        saved_cwd = open(".", O_RDONLY | O_DIRECTORY);
        if (saved_cwd >= 0 && chdir(cwd) != 0) {
            LOGE("posix_spawn: chdir(%s) failed: %s", cwd, strerror(errno));
            close(saved_cwd);
            saved_cwd = -1;
        }
    }

    rc = p_spawn(pid_out, executable, &actions, &attr, argv, envp);

    if (saved_cwd >= 0) {
        if (fchdir(saved_cwd) != 0) {
            LOGE("posix_spawn: restore cwd failed: %s", strerror(errno));
        }
        close(saved_cwd);
    }

    p_fa_destroy(&actions);
    p_attr_destroy(&attr);
    return rc == 0 ? 0 : -rc;
}

int dsh_forkpty(const char *executable,
                char *const argv[],
                char *const envp[],
                const char *cwd,
                int rows,
                int cols,
                int *out_pid)
{
    int master = -1;
    int slave = -1;
    char *slave_name = NULL;

    /* 1. 打开 PTY 主设备 */
    master = open("/dev/ptmx", O_RDWR | O_NOCTTY);
    if (master < 0) {
        LOGE("open /dev/ptmx failed: %s", strerror(errno));
        return -errno;
    }

    /* master 自身设 CLOEXEC，避免被 execve 继承 */
    fcntl(master, F_SETFD, FD_CLOEXEC);

    /* 2. 授权 + 解锁 + 取从设备名 */
    if (grantpt(master) != 0 || unlockpt(master) != 0) {
        LOGE("grantpt/unlockpt failed: %s", strerror(errno));
        int e = errno;
        close(master);
        return -e;
    }

    slave_name = ptsname(master);
    if (slave_name == NULL) {
        LOGE("ptsname failed: %s", strerror(errno));
        int e = errno;
        close(master);
        return -e;
    }

    /* 3. 打开从设备（先于 fork，避免子进程里做更多工作） */
    slave = open(slave_name, O_RDWR | O_NOCTTY);
    if (slave < 0) {
        LOGE("open %s failed: %s", slave_name, strerror(errno));
        int e = errno;
        close(master);
        return -e;
    }

    /* 4. fork 前预设窗口尺寸
     *
     * 这一步不能省：若留到 fork 之后，node-pty 在首次 resize 之前会读到
     * 0x0 尺寸，某些 CLI 会因此错判终端能力。
     */
    struct winsize ws;
    memset(&ws, 0, sizeof(ws));
    ws.ws_row = (unsigned short)(rows > 0 ? rows : 40);
    ws.ws_col = (unsigned short)(cols > 0 ? cols : 120);
    ioctl(slave, TIOCSWINSZ, &ws);

    pid_t pid = fork();
    if (pid < 0) {
        int e = errno;
        LOGE("fork failed: %s", strerror(e));

        /*
         * 鸿蒙卓易通实测：fork() 直接返回 EACCES（errno=13），execve 尚未执行。
         * 先尝试 posix_spawn 的另一条 clone 路径；成功时 PTY 仍然可用。
         */
        if (e == EACCES || e == EPERM) {
            pid_t spawned = 0;
            int rc = spawn_via_posix_spawn(
                executable, argv, envp, master, slave, cwd, &spawned);
            if (rc == 0) {
                close(slave);
                *out_pid = (int)spawned;
                LOGI("fork denied (errno=%d); posix_spawn fallback ok pid=%d", e, (int)spawned);
                return master;
            }
            LOGE("posix_spawn fallback failed: %s (rc=%d)", strerror(-rc), rc);
        }

        close(slave);
        close(master);
        return -e;
    }

    if (pid == 0) {
        /* ── 子进程 ─────────────────────────────────────────────── */

        /* 脱离控制终端，成为新会话首进程 */
        setsid();

        /* G1：关掉所有继承的 fd
         *
         * 必须在 dup2(slave) 之前做，因为 slave 此刻还在原 fd 号上，
         * 关闭后再 dup2 才能保证 0/1/2 指向它。
         * 顺序上也要在 setsid 之后：setsid 不依赖任何 fd。
         *
         * preserve = slave：PTY 从设备在 fork 前就打开了，必须保留。
         */
        close_inherited_fds(slave);

        /* 让 PTY 成为控制终端 */
        if (ioctl(slave, TIOCSCTTY, (char *)NULL) == -1) {
            LOGE("TIOCSCTTY failed: %s", strerror(errno));
            _exit(126);
        }

        /* 标准三件套接到 slave */
        if (dup2(slave, STDIN_FILENO) < 0 ||
            dup2(slave, STDOUT_FILENO) < 0 ||
            dup2(slave, STDERR_FILENO) < 0) {
            _exit(126);
        }

        if (slave > STDERR_FILENO) close(slave);

        /* G2：父进程死亡信号
         *
         * 注意竞态：若父进程在本行之前就已死亡，PR_SET_PDEATHSIG 不会生效
         * （信号发给的是调用时刻的父进程）。所以紧接着检查 getppid()。
         */
        if (prctl(PR_SET_PDEATHSIG, SIGTERM) == -1) {
            LOGE("prctl(PR_SET_PDEATHSIG) failed: %s", strerror(errno));
        }
        if (getppid() == 1) {
            /* 父进程已不在，直接退出 */
            _exit(0);
        }

        /* 切到工作目录 */
        if (cwd != NULL && cwd[0] != '\0') {
            if (chdir(cwd) != 0) {
                LOGE("chdir(%s) failed: %s", cwd, strerror(errno));
            }
        }

        /* G3：完整替换环境后 execve（不搜索 PATH，executable 必须绝对路径） */
        execve(executable, argv, envp);

        /* 走到这里说明 execve 失败 */
        LOGE("execve(%s) failed: %s", executable, strerror(errno));
        _exit(127);
    }

    /* ── 父进程 ─────────────────────────────────────────────────── */
    close(slave);

    *out_pid = (int)pid;
    return master;
}

/* ── PTY 尺寸调整 ──────────────────────────────────────────────────────── */
int dsh_resize(int master, int rows, int cols)
{
    struct winsize ws;
    memset(&ws, 0, sizeof(ws));
    ws.ws_row = (unsigned short)rows;
    ws.ws_col = (unsigned short)cols;
    return ioctl(master, TIOCSWINSZ, &ws);
}

/* ── 写入 PTY ──────────────────────────────────────────────────────────── */
int dsh_write(int master, const char *data, int length)
{
    ssize_t n = write(master, data, (size_t)length);
    return (int)n;
}

/* ── 关闭 master fd ────────────────────────────────────────────────────── */
void dsh_close(int master)
{
    if (master >= 0) close(master);
}

/* ── 等待子进程退出，返回原始 wait status ──────────────────────────────── */
int dsh_waitpid(int pid)
{
    int status = 0;
    waitpid((pid_t)pid, &status, 0);
    return status;
}

/* ── 向子进程发信号 ────────────────────────────────────────────────────── */
int dsh_kill(int pid, int sig)
{
    return kill((pid_t)pid, sig);
}

/* ── 探测子进程是否仍存活（不回收） ────────────────────────────────────── */
int dsh_alive(int pid)
{
    if (kill((pid_t)pid, 0) == 0) return 1;
    return (errno == EPERM) ? 1 : 0;
}

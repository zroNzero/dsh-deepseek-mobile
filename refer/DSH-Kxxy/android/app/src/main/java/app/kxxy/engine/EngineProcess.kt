package app.kxxy.engine

import android.content.Context
import android.os.Build
import android.system.Os
import android.util.Log
import app.kxxy.pty.PtyBridge
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileDescriptor
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 引擎进程句柄：PTY 启动、日志泵、优雅停止。
 *
 * 与参考项目的对应关系：本文件合并了其 `EngineProcess.kt`（166 行）与
 * `Pty.kt`（29 行），因为方案 T 下 PTY 的 JNI 声明已独立在
 * `app.kxxy.pty.PtyBridge`，此处只保留进程生命周期管理。
 */
class EngineProcess private constructor(
    private val masterFd: Int,
    val pid: Int,
    private val logFile: File,
) {

    /** 子进程退出时完成；值为**原始 wait status**（用 [PtyBridge.describe] 解码）。 */
    val exitStatus = CompletableDeferred<Int>()

    private val stopped = AtomicBoolean(false)

    @Volatile
    private var pumpThread: Thread? = null

    @Volatile
    private var waitThread: Thread? = null

    companion object {
        private const val TAG = "KxxyEngine"
        private const val READ_BUFFER = 4096

        /** 卓易通/鸿蒙容器里 zip 解出的文件可能丢执行位，启动前强制 0755。 */
        private fun forceMode755(file: File) {
            if (!file.isFile) return
            runCatching { Os.chmod(file.absolutePath, 493) }
                .onFailure { Log.w(TAG, "chmod 755 failed ${file.absolutePath}: ${it.message}") }
            if (!file.canExecute()) {
                runCatching { file.setExecutable(true, false) }
                    .onFailure { Log.w(TAG, "setExecutable failed ${file.absolutePath}: ${it.message}") }
            }
        }

        /**
         * `bin/` 全量 + node + jspawnhelper 置 0755。
         *
         * Android 的 File.setExecutable 只加 x 位，不能保证 0755；容器环境对
         * `Android/data` 的挂载策略也可能把 mode 清成 0600，所以这里用
         * `Os.chmod(0755)` 直接改 mode，再补一次 setExecutable 兜底。
         */
        private fun ensureExecutables(nodeBin: File) {
            forceMode755(nodeBin)
            val binDir = nodeBin.parentFile
            binDir?.listFiles()?.forEach { if (it.isFile) forceMode755(it) }
            binDir?.parentFile?.let { root ->
                forceMode755(File(root, "lib/jspawnhelper"))
                forceMode755(File(root, "lib/libdsh_pty.so"))
            }
        }

        /** 启动诊断头：容器里「引擎未就绪」时，先看这四行。 */
        private fun writeStartupDiagnostics(logFile: File, nodeBin: File) {
            runCatching {
                logFile.parentFile?.mkdirs()
                logFile.appendText(
                    "---- engine start ${System.currentTimeMillis()} ----\n" +
                        "abi=${Build.SUPPORTED_ABIS.joinToString(",")}\n" +
                        "sdk=${Build.VERSION.SDK_INT} arch=${System.getProperty("os.arch")}\n" +
                        "device=${Build.MANUFACTURER}/${Build.BRAND}/${Build.MODEL} hw=${Build.HARDWARE}\n" +
                        "log=${logFile.absolutePath}\n" +
                        "node=${nodeBin.absolutePath} exists=${nodeBin.exists()} " +
                        "canExecute=${nodeBin.canExecute()} size=${nodeBin.length()}\n",
                )
            }.onFailure { Log.w(TAG, "startup diagnostics failed: ${it.message}") }
        }

        /**
         * 校验 execve 的 `file` 参数是绝对路径。
         *
         * 原生层走 `execve(3)`（`dsh_pty.c` 的 G3 硬约束），它**不搜索 PATH**：
         * 传裸名会让子进程以 exit 127 立即死亡，而 PTY 随即 EIO，宿主侧看不到
         * 任何 stderr —— 表现为「启动失败 + 无限重试」且日志空白。宁可在这里
         * 抛一个带名字的异常，也不要把裸名交给 fork。
         */
        private fun requireAbsolute(path: String, what: String): String {
            if (!path.startsWith("/")) {
                throw EngineStartException(
                    "$what 必须是绝对路径，收到 \"$path\"（execve 不搜索 PATH，裸名会 exit 127）",
                )
            }
            return path
        }

        /**
         * 启动引擎进程。
         *
         * @param nodeBin  `engine/bin/node` 的**绝对路径**（execve 不搜索 PATH）
         * @param entryJs  引擎入口 `.../dsh/lib/bin.js` 的绝对路径
         * @param cwd      工作目录
         * @param env      完整环境变量数组（见 [EngineConfig.buildEnv]）
         * @param patchPath `android-overlay.yml` 的绝对路径；null 表示不注入
         * @param rootPrefix 非 null 时以 root 启动：经探测可用的 su 形式前缀，
         *   **首项必须是 su 的绝对路径**（如 `["/system/bin/su","-c"]`）。argv 改为
         *   `[su, …, "exec 'node' …"]` —— Magisk/KernelSU 的 su 会 exec 替换自身，
         *   引擎进程仍是 forkpty 的直接子进程，PR_SET_PDEATHSIG 继续有效。
         *
         *   传裸名会直接 ENOENT：原生层用 execve 启动（见 `dsh_pty.c` 的 G3），
         *   execve 不搜索 PATH。此处用 [requireAbsolute] 硬校验，把这类错误挡在
         *   fork 之前 —— 否则症状是子进程 exit 127、PTY 立即 EIO、日志里连一行
         *   报错都没有，只能靠 logcat 反推（缺陷 L 就是这样排查了两轮）。
         */
        suspend fun spawn(
            nodeBin: File,
            entryJs: File,
            cwd: File,
            env: Array<String>,
            logFile: File,
            patchPath: String?,
            rootPrefix: List<String>? = null,
        ): EngineProcess = withContext(Dispatchers.IO) {

            ensureExecutables(nodeBin)
            writeStartupDiagnostics(logFile, nodeBin)
            cwd.mkdirs()

            // argv：node --expose-internals <entryJs> web --patch <overlay> --no-open
            //
            // --expose-internals 不是可选项：运行时里 node-addon-require-builtin
            //   已被替换为纯 JS shim，靠该 flag 才能 require internal/* 模块。
            // 刻意不设 V8 堆上限：用户真正吃内存的场景是软件编译（clang/rustc/gradle），
            //   限堆会直接导致构建 OOM。
            val nodeArgv = buildList {
                add(nodeBin.absolutePath)
                add("--expose-internals")
                add(entryJs.absolutePath)
                add("web")
                if (patchPath != null) {
                    add("--patch")
                    add(patchPath)
                }
                add("--no-open")
            }

            val argv: List<String> = if (rootPrefix == null) {
                nodeArgv
            } else {
                val suPath = requireAbsolute(rootPrefix.first(), "rootPrefix")
                // 拼成经 shell 解释的单命令（su 的各种形式都以 -c/位置参数收命令）
                val command = "exec " + nodeArgv.joinToString(" ") { arg ->
                    if (arg.contains(Regex("[\\s\"'\\\\]"))) "'" + arg.replace("'", "'\\''") + "'" else arg
                }
                listOf(suPath) + rootPrefix.drop(1) + listOf(command)
            }

            fun attempt(executable: String, args: List<String>, label: String): IntArray? = try {
                PtyBridge.nativeForkPty(
                    executable = executable,
                    argv = args.toTypedArray(),
                    envp = env,
                    cwd = cwd.absolutePath,
                    rows = 40,
                    cols = 120,
                )
            } catch (t: Throwable) {
                runCatching { logFile.appendText("spawn[$label] exception: ${t}\n") }
                null
            }

            var used = if (rootPrefix == null) "node" else "su"
            var result = attempt(argv.first(), argv, used)

            /*
             * 容器兜底 #2：/system/bin/linker64 <node> <args...>
             *
             * 这是任务要求的「动态链接器变相加载」。注意：如果容器是在
             * fork()/clone() 层直接拒绝，走 linker64 仍然会先撞 fork，因此
             * 原生层还加了 posix_spawn 的另一条 clone 路径；这里只是把
             * execve 的目标从私有目录二进制换成系统链接器，覆盖
             * 「fork 允许、execve 私有文件被拒」的容器策略。
             */
            if ((result == null || result[0] < 0) && rootPrefix == null) {
                val linker = File("/system/bin/linker64")
                if (linker.isFile) {
                    val primaryErr = result?.let { -it[0] } ?: -1
                    runCatching {
                        logFile.appendText("spawn[node] failed errno=$primaryErr; retry via linker64\n")
                    }
                    val linkerArgv = listOf(linker.absolutePath, nodeBin.absolutePath) + nodeArgv.drop(1)
                    result = attempt(linker.absolutePath, linkerArgv, "linker64")
                    used = "linker64"
                }
            }

            val masterFd = result?.get(0) ?: -1
            val pid = result?.get(1) ?: 0

            if (masterFd < 0) {
                val errno = if (result != null) -masterFd else -1
                runCatching {
                    logFile.appendText("spawn failed errno=$errno mode=$used\n")
                }
                throw EngineStartException("spawn failed ($used), errno=$errno")
            }

            Log.d("DSH_ENGINE", "Node process started pid=$pid node=${nodeBin.absolutePath}")
            Log.d("DSH_ENGINE", "entry=${entryJs.absolutePath} cwd=${cwd.absolutePath}")

            logFile.parentFile?.mkdirs()
            logFile.appendText("---- engine start ${System.currentTimeMillis()} ----\n")

            EngineProcess(masterFd, pid, logFile).also { it.startThreads() }
        }
    }

    private fun startThreads() {
        pumpThread = Thread(::pumpLoop, "kxxy-log-pump").apply { isDaemon = true; start() }
        waitThread = Thread(::waitLoop, "kxxy-waiter").apply { isDaemon = true; start() }
    }

    /**
     * 日志泵：把 PTY master 的输出同时写到 logcat 与 engine.log。
     *
     * 用反射构造 FileDescriptor 是 Android 平台惯例（libcore 未提供公开构造器）。
     * engine.log 采用环形截断：超过 [EngineConfig.MAX_LOG_BYTES] 时保留尾部一半，
     * 避免长跑设备把存储写满。
     */
    private fun pumpLoop() {
        val fd = FileDescriptor()
        try {
            val field = FileDescriptor::class.java.getDeclaredField("descriptor")
            field.isAccessible = true
            field.setInt(fd, masterFd)
        } catch (e: Exception) {
            Log.e(TAG, "cannot wrap master fd for reading", e)
            return
        }

        FileInputStream(fd).use { input ->
            val buf = ByteArray(READ_BUFFER)
            while (!stopped.get()) {
                val n = try {
                    input.read(buf)
                } catch (e: Exception) {
                    if (!stopped.get()) Log.w(TAG, "log pump read failed: ${e.message}")
                    break
                }
                if (n <= 0) break

                val chunk = String(buf, 0, n, Charsets.UTF_8)
                Log.d(TAG, chunk.trimEnd())
                appendLog(chunk)
            }
        }
    }

    private fun appendLog(chunk: String) {
        try {
            if (logFile.length() < EngineConfig.MAX_LOG_BYTES) {
                logFile.appendText(chunk)
            } else {
                val keep = (EngineConfig.MAX_LOG_BYTES / 2).toInt()
                val tail = logFile.readText().takeLast(keep)
                logFile.writeText(tail + chunk)
            }
        } catch (e: Exception) {
            Log.w(TAG, "appendLog failed: ${e.message}")
        }
    }

    private fun waitLoop() {
        val status = try {
            PtyBridge.nativeWaitPid(pid)
        } catch (e: Exception) {
            Log.e(TAG, "waitpid failed", e)
            -1
        }
        Log.i(TAG, "engine exited, raw status=0x${status.toString(16)} (${PtyBridge.describe(status)})")
        exitStatus.complete(status)
    }

    /**
     * 优雅停止：先 SIGTERM，轮询到 deadline，仍未退出则 SIGKILL。
     *
     * 选择 SIGTERM 而非直接 SIGKILL，是给引擎收尾机会（flush 会话日志、
     * 释放监听端口）。参考项目记录的教训：root 模式下 PTY 只能杀到 su 外壳，
     * `exec node` 的孙进程会成孤儿继续霸占端口 —— 本方案用 G2
     * （PR_SET_PDEATHSIG）从根上避免该问题。
     */
    fun stop(graceMs: Long = 10_000L) {
        if (stopped.getAndSet(true)) return

        PtyBridge.nativeKill(pid, PtyBridge.SIGTERM)

        val deadline = System.currentTimeMillis() + graceMs
        while (System.currentTimeMillis() < deadline) {
            if (exitStatus.isCompleted) break
            if (PtyBridge.nativeAlive(pid) == 0) break
            try {
                Thread.sleep(50)
            } catch (_: InterruptedException) {
                break
            }
        }

        if (PtyBridge.nativeAlive(pid) != 0) {
            Log.w(TAG, "graceful stop timed out after ${graceMs}ms, force killing pid=$pid")
            PtyBridge.nativeKill(pid, PtyBridge.SIGKILL)
        }

        runCatching { PtyBridge.nativeClose(masterFd) }
        pumpThread?.join(1_000)
        waitThread?.join(1_000)
    }

    /** 是否仍在运行。 */
    fun isAlive(): Boolean = !exitStatus.isCompleted && PtyBridge.nativeAlive(pid) != 0

    /** 调整终端尺寸。 */
    fun resize(rows: Int, cols: Int) {
        PtyBridge.nativeResize(masterFd, rows, cols)
    }

    /** 向引擎 stdin 写数据（终端交互用）。 */
    fun write(data: ByteArray): Int = PtyBridge.nativeWrite(masterFd, data)

    /** 读取日志尾部若干字节（供宿主管理页展示）。 */
    fun tailLog(maxBytes: Int = 64 * 1024): String = try {
        if (!logFile.isFile) "" else logFile.readText().takeLast(maxBytes)
    } catch (e: Exception) {
        "log read failed: ${e.message}"
    }

    /**
     * 从日志中提取带 token 的 WebUI URL。
     *
     * ⚠️ 只搜 [fromOffset] 之后的日志段：搜全文会拿到上一次启动的旧 token，
     * 导致 WebView 401 白页（参考项目实测）。
     */
    fun extractTokenUrl(fromOffset: Long): String? {
        val text = try {
            if (!logFile.isFile) return null
            val all = logFile.readText()
            if (fromOffset >= all.length) return null
            all.substring(fromOffset.toInt())
        } catch (e: Exception) {
            return null
        }
        return TOKEN_RE.findAll(text).lastOrNull()?.groupValues?.get(1)
    }

    /** 日志当前长度，用于 spawn 前记录偏移基线。 */
    fun logLength(): Long = try {
        if (logFile.isFile) logFile.length() else 0L
    } catch (e: Exception) {
        0L
    }
}

/** 引擎启动失败。 */
class EngineStartException(message: String) : Exception(message)

/**
 * 匹配官方启动时打印的带 token URL。
 *
 * 官方输出形如：`dsh web: http://127.0.0.1:3080/?token=<hex>`
 */
private val TOKEN_RE = Regex("""dsh web: (http://127\.0\.0\.1:\d+/\?token=\S+)""")

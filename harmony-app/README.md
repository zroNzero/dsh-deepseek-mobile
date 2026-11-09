# HarmonyOS Native Shell (Stage / ArkTS)

这是 Android 版的 HarmonyOS 原生壳工程：用 `libnode.so` 在 **App 进程内**启动 DSH Node Host，再用 `Web` 组件加载 `http://127.0.0.1:3080`，并注入与 Android 完全相同的 `inject.js` / `inject.css`。

> 当前仓库**不包含** `libnode.so`，本机也没有 DevEco Studio / HarmonyOS SDK，因此没有在本机产出 HAP。工程结构、NAPI、ArkTS 与 CI 工作流均已就位；按下面步骤补齐 SDK 和库后可编译。

## 为什么走进程内 `dlopen`

鸿蒙卓易通容器在 seccomp 层拦截 `fork`/`clone`（日志 `fork failed errno=13`）。NAPI 方案不再创建子进程：

1. `dlopen("libnode.so", RTLD_NOW | RTLD_GLOBAL)`
2. `dlsym` 取 `_ZN4node5StartEiPPc`（`node::Start(int, char**)`）
3. 在 `pthread_create` + `pthread_detach` 的后台线程调用 `node::Start`
4. 启动前设置 `UV_USE_IO_URING=0`，并安装 SIGSYS 日志处理器
5. Node 监听 `127.0.0.1:3080`，ArkTS `Web` 组件加载该地址
6. `onPageEnd` 从 `rawfile` 读取 `inject.js` / `inject.css` 并 `runJavaScript`

`inject.css` 已包含 iQOO 实机的双重黑遮罩修复（关闭 `backdrop-filter`、固定唯一 mask 的 z-index）。

## 目录

```
harmony-app/
├─ AppScope/                       app.json5 + 图标/字符串
├─ entry/
│  ├─ src/main/
│  │  ├─ ets/entryability/EntryAbility.ets
│  │  ├─ ets/pages/Index.ets       WebView + 注入 + 启动状态
│  │  ├─ cpp/napi_init.cpp         dlopen/dlsym/node::Start + SIGSYS
│  │  ├─ cpp/CMakeLists.txt
│  │  └─ resources/rawfile/        inject.js / inject.css
│  ├─ libs/arm64-v8a/              ← 放置 libnode.so、libc++_shared.so
│  └─ build-profile.json5
├─ build-profile.json5
├─ hvigorfile.ts
├─ oh-package.json5
├─ hvigor/hvigor-config.json5
└─ README.md
```

## 前置条件

- DevEco Studio 5.0+（HarmonyOS NEXT / API 12+），含 HarmonyOS SDK 与 `hvigorw`、`ohpm`
- OpenHarmony NDK（arm64-v8a）
- **为 OpenHarmony 构建的 `libnode.so`**（Node 24.x，`--shared`）
- 与本机 Node 版本匹配的 `libc++_shared.so`

### 1. 构建 `libnode.so`

Node 官方没有 HarmonyOS 预编译共享库，需要在 OpenHarmony 的 Node 移植分支上构建：

```bash
# 以 OpenHarmony third_party/node 或 nodejs-mobile 的 OHOS 分支为例
./configure --shared --dest-os=ohos --dest-cpu=arm64 \
  --without-npm --without-corepack \
  --cross-compiling --openssl-no-asm
make -j$(nproc) node
```

把产物 `libnode.so` 与 NDK 的 `libc++_shared.so` 放进：

```
harmony-app/entry/libs/arm64-v8a/
```

> `node` 可执行文件（ET_EXEC）**不能**被 `dlopen`；必须是带 `node::Start` 导出的 `ET_DYN` 共享库。可用
> `llvm-readelf -h libnode.so | grep Type` 确认是 `DYN`，用
> `llvm-nm -D libnode.so | grep _ZN4node5Start` 确认符号存在。

### 2. 安装运行时 JS 树

HAP 不内置 331MB 的 `runtime.zip`。首次安装后，把 Android 版 `runtime.zip` 解压到应用私有目录：

```
<filesDir>/engine/
├─ bin/node
├─ lib/node_modules/@deepseek-ai/dsh/lib/bin.js
├─ lib/node_modules/...
└─ android-overlay.yml
```

可用 `hdc file send` + 应用内解压，或在调试版里把 `runtime.zip` 放进 `rawfile/` 后由 ArkTS 解压（会显著增大 HAP）。`Index.ets` 传入的 root 是 `filesDir + '/engine'`。

### 3. 构建 HAP

```bash
cd harmony-app
ohpm install
hvigorw assembleHap --mode module -p product=default -p buildMode=debug
```

产物在 `entry/build/default/outputs/default/entry-default-signed.hap`（需在 DevEco 中配置签名，或使用自动签名）。

## GitHub Actions

`.github/workflows/harmony-build.yml` 使用 **self-hosted** runner（标签 `harmonyos`），因为 GitHub 托管 runner 没有 HarmonyOS SDK/签名环境。工作流会检查 `libnode.so` 是否存在，然后执行 `ohpm install` + `hvigorw assembleHap` 并上传 HAP artifact。

## 当前限制

- 本机没有 DevEco/SDK，**未实际编译 HAP**，因此 `dlopen` 是否在目标鸿蒙设备上稳定运行尚未经过真机验证。
- 若 `dlopen` 成功但 `node::Start` 内部仍调用被 seccomp 拦截的 syscall，SIGSYS 处理器只能记录日志；需要继续裁掉对应能力（例如 `UV_USE_IO_URING=0` 已覆盖 io_uring）。
- on-device 工具调用（shell/终端）依赖 `fork`；进程内 Node 只能保证 Web UI 与主 Host 启动，子进程工具在纯 seccomp 容器里仍不可用。

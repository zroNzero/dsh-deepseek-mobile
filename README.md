# DeepSeek Harness Mobile

非官方 Android / HarmonyOS 客户端。内置 Node Host，加载 DSH Web UI。

## 前置要求

### Android

- JDK 17
- Android SDK 36
- NDK 28.2.13676358
- Node.js 24

### HarmonyOS

- DevEco Studio 26 / API 26
- `libnode.so` 自备：

  https://github.com/electerm/ohos-node-shared/releases/download/ohos-node-shared-v24.2.0/libnode-arm64.so

- 重命名为 `libnode.so`，放入：

  `harmony-app/entry/libs/arm64-v8a/`

- 同目录放入 SDK 的 `libc++_shared.so`

## 构建

### Android

```powershell
build.cmd assembleDebug
powershell -File refer/DSH-Kxxy/tools/build-apk.ps1
```

`tools/build-apk.ps1` 需要 `refer/DSH-Kxxy/android/app/src/main/assets/runtime.zip`。

### HarmonyOS

```powershell
harmony-app\build-hap.cmd
```

产物：

`harmony-app/entry/build/default/outputs/default/entry-default-signed.hap`

## 使用

- 安装后进入 Web UI 的 **设置 → 模型服务**，填 DeepSeek API Key。
- Cloud GitHub 首次启动填 Token 与 `owner/repo`。
- 插件页 **+** 安装 npm / GitHub 插件。

## 下载

- Android：https://github.com/zroNzero/dsh-deepseek-mobile/releases/tag/v1.0.0-Android
- HarmonyOS：https://github.com/zroNzero/dsh-deepseek-mobile/releases/tag/v1.0.0-Harmony

## 已知限制

- 仅 arm64。
- Android 本地 bash/git/pnpm 全开。
- HarmonyOS 无 pnpm、git、本地 shell。
- 插件安装仅支持无第三方依赖的插件。
- HarmonyOS 代码同步需远端完成。

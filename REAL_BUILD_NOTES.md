# DSH-DeepSeek 真实构建记录

## 产物

- APK：`D:\PC\dsh\dsh-mobile\DSH-DeepSeek.apk`
- 大小：819,618,438 B（781.65 MiB）
- SHA-256：`C0A23AC09392D4A5BD27ECAE7D95837ECE4D96DF57A857535C3D7D29924B3F49`
- 包名：`app.kxxy`；versionCode `908000`；label `DSH-DeepSeek`
- 启动 Activity：`app.kxxy.BootstrapActivity` → `app.kxxy.MainActivity`
- 签名：仓库固定密钥 `CN=DSH Kxxy`，证书 SHA-256 `D08AE499…0373`，v2 签名通过

## 真实前端

- 在 `refer/deepseek-harness` 执行 `npm run build`（tsx scripts/build.ts）：
  **10/10 gates passed，367 个 client artifact**。
- 生成 `refer/deepseek-harness/apps/web/dist`（21.2 MiB），已复制到
  `refer/DSH-Kxxy/android/app/src/main/assets/web/`。
- WebView 不再加载 `file:///android_asset/...`；MainActivity 加载
  `http://127.0.0.1:3080/`（引擎日志里的 token URL）。

## 真实 Node 引擎

- 运行时由 `tools/build-runtime.mjs` 现场装配：
  - Termux aarch64 闭包 279 个 deb（USTC 镜像）
  - Node.js **24.18.0**
  - DSH 桌面版 `app.asar` 的 592 个包闭包
  - `dsh-web-mobile@3.1.0`、`kxxy-host`
- runtime.zip：773.37 MiB，65,186 条目，解压 1.92 GiB，
  SHA-256 `AB697A77924F081B9DF6794CCA2A4FF9871C9412B6BC806FE3143636DB5B85AC`
- 22 个构建期补丁全部应用；`dsh-fs-local` 额外补了 0.2.1 版本兼容分支
  （Android 上 `link()` 被 SELinux 禁止，改为 `rename` 原子发布）。
- APK 内以 STORE 方式携带：`assets/runtime.zip` + `assets/alias-links.txt`。

## 引擎路径与 URL

- 解压目录：`/data/data/app.kxxy/files/engine`
  （实体路径 `/data/user/0/app.kxxy/files/engine`）
  - `bin/node`
  - `lib/node_modules/`
  - `share/texlive/2026.0/`
- WebView URL：`http://127.0.0.1:3080/`
  - 带鉴权：`http://127.0.0.1:3080/?token=<engine-log-token>`
- Node 启动日志：logcat tag `DSH_ENGINE`
  - `Node process started pid=… node=/data/data/app.kxxy/files/engine/bin/node`

## 原生改动

- 恢复 DSH-Kxxy 原工程（BootstrapActivity / MainActivity / EngineSupervisor /
  RuntimeInstaller / PTY / 进程守护等全部真实代码）。
- `MainActivity.onPageFinished` 注入 `assets/inject/inject.css` 与 `inject.js`。
- `onBackPressed` 先调用 `window.handleAndroidBack()`，返回 `true` 时不退出。
- `EngineProcess.spawn` 增加 `DSH_ENGINE` 启动日志。

## 安装

```bat
adb install -r "D:\PC\dsh\dsh-mobile\DSH-DeepSeek.apk"
```

- 首次启动会解压 runtime（1.92 GiB），需预留约 4 GB 空间，耗时数分钟。
- 若设备上已有不同签名的 `app.kxxy`，先 `adb uninstall app.kxxy`。
- 首次进入会显示 DSH 的「预览版说明」，点「继续」即可。

## 说明

- 本机没有连接 Android 设备/模拟器，未做真机启动验证；APK 的编译、
  签名、runtime 清单、资源条目均已校验。
- 引擎侧实际提供的前端是 runtime 内 `@deepseek-ai/dsh-web-frontend/dist`
  （随 runtime 装配的官方 0.2.1 构建）；`assets/web` 里另存有本次
  `npm run build` 生成的 0.2.2 构建产物。

# DeepSeek Harness Mobile

非官方 Android / HarmonyOS 客户端。内置 Node Host，加载 DSH Web UI。

## 下载

- Android：Releases `v2.2.0-Android`
- HarmonyOS：Releases `v2.2.0-Harmony`

## 构建

Android：

```powershell
build.cmd assembleDebug
powershell -File refer/DSH-Kxxy/tools/build-apk.ps1
```

HarmonyOS：

```powershell
harmony-app\build-hap.cmd
```

## 说明

- arm64
- API Key 在 Web UI 设置
- libnode.so 自备
- 非官方项目

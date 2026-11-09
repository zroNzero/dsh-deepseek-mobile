# HarmonyOS Shell

ArkTS 外壳。`libnode.so` 进程内启动 Node Host，Web 加载 `127.0.0.1:3080`。

## 构建

```powershell
build-hap.cmd
```

产物：`entry/build/default/outputs/default/entry-default-signed.hap`

## 依赖

- DevEco Studio 26 / API 26
- `entry/libs/arm64-v8a/libnode.so`
- `entry/libs/arm64-v8a/libc++_shared.so`
- 自动签名

## 说明

- arm64
- 内置云 GitHub 工具
- 插件本地安装

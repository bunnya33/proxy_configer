# 部署说明

本项目执行 `npm run build` 后，`dist` 目录就是完整部署包。

## 上传和启动

1. 将整个 `dist` 目录上传到服务器。
2. 确认服务器已安装 Node.js 20 或更高版本。
3. 进入上传后的目录并启动：

```bash
npm start
```

也可以直接执行：

```bash
node server/index.js
```

服务从 `config/server.json` 读取监听地址、端口和 HTTPS Cookie 设置。默认监听 `0.0.0.0:57356`；`HOST`、`PORT` 和 `COOKIE_SECURE` 环境变量可用于临时覆盖配置文件。

`config` 和 `data` 目录必须允许服务进程写入。后台修改账号或订阅配置时，变化会直接保存在这两个目录及 YAML 文件中。

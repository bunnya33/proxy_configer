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

服务默认监听 `0.0.0.0:57356`。可以通过 `HOST` 和 `PORT` 环境变量修改监听地址，通过 `COOKIE_SECURE=true` 为 HTTPS 部署启用 Secure Cookie。

`config` 和 `data` 目录必须允许服务进程写入。后台修改账号或订阅配置时，变化会直接保存在这两个目录及 YAML 文件中。

# 部署说明

## 自动安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/bunnya33/proxy_configer/main/bootstrap.sh | sudo bash
```

或 `git clone https://github.com/bunnya33/proxy_configer.git`，进入项目后执行 `sudo bash install.sh`。

若 Raw 域名无法连接，可改用 GitHub 官方 API 下载同一个脚本：

```bash
curl -fsSL -H 'Accept: application/vnd.github.raw+json' 'https://api.github.com/repos/bunnya33/proxy_configer/contents/bootstrap.sh?ref=main' | sudo bash
```

安装脚本支持 Debian/Ubuntu、Fedora/RHEL 及 Arch 的依赖安装；其他 systemd 发行版需预装脚本列出的系统依赖。系统缺少合适的 Node.js 时，x86_64/arm64 会下载并校验官方 Node.js 22 LTS。已有 Node.js 需至少为 22.12，且位于服务可访问的系统目录（如 `/usr/local/bin/node`）；不要使用家目录中的 nvm 运行时。自动安装需要联网下载源码、Node.js 和 npm 依赖。

安装后服务为 `proxy-configer.service`，由专用系统用户运行。默认后台为 `http://服务器IP:57356/admin`，首次安装输出随机账号和密码。请在服务器防火墙或云安全组中放行实际监听端口。

```bash
sudo proxy-configer
sudo journalctl -u proxy-configer.service -n 50 --no-pager
```

程序版本保存到 `/opt/proxy-configer/releases`，`current` 指向当前版本；安装升级仅替换程序，保留 `/var/lib/proxy-configer` 中的数据。启动失败时会尝试恢复上一程序版本。历史程序版本在卸载时统一移除。

## 端口、凭据与 HTTPS

通过 `sudo proxy-configer` 修改端口或管理员账号密码。端口须为 1-65535，安装后的服务也可监听低于 1024 的端口。手动密码至少 12 位，输入不会回显；随机重置需要确认，新密码只在本次操作中显示。凭据修改后无需重启，旧会话立即失效。

监听地址、端口和 Cookie 设置位于 `/var/lib/proxy-configer/config/server.json`。在 HTTPS 反向代理后使用时，将 `cookieSecure` 设置为 `true` 并重启服务，浏览器通过 HTTPS 域名访问；应用本身仍提供 HTTP，由反向代理终结 TLS。菜单显示的是应用 HTTP 地址。

管理员配置只保存 scrypt 哈希和会话密钥，文件权限为 `600`。旧版 `password` 明文字段会在启动或初始化时自动迁移并移除。状态查询不展示密码；丢失密码可用菜单选项 7 重置。

## 备份、恢复和卸载

完整备份目录为 `/var/lib/proxy-configer`，其中包含账号、会话密钥、端口、模板和全部订阅数据。为保证一致性，备份或恢复时先在菜单中停止服务，再操作数据，完成后启动服务。恢复后的文件应由 `proxy-configer:proxy-configer` 用户持有，数据目录权限为 `700`。

菜单选项 8 会停止并禁用服务、删除服务定义、程序和管理命令。默认保留全部数据，选择彻底删除需要两次确认。共享 Node.js、npm、系统依赖及专用系统用户保留，便于重装和恢复。

## 上传 dist 手动部署

开发机执行 `npm ci && npm run build`，上传整个 `dist` 目录。服务器需要 Node.js 22.12 或更高版本，无需再次安装 npm 依赖：

```bash
cd dist
npm start
# 或 node server/index.js
```

首次启动生成随机凭据并显示在终端。若希望保留旧账号和业务数据，请从旧部署复制 `config`、`data` 和 `bunnya.yaml`，或设置 `APP_DATA_DIR` 指向这些文件所在目录，避免用部署包中的初始文件覆盖数据。此手动方式不会注册 systemd 或管理菜单。

直接运行部署包时，可用 `node server/manage.js admin-random` 重置账号；`node server/manage.js admin-set` 从标准输入读取账号和密码各一行。不要把密码放进命令参数或 shell 历史。

# Clash 配置管理服务

使用 TypeScript、Vue 3 和 Element Plus 管理 Clash YAML 订阅、代理节点和分流规则。配置保存在 YAML/JSON 文件中，不依赖数据库。

## Linux 一键安装

适用于运行 systemd 的 Linux 服务器，自动安装依赖、构建项目、注册服务并设置开机自启。

```bash
curl -fsSL https://raw.githubusercontent.com/bunnya33/proxy_configer/main/bootstrap.sh | sudo bash
```

若服务器无法连接 `raw.githubusercontent.com`，可通过 GitHub 官方 API 下载同一个安装入口：

```bash
curl -fsSL -H 'Accept: application/vnd.github.raw+json' 'https://api.github.com/repos/bunnya33/proxy_configer/contents/bootstrap.sh?ref=main' | sudo bash
```

也可以克隆后安装，两种方式使用同一个安装脚本：

```bash
git clone https://github.com/bunnya33/proxy_configer.git
cd proxy_configer
sudo bash install.sh
```

默认监听 `0.0.0.0:57356`，访问 `http://服务器IP:57356/admin`。首次安装会显示随机管理员账号和强随机密码，请立即记录；密码只保存为 scrypt 哈希。重复安装保留原账号、端口、模板和订阅数据，不会重新生成凭据。

## 中文管理菜单

```bash
sudo proxy-configer
```

```text
1. 查看服务状态
2. 启动服务
3. 停止服务
4. 重启服务
5. 修改服务器端口
6. 修改管理员账号和密码
7. 随机重置管理员账号和密码
8. 卸载
0. 退出
```

修改端口会验证范围和占用情况，保存后重启服务并显示新地址；启动失败时恢复原端口。修改密码时隐藏输入，密码要求 12-256 位。手动修改或随机重置会立即更新后台真实凭据，同时使旧登录会话失效。状态菜单不显示密码。

卸载前会说明删除范围并要求确认，默认保留配置与业务数据；彻底删除数据需要再次确认。共享 Node.js 和系统依赖会保留。重新安装会使用之前保留的数据。

## 订阅和配置

- 新加坡订阅：`http://服务器IP:57356/subscribe/singapore`
- 国内订阅：`http://服务器IP:57356/subscribe/mainland`
- 新建配置复制默认模板，各订阅独立保存。
- 支持代理节点、代理组和规则的增删改查、规则行内编辑、策略选择、完整 YAML 编辑和语法校验。
- 页面编辑保留为草稿，点击“保存修改”后一次性写入 YAML。

订阅在 Clash 中的默认显示名称来自后台的“配置名称”。选中订阅 → “编辑资料” → 将“配置名称（订阅显示名）”改为 `轻云` 等文本 → 保存。重新导入订阅时，支持响应头名称的客户端会采用该名称，不会自动添加 `.yaml`。已导入的订阅可能保留客户端原来的名称，可在客户端手动重命名或重新导入；具体行为取决于客户端版本。

安装目录和数据目录分离：

```text
/opt/proxy-configer/current/              当前程序版本
/var/lib/proxy-configer/config/admin.json  管理员账号、密码哈希和会话配置
/var/lib/proxy-configer/config/server.json 监听地址、端口和 Cookie 设置
/var/lib/proxy-configer/data/              订阅索引及 YAML 文件
/var/lib/proxy-configer/bunnya.yaml        可修改的默认模板
```

详细部署、HTTPS 和备份步骤见 [DEPLOY.md](DEPLOY.md)。

## 本地开发与手动部署

需要 Node.js 22.12 或更高版本。

```bash
npm ci
npm run build
npm start
```

首次启动会显示随机账号和密码；旧版明文管理员配置会自动迁移为哈希并保留原凭据。不要直接编辑密码哈希，可使用管理工具重置账号密码：

```bash
node dist/server/manage.js admin-random
```

开发模式运行 `npm run dev`，前端地址为 `http://localhost:5173`。`npm run build` 生成完整的 `dist` 部署包，服务端依赖已打包，手动上传后无需安装 npm 依赖。部署包不会携带本地管理员凭据。

`APP_DATA_DIR` 可指定独立的数据目录；默认使用程序目录。`HOST`、`PORT` 和 `COOKIE_SECURE` 可临时覆盖监听配置。systemd 安装读取持久化的 `config/server.json`，保证菜单修改端口后生效。

## 验证

```bash
npm run build
npm test
shellcheck bootstrap.sh install.sh linux/manage.sh
```

`tests/runtime.test.mjs` 验证真实 HTTP 登录、明文迁移、会话失效、数据保留、端口校验和占用检测。Linux 安装与菜单的端到端验证见 [tests/linux-e2e.py](tests/linux-e2e.py)，请只在没有现有安装的测试服务器上以 root 执行。

已发布仓库的安装入口可用 `sudo python3 tests/linux-e2e.py --delivery-smoke` 验证；网络无法访问 Raw 域名时附加 `--bootstrap-api`，验证上述官方 API 入口。

# Clash 配置管理服务

一个使用 TypeScript、Vue 3 和 Element Plus 实现的 Clash YAML 订阅与后台管理服务。配置直接保存在 YAML/JSON 静态文件中，不依赖数据库。

## 快速开始

```bash
npm install
npm run build
npm start
```

默认监听 `0.0.0.0:57356`，打开 `http://localhost:57356/admin` 进入后台。

- 默认账号：`admin`
- 默认密码：`admin123`
- 新加坡订阅：`http://localhost:57356/subscribe/singapore`
- 国内订阅：`http://localhost:57356/subscribe/mainland`

正式部署前请修改 [`config/admin.json`](config/admin.json) 中的账号、密码和 `sessionSecret`。如果站点全程使用 HTTPS，请设置环境变量 `COOKIE_SECURE=true`。

## 文件结构

```text
config/admin.json       后台账号与会话设置
data/configs.json       配置名称、路由和文件索引
data/configs/*.yaml     各订阅的独立 Clash 配置
bunnya.yaml             默认模板
src/server              TypeScript 服务端
src/client              Vue + Element Plus 管理端
```

新建配置时会复制 `bunnya.yaml`。后台支持代理节点和规则的增删改查、规则行内编辑、策略选择，以及完整 YAML 编辑和语法校验。代理和规则修改会先保留为页面草稿，点击顶部“保存修改”后一次性写入 YAML。

首次启动生成的 `singapore.yaml` 和 `mainland.yaml` 都以默认模板为初始内容。请在后台分别填写实际的新加坡节点和国内节点参数；之后两条订阅会独立保存和更新。

## 开发

```bash
npm run dev
```

前端开发地址为 `http://localhost:5173`，API 服务仍使用 `57356` 端口。可通过 `PORT` 和 `HOST` 修改生产服务监听地址。

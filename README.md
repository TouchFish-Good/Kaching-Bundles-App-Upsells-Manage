# Kaching Developer Admin

独立开发者只读管理后台。商家应用位于同级 `Kaching Bundles App & Upsells New/bundles-app-upsells-new` 项目；管理后台使用固定 Owner 账户，不使用 SHOPLINE 商家会话。

## Cloudflare 部署准备

1. 创建独立的 Admin D1 数据库，并将其 ID 写入 `wrangler.toml` 的 `ADMIN_DB` 绑定。
2. 为 Admin Worker 和商家 Worker 配置相同的 `ADMIN_INTERNAL_SECRET` Secret，并设置 `MERCHANT_APP` Service Binding 指向商家 Worker。
3. 应用 `worker/migrations/` 中的 Admin D1 迁移。
4. 在本地设置 `ADMIN_BOOTSTRAP_EMAIL`、`ADMIN_BOOTSTRAP_PASSWORD`（至少 12 位），执行 `npm run bootstrap-owner -- --email owner@example.com` 生成 SQL。将输出通过受控命令写入 Admin D1；脚本不会连接或写入数据库。
5. 构建前端：`npm run build:web`，再部署 Worker：`npx wrangler deploy`。

生产环境不得提交 `.env`、`.dev.vars`、Owner 密码或 `ADMIN_INTERNAL_SECRET`。当前仓库尚未创建任何 Cloudflare D1、Secret、Service Binding、域名或远程部署。

商家数据只通过 Service Binding 的内部只读接口获得。真实安装记录需要商家应用成功完成授权；订阅、活动/折扣和反馈审核的数据契约尚未接入，后台不会伪造这些数据。

## 本地检查

使用 Node 22+ 执行：`npm run test:worker`、`npm run check:worker` 和 `npm run build:web`。商家应用拥有独立的测试与部署流程。

# Kaching Developer Admin

独立开发者只读管理后台。商家应用位于同级 `Kaching Bundles App & Upsells New/bundles-app-upsells-new` 项目；管理后台使用固定 Owner 账户，不使用 SHOPLINE 商家会话。

## Cloudflare 部署准备

1. 创建独立的 Admin D1 数据库，并将其 ID 写入 `wrangler.toml` 的 `ADMIN_DB` 绑定。
2. 为 Admin Worker 和商家 Worker 配置相同的 `ADMIN_INTERNAL_SECRET` Secret，并设置 `MERCHANT_APP` Service Binding 指向商家 Worker。
3. 应用 `worker/migrations/` 中的 Admin D1 迁移。
4. 在本地设置 `ADMIN_BOOTSTRAP_EMAIL`、`ADMIN_BOOTSTRAP_PASSWORD`（至少 12 位），执行 `npm run bootstrap-owner -- --email owner@example.com` 生成 SQL。将输出通过受控命令写入 Admin D1；脚本不会连接或写入数据库。
5. 构建前端：`npm run build:web`，再部署 Worker：`npx wrangler deploy`。

生产环境不得提交 `.env`、`.dev.vars`、Owner 密码或 `ADMIN_INTERNAL_SECRET`。2026-11-02 已创建 Admin D1、配置两个 Worker 的共享 Secret 与 Service Binding、初始化唯一 Owner，并部署管理后台至 Workers.dev 和 `https://admin.vswwy.cn`。

密码记录默认使用 `PBKDF2-SHA256 v2/25000`，以适配 Workers Free 的 CPU 限额；系统仍可识别和验证旧的 `v1/600000` 记录。登录接口保留共享 D1 的每 IP 限流。若需重置唯一 Owner 密码，在本地设置 `ADMIN_OWNER_EMAIL` 与 `ADMIN_OWNER_PASSWORD` 后执行 `npm run reset-owner-password -- --email owner@example.com`，再将输出 SQL 受控写入 Admin D1。

商家数据只通过 Service Binding 的内部接口获得。真实安装记录需要商家应用成功完成授权；订阅数据契约尚未接入，后台不会伪造这些数据。活动、反馈审核和诊断事件已通过字段白名单投影接入。

## 活动与诊断运维

管理后台的“活动与排障”与“诊断”页面通过 `MERCHANT_APP` Service Binding 查询商家 Worker。活动读取、紧急暂停和诊断数据都不会让管理后台直连商家 D1。应用 `traceId` 是本系统链路 ID；`upstreamRequestId` 仅在 SHOPLINE 明确返回请求 ID 时记录。

- 商家 D1 保存可检索的业务诊断事件 30 天，由商家 Worker 的 5 分钟定时任务清理。
- 原始 Worker 日志的目标是通过 Cloudflare Logpush 投递到专用 R2 bucket，并以 7 天生命周期删除；它用于深度排障，不是后台页面的查询来源。
- 原始日志资源不会由部署自动创建。使用只读 token 设置 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN` 后运行 `npm run verify:diagnostics-resources` 检查 bucket、7 天生命周期和两个 Logpush job。token 至少需要 Account Read、R2 Read 和 Logpush Read，且不应写入仓库。

详见 `docs/DIAGNOSTICS_OPERATIONS.md`。截至 2026-11-03，当前 Cloudflare 账户尚未启用 R2，因此原始日志仍未启用；D1 诊断不受影响。

## 本地检查

使用 Node 22+ 执行：`npm run test:worker`、`npm run check:worker` 和 `npm run build:web`。商家应用拥有独立的测试与部署流程。

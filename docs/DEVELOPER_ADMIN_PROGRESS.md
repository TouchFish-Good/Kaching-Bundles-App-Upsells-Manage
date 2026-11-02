# Developer Admin Console 进度

更新日期：2026-11-02。

2026-11-02 Cloudflare 原生迁移（本地实现，未部署）：管理后台已迁移为 Cloudflare Worker、独立 Admin D1 数据模型与 `MERCHANT_APP` Service Binding。它只保留一个固定 Owner 账户，不提供 MFA、邀请、多管理员或角色导航。认证使用 PBKDF2 密码记录、HttpOnly 会话、CSRF、共享 D1 登录限流和审计；商家只读数据经 HMAC 签名和字段白名单投影获得，管理后台不绑定商家 App D1。

| 项目 | 状态 |
| --- | --- |
| 当前阶段 | Cloudflare Worker 本地验证完成；远程 Cloudflare 资源和部署尚未执行 |
| 已完成 | 单 Owner 认证、会话、CSRF、登录限流、审计、HMAC Service Binding、字段投影、SPA 回退、离线 Owner SQL 生成 |
| 验证 | Worker 测试、密码 SQL 脚本、类型检查和前端生产构建通过；浏览器 Worker 登录 E2E 未执行 |
| 阻塞事项 | 尚未创建真实 Admin D1，故不能配置实际 D1 binding 或执行 Worker 浏览器登录冒烟；订阅、建议审核及真实活动/折扣契约尚未接入 |
| 下一步 | 创建 Admin D1、配置 Secret 与 Service Binding、执行迁移与 Owner SQL、再进行 HTTPS/浏览器/真实店铺联调 |

2026-10-14 对接增量：按 SHOPLINE 文档将店铺信息 REST 查询切换到 `v20260601`；卸载按 Webhook 的 `store_id` 和事件发生时间处理，并增加迟到事件回归测试。商家活动仓库已有草稿持久化，但商家页面仍用原型数据，因此后台 Bundles 继续明确显示未接入。逐项证据见 `DEVELOPER_ADMIN_ACCEPTANCE_REPORT.md`。`docs/qa/` 截图只包含测试夹具，不是实际商家数据。

2026-10-15 管理后台代码审查与优化重点、剩余依赖及验收口径见 `DEVELOPER_ADMIN_IMPROVEMENT_AUDIT.md`。

# Developer Admin Console MVP 验收报告

日期：2026-10-14。范围：本地实现及模拟数据源验证；没有真实 SHOPLINE 商家联调，也没有生产部署。

状态定义：PASS 表示有本地测试或代码证据；BLOCKED 表示缺少真实数据源或外部条件；NOT_TESTED 表示尚未进行对应环境验证。

| 需求 | 状态 | 证据及限制 |
| --- | --- | --- |
| ADM-01 独立认证 | PASS | 密码、TOTP MFA、会话失效及商家 Cookie 拒绝测试通过；独立账号使用 Argon2id。 |
| ADM-02 服务端 RBAC | PASS | Viewer 对错误事件请求得到 403；Owner 管理接口受权限及 CSRF 保护。 |
| ADM-03 商家安装清单 | BLOCKED | 稳定 ID、搜索分页、卸载重装及迟到卸载事件的本地测试通过；尚未与真实 SHOPLINE 店铺核对。 |
| ADM-04 商家详情 | BLOCKED | 按稳定 ID 查询及安装周期本地通过；真实活动数量和最近异常的完整商家详情待数据源接入。 |
| ADM-05 Bundle 查询 | BLOCKED | 商家服务已有草稿存储，但商家页面仍使用原型活动；跨店稳定 ID 投影未接入。管理接口返回 SOURCE_UNAVAILABLE，页面显示未接入。 |
| ADM-06 Bundle 详情 | BLOCKED | 同 ADM-05，无法与商家端真实记录比对。 |
| ADM-07 Overview | BLOCKED | 已安装数与最近错误数来自本地登记表；活动数明确显示不可用。真实统计口径待联调。 |
| ADM-08 脱敏错误事件 | PASS | 本地记录与筛选测试通过，Webhook 不再输出原始载荷；尚未验证真实故障覆盖率与保留期。 |
| ADM-09 管理审计 | PASS | 登录、敏感读取、邀请、停用写入独立审计表；本地流程验证。导出未实现，因此无导出尝试。 |
| ADM-10 至 ADM-13 P1 | NOT_TESTED | 结构化日志、服务监控、扩展部署证据、历史趋势未接入。 |
| ADM-14 至 ADM-16 P2 | NOT_TESTED | 部署历史、告警、受控运维操作未实施。 |

## 执行记录

- 后台：Node 22.22.3 下 `npm test`，6/6 通过；`npm run build` 通过；`npm audit --omit=dev --audit-level=high` 为 0 漏洞。
- 商家端：`node --test -r ts-node/register/transpile-only test/*.test.js test/*.test.cjs`，31/31 通过；`npm run build` 通过。SHOPLINE REST 调用优先使用 `v20260601`。
- 浏览器：`node test/browser-smoke.mjs` 通过，登录、MFA、导航、搜索、未接入状态、管理员邀请/激活/停用，以及桌面和移动布局无页面异常。`docs/qa/fixture-*.png` 是测试夹具截图。
- 安全边界：内部读取接口采用请求签名和重放保护；API 返回字段限定为登记数据；未向浏览器返回商家 access token 或 Webhook 原始载荷。

## 上线前事项

1. 用真实测试店完成 `v20260601` 授权、卸载、重装和迟到 Webhook 测试，再确认 ADM-03。
2. 让商家页面使用真实草稿存储，再按稳定 store ID 建立管理端只读投影；完成跨店 ID 篡改测试和活动详情对照，再确认 ADM-04 至 ADM-07。
3. 确定生产数据库、备份与恢复、日志保留期、HTTPS、独立环境密钥及多实例重放存储；完成部署与安全验收。

本报告不将本地夹具数据视为真实商家验收，也不表示系统已可用于生产。

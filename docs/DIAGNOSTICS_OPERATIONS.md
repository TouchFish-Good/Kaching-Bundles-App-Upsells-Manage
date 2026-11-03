# 活动与诊断运维

## 数据与保留期

| 数据 | 来源 | 保留期 | 用途 |
| --- | --- | --- | --- |
| 业务诊断事件 | 商家应用 D1 `campaign_diagnostic_events` | 30 天 | 管理后台按 Trace ID、商家、活动和结果筛选 |
| 原始 Worker 日志 | Cloudflare Logpush 到专用 R2 | 7 天 | 仅用于在 D1 事件定位后进行深度排障 |
| Owner 审计 | 管理后台 D1 | 按 Admin D1 审计策略 | 查询与紧急暂停的操作追溯 |

`traceId` 是应用生成的 UUID，会在管理后台与商家 Worker 间通过 HMAC 签名传递。`upstreamRequestId` 是 SHOPLINE 明确返回时才会保存的上游请求 ID，两者不可互相替代。

不保存 access token、refresh token、Cookie、Authorization 请求头、请求正文或完整上游响应正文。

## 原始日志资源

原始日志资源不会由 `wrangler deploy` 自动创建。先在 Cloudflare Dashboard 为账户启用 R2，再创建专用 bucket `kaching-worker-diagnostics`，并设置一个启用的删除生命周期规则：

- `action`: `Delete`
- `conditions.age`: `604800` 秒（7 天）

在 Cloudflare 当前账户确认实际支持的 Worker 日志数据集和字段后，创建两个 Logpush job，分别命名为：

- `kaching-merchant-raw-logs`，目标前缀为 `merchant-app/`
- `kaching-admin-raw-logs`，目标前缀为 `developer-admin/`

两个 job 不得采集 Cookie、Authorization、token、请求/响应正文或敏感查询参数。Logpush 可用性受 Cloudflare 套餐与账户能力限制；不支持时必须保持“原始 Worker 日志未启用”，不能影响活动读取、紧急暂停或 D1 诊断。

## 只读核验

创建一个仅包含 Account Read、R2 Read、Logpush Read 权限的临时 API token，并仅在当前终端会话中设置：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = "9767488de224c3864f0d4a97bb906933"
$secureToken = Read-Host "输入只读 Cloudflare API Token" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$env:CLOUDFLARE_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
npm run verify:diagnostics-resources
Remove-Item Env:CLOUDFLARE_API_TOKEN
```

检查结果为 `ready` 时，才说明 bucket、7 天生命周期和两个命名 job 都已存在。`degraded` 表示 D1 诊断可以继续使用，但原始日志能力尚未就绪；输出会列明缺失项。脚本只发起 GET 请求，不创建、修改或删除 Cloudflare 资源，也不输出 token。

截至 2026-11-03，当前账户的 R2 列表请求返回 `10042`，说明必须先在 Cloudflare Dashboard 启用 R2。启用后再执行上述检查，并根据 Cloudflare Dashboard 当时提供的日志数据集与字段创建 Logpush job。

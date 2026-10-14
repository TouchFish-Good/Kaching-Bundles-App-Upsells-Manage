# Developer Admin Console 组件与交互规格（阶段 3，待确认）

更新日期：2026-10-14。组件名称是设计边界，实际代码命名可按项目框架调整。组件通过管理 API 接收真实数据，不内置样本业务记录。

## 壳层与导航

| 组件 | 输入与职责 | 必须支持的状态 |
| --- | --- | --- |
| `AdminShell` | 当前账号、角色、环境和路由；呈现导航/顶部状态 | 桌面侧栏、移动菜单、会话失效 |
| `EnvironmentIndicator` | 当前环境与允许环境；防止生产/测试混淆 | 单环境、可切换、无权限 |
| `PrimaryNav` | 按权限显示 Overview/Stores/Bundles/Errors/Audit；P1 扩展 | 当前页、折叠、移动展开、焦点 |
| `PageHeader` | 标题、面包屑、更新时间、页面级命令 | 长标题换行、无更新时间 |
| `SourceStatus` | `current/stale/unavailable/unsupported` 及 `asOf` | 可读文字、来源说明、重试 |

## 数据呈现与筛选

| 组件 | 字段或行为 | 必须支持的状态 |
| --- | --- | --- |
| `MetricSummary` | 指标名称、值、口径、观测时间、来源状态 | 数值、真实零、未接入、延迟、失败 |
| `FilterBar` | 搜索、状态/类型/店铺、时间范围；与 URL 同步 | 初始、已筛选、清除、更新中 |
| `SearchField` | 明确 label、清空命令、Enter 执行、短暂防抖 | 空、输入、加载、无结果 |
| `DataTable` | 语义表格、稳定列宽、排序、行链接 | 加载、数据、零记录、过滤零结果、错误 |
| `RecordList` | 390/360px 下表格的字段名和值摘要 | 长 ID/名称换行、操作不溢出 |
| `CursorPagination` | 上/下一页、当前页范围、载入状态 | 首页、末页、筛选后重置 |
| `StatusBadge` | Installed/Uninstalled/Active/Scheduled/Paused/Unknown 等 | 文本与色彩双通道、可访问名称 |
| `CopyIdentifier` | 复制 store ID、trace ID 或 request ID | 成功反馈、权限/剪贴板失败 |
| `DetailSection` | 标题、定义列表、来源与更新时间 | 字段缺失、长文本、部分故障 |
| `EventDetailPanel` | 脱敏错误字段和关联店铺链接 | 桌面侧板、移动全屏、关闭后恢复焦点 |

## 各页字段

Stores 列：店铺、稳定 ID、安装状态、当前安装时间、最近同步、活动数、最近错误、详情。Bundles 列：活动名、店铺、类型、派生状态、排期、更新时间、详情。Errors 列：发生时间、严重度、类型、店铺、错误码、摘要、trace ID。Audit 列：时间、管理员、动作、对象、环境、结果、request ID。所有时间提供绝对时间，必要时辅以相对时间；相对时间不能取代可复制的绝对时间。敏感或过长摘要默认截断，但详情可完整显示已脱敏内容。

## 身份与受控操作

`LoginForm` 使用邮箱/密码、显示密码控制、字段错误与提交状态；浏览器自动填充和粘贴可用。`MfaChallenge` 根据确认的 MFA 方法显示验证、恢复码或 WebAuthn 操作；验证码可粘贴，不强迫逐位输入。`SessionExpired` 给出重新登录入口并保留安全的返回路径。`InviteAdminDialog` 和 `DisableAdminDialog` 仅 Owner 可见且经服务端 RBAC 校验；邀请需角色选择和有效期说明，停用需确认姓名/邮箱、影响及不可停用最后一个 Owner 的错误。管理动作的提交中禁用重复操作并显示结果，错误留在弹窗内便于修正。

## 系统状态组件

`PageSkeleton` 与最终页面结构同宽同高，减少内容位移。`EmptyState` 区分无真实记录和筛选无匹配，后者提供清除筛选。`UnavailableState` 用于 503/未接入，显示具体来源、最后成功时间（若有）及重试；不填造数值。`PermissionDenied` 对 403 显示无权访问与返回入口；`NotFound` 对 404 不透露是否有其他店铺的数据。`InlineAlert` 用于字段/模块错误并可被辅助技术公告。`ToastRegion` 仅作复制成功等非关键反馈；关键错误仍留在页面内。

## 交互规则

筛选变化通过 URL 更新并重置游标；返回列表恢复筛选位置。行主链接的点击区域清楚可见，行内复制按钮不能触发行导航。排序列以按钮呈现并声明方向；不可排序列不显示排序箭头。所有表格在加载期间维持列宽，旧数据保留时标明“更新中”；新查询失败时将旧数据标为过期并显示错误。详情返回应回到原列表及滚动位置。所有图标按钮用现有 lucide-react 图标并配 `aria-label`/title，按钮大小稳定。键盘可打开菜单、筛选、详情和弹窗；移动端不依赖悬停。`prefers-reduced-motion` 下取消非必要动画。

## 边界与数据契约

UI view model 必须包含 `environment`、记录 ID、可用的 `asOf` 和来源状态；缺失值与真实零区分。管理员角色只是界面显示条件，API 仍执行权限校验。活动详情只显示商家应用返回的只读投影，不能在 UI 再计算折扣或活动状态。Webhook payload、accessToken、原始请求/响应及未脱敏错误不得进入组件属性。P1 Monitoring/Deployments 在可信来源接入前不在正式导航中展示为可用。

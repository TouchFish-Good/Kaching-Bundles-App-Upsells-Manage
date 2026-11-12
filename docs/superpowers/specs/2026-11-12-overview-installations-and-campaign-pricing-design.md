# 开发者后台安装概览与折扣详情展示设计

## 目标

让唯一 Owner 在开发者后台首页直接看到已安装商家的状态，并能在活动详情中用中文、正常货币金额和可识别的市场信息核查每个折扣档位。管理后台不直接持有或使用商家 SHOPLINE token；活动与市场数据继续只由商家 Worker 经 Service Binding 提供。

## 已确认的展示规则

- 首页直接展示已安装商家列表。
- 现有 `.overview-section` 不再限制 `max-width: 780px`。
- 指定市场金额必须显示“市场名称 + 市场 ID + 币种 + 金额”。
- 折扣类型固定使用以下中文映射：

| 内部值 | 后台显示 |
| --- | --- |
| `none` | 原价 |
| `percentage` | 百分比折扣 |
| `fixed_amount` | 每件固定减免 |
| `fixed_price` | 每件固定价格 |
| `bundle_fixed_amount` | 整单固定减免 |
| `bundle_fixed_price` | 整单固定价格 |

金额在存储和服务间传输时仍为最小货币单位整数；浏览器不得显示“分”或直接将整数冒充主货币金额。

## 首页安装商家列表

`OverviewPage` 保留既有三个概览指标，并独立读取：

```text
GET /admin-api/v1/stores?status=installed&limit=10&offset=0
```

列表最多显示十个最近更新的已安装商家，每行包含：

- 商家 handle；
- 稳定店铺 ID；
- 已安装状态；
- 安装时间；
- 最近更新时间；
- 前往商家详情的链接。

列表与 `/overview` 指标分别加载、报错和刷新。一个来源失败时，另一个可用区域继续显示。没有已安装商家时显示真实空状态；底部“查看全部商家”链接至 `/stores?status=installed`。移动端复用现有 `mobile-record` 信息层级，避免横向滚动。

`.overview-section` 仅删除宽度限制，其余间距、边框、圆角和既有 Shadcn 风格维持不变。

## 活动价格与市场数据流

商家 Worker 是店铺币种和市场名称的唯一读取方。活动详情请求时，商家 Worker：

1. 从现有活动配置读取每档 `marketOverrides`。
2. 只有存在市场覆盖项时，使用店铺会话调用 SHOPLINE `GET /markets.json?limit=100`。
3. 使用现有 `shoplineAdminHeaders()` 发起请求，解析并缓存已验证的 `market_id`、`market_name` 和市场币种信息，缓存 TTL 为 5 分钟。
4. 同时取得店铺默认币种，作为没有指定市场金额时的金额格式化依据。
5. 只向内部管理读取接口投影当前活动涉及的市场，而不是把完整市场列表、会话或 SHOPLINE 原始响应交给管理后台。

SHOPLINE `GET /markets.json` 的已验证返回字段包括 `market_id`、`market_name`、`currency_settings` 与 `regions`；接口响应头可带 `traceId`。读取失败不阻断活动配置读取，也不触发任何平台写操作。

商家 Worker 内部活动投影新增以下白名单字段：

```ts
type CampaignPricingProjection = {
  shopCurrencyCode: string | null;
  tiers: Array<{
    tierId: string;
    displayOrder: number;
    quantity: number;
    discountType: 'none' | 'percentage' | 'fixed_amount' | 'fixed_price' | 'bundle_fixed_amount' | 'bundle_fixed_price';
    discountValue?: number;
    marketOverrides?: Array<{
      marketId: string;
      marketName: string | null;
      mode: 'auto_convert' | 'specified_amount';
      currencyCode?: string;
      amountMinor?: number;
    }>;
  }>;
};
```

开发者后台 Worker 的 `source-projection.ts` 必须逐字段验证上述结构：字符串长度、整数、枚举和可选字段均受限。未知字段、无效市场 ID、无效金额或未识别的覆盖模式均拒绝为 `INVALID_SOURCE`，不透传任意对象。

## 折扣详情展示

`CampaignDetailPage` 的档位表使用格式化函数，不再直接渲染内部英文值或整数：

- `none` 显示“原价”，数值显示 `—`。
- `percentage` 将基点整数转换为百分数，例如 `1000` 显示 `10%`。
- 其余金额型折扣以 `Intl.NumberFormat` 按币种的小数位显示，例如 `1250` 与 `USD` 显示 `USD 12.50`。
- 没有可靠店铺币种时，不猜测金额；显示“币种暂不可用”。
- `specified_amount` 覆盖显示为：`{marketName 或 “市场名称暂不可用”} · {marketId} · {currencyCode} {格式化金额}`。
- `auto_convert` 覆盖显示为：`{marketName 或 “市场名称暂不可用”} · {marketId} · 自动换算`。

市场查询暂时失败或返回内容无法验证时，详情仍显示市场 ID、指定金额和币种；市场名称显示“市场名称暂不可用”。因此 Owner 能继续排障，不会错误地把 ID 当名称或将金额隐藏。

## 错误处理与安全边界

- SHOPLINE 市场读取仍使用商家 Worker 的店铺授权及统一请求头；管理后台浏览器永远不调用 SHOPLINE。
- 不记录 SHOPLINE Authorization、Cookie、完整市场响应或 token。
- 上游市场读取失败仅影响名称补全，不改变活动状态、平台折扣状态或商家配置。
- 原有活动读取、紧急暂停、启用及删除平台折扣的业务语义保持不变。
- 不新增或修改 CSS 的 `:focus`、`:focus-visible` 相关规则。

## 验收与测试

- 商家 Worker：市场解析接受合法 `market_id`/`market_name`，拒绝畸形响应；五分钟缓存生效；请求使用 `shoplineAdminHeaders()`；市场源失败时活动详情仍返回安全降级投影。
- 开发者后台 Worker：安全投影接受合法店铺币种和市场覆盖项，拒绝未知覆盖字段、非法 ID、金额和枚举。
- 管理后台前端：折扣中文映射、百分比基点、不同币种的小数位、缺失币种和市场名称降级均有测试。
- 首页：已安装列表、空态、与指标相互独立的失败状态，以及“查看全部商家”链接均有测试。
- 浏览器：检查 1440px、768px 和 390px 的首页与活动详情，无横向溢出、文本遮挡或控制台错误。

## 非目标

- 不增加 R2、日志归档、市场管理或市场配置编辑功能。
- 不为管理后台增加新的登录方式或多角色权限。
- 不改变商家端活动暂停、删除、启用或 SHOPLINE 自动折扣生命周期。

import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Copy, RefreshCw, Search, ServerOff } from 'lucide-react';
import { api, ApiError, type Admin, type AuditEvent, type ErrorEvent, type List, type Overview, type Store } from './api';
import { absoluteTime, metricDisplay, sourceMessage, type Metric } from './state.ts';

function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) return;
    let current = true;
    setLoading(true); setError(null);
    api<T>(path).then((value) => { if (current) setData(value); }).catch((cause) => { if (current) setError(cause instanceof ApiError ? cause : new ApiError(503, 'SOURCE_UNAVAILABLE')); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [path, revision]);
  return { data, error, loading, retry: () => setRevision((value) => value + 1) };
}

function PageTitle({ title, note, action }: { title: string; note?: string; action?: React.ReactNode }) {
  return <div className="page-title"><div><h1>{title}</h1>{note && <p>{note}</p>}</div>{action}</div>;
}

function Status({ loading, error, retry, children }: { loading: boolean; error: ApiError | null; retry: () => void; children: React.ReactNode }) {
  if (loading) return <div className="loading-panel" role="status"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-line medium" /></div>;
  if (error) return <div className="state-block" role="alert"><ServerOff size={24} /><h2>{error.status === 403 ? '无权访问' : error.status === 404 ? '记录不存在' : error.code === 'SOURCE_UNAVAILABLE' ? '数据源暂不可用' : '加载失败'}</h2><p>{error.code === 'SOURCE_UNAVAILABLE' ? '当前没有可用的真实数据，请稍后重试。' : `请求未完成 · ${error.code}`}</p><button className="button secondary" onClick={retry}><RefreshCw size={15} />重试</button></div>;
  return <>{children}</>;
}

function MetricCell({ title, metric, href }: { title: string; metric: Metric; href: string }) {
  return <Link className="metric" to={href}><span className="metric-label">{title}</span><strong>{metricDisplay(metric)}</strong><span className={`source-note ${metric.sourceStatus}`}>{sourceMessage(metric.sourceStatus)}{metric.asOf ? ` · ${absoluteTime(metric.asOf)}` : ''}</span></Link>;
}

export function OverviewPage({ admin }: { admin: Admin }) {
  const resource = useResource<Overview>('/overview');
  return <><PageTitle title="Overview" note="安装、活动和异常概况" action={<span className="scope-pill">{admin.environment}</span>} />
    <Status {...resource}>{resource.data && <><section className="metric-band" aria-label="关键指标">
      <MetricCell title="已安装店铺" metric={resource.data.installedStoreCount} href="/stores?status=installed" />
      <MetricCell title="有效活动" metric={resource.data.activeBundleCount} href="/bundles" />
      {admin.role !== 'Viewer' && <MetricCell title="最近 24 小时错误" metric={resource.data.errorCount} href="/errors" />}
    </section><section className="overview-section"><div className="section-heading"><h2>需要关注</h2><span>按可用数据源更新</span></div><div className="overview-links"><Link to="/stores"><span>商家安装状态</span><ArrowRight size={17} /></Link><Link to="/bundles"><span>Bundle 活动数据</span><ArrowRight size={17} /></Link>{admin.role !== 'Viewer' && <Link to="/errors"><span>应用错误记录</span><ArrowRight size={17} /></Link>}</div></section></>}</Status>
  </>;
}

function Pager({ offset, count, total, onPage }: { offset: number; count: number; total: number; onPage: (value: number) => void }) {
  return <div className="pager"><span>{total ? `${offset + 1}–${offset + count} / ${total}` : '0 条记录'}</span><div><button className="icon-button" title="上一页" aria-label="上一页" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - 25))}><ArrowLeft size={17} /></button><button className="icon-button" title="下一页" aria-label="下一页" disabled={offset + count >= total} onClick={() => onPage(offset + 25)}><ArrowRight size={17} /></button></div></div>;
}

function Empty({ filtered, subject, onClear }: { filtered: boolean; subject: string; onClear?: () => void }) {
  return <div className="empty-state"><strong>{filtered ? `没有符合条件的${subject}` : `暂无${subject}`}</strong><p>{filtered ? '调整搜索或筛选条件后重试。' : '当前数据源尚无记录。'}</p>{filtered && onClear && <button className="button secondary" onClick={onClear}>清除筛选</button>}</div>;
}

export function StoresPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('query') || '';
  const status = params.get('status') || 'all';
  const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  const path = `/stores?${new URLSearchParams({ query, status, offset: String(offset), limit: '25' })}`;
  const resource = useResource<List<Store>>(path);
  const update = (values: Record<string, string>) => { const next = new URLSearchParams(params); Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); if (!('offset' in values)) next.delete('offset'); setParams(next); };
  return <><PageTitle title="Stores" note="按稳定店铺 ID 核查授权与安装周期" />
    <div className="toolbar"><form className="search-box" onSubmit={(event) => { event.preventDefault(); update({ query: draft }); }}><Search size={17} aria-hidden="true" /><label className="sr-only" htmlFor="store-query">搜索店铺</label><input id="store-query" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="店铺名称、域名或 ID" /><button type="submit" aria-label="搜索" title="搜索"><ArrowRight size={17} /></button></form>
      <label className="select-label">安装状态<select value={status} onChange={(event) => update({ status: event.target.value })}><option value="all">全部</option><option value="installed">已安装</option><option value="uninstalled">已卸载</option></select></label></div>
    <Status {...resource}>{resource.data && (resource.data.items.length ? <><div className="table-wrap"><table><thead><tr><th>店铺</th><th>稳定 ID</th><th>安装状态</th><th>安装时间</th><th>最近更新</th><th className="action-col">查看</th></tr></thead><tbody>{resource.data.items.map((store) => <tr key={store.storeId}><td><Link className="table-link" to={`/stores/${encodeURIComponent(store.storeId)}?return=${encodeURIComponent(params.toString())}`}>{store.handle}</Link></td><td className="mono">{store.storeId}</td><td><span className={`badge ${store.status}`}>{store.status === 'installed' ? '已安装' : '已卸载'}</span></td><td>{absoluteTime(store.installedAt)}</td><td>{absoluteTime(store.updatedAt)}</td><td><Link className="row-action" to={`/stores/${encodeURIComponent(store.storeId)}?return=${encodeURIComponent(params.toString())}`}>详情 <ArrowRight size={14} /></Link></td></tr>)}</tbody></table></div>
      <div className="mobile-records">{resource.data.items.map((store) => <Link className="mobile-record" key={store.storeId} to={`/stores/${encodeURIComponent(store.storeId)}?return=${encodeURIComponent(params.toString())}`}><div><strong>{store.handle}</strong><span className={`badge ${store.status}`}>{store.status === 'installed' ? '已安装' : '已卸载'}</span></div><span className="mono">{store.storeId}</span><small>最近更新 {absoluteTime(store.updatedAt)}</small></Link>)}</div>
      <Pager offset={offset} count={resource.data.items.length} total={resource.data.total || 0} onPage={(value) => update({ offset: String(value) })} /></> : <Empty subject="店铺" filtered={Boolean(query || status !== 'all')} onClear={() => setParams({})} />)}</Status>
  </>;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="icon-button copy-button" title={`复制${label}`} aria-label={`复制${label}`} onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } }}><Copy size={15} />{copied && <span className="copy-feedback" role="status">已复制</span>}</button>;
}

export function StoreDetailPage({ admin }: { admin: Admin }) {
  const { storeId = '' } = useParams();
  const [params] = useSearchParams();
  const returnQuery = params.get('return') || '';
  const resource = useResource<Store>(`/stores/${encodeURIComponent(storeId)}`);
  return <><Link className="back-link" to={`/stores${returnQuery ? `?${returnQuery}` : ''}`}><ArrowLeft size={16} />返回 Stores</Link>
    <Status {...resource}>{resource.data && <><PageTitle title={resource.data.handle} note="商家安装与授权详情" action={<span className={`badge ${resource.data.status}`}>{resource.data.status === 'installed' ? '已安装' : '已卸载'}</span>} />
      <section className="detail-section"><h2>店铺身份</h2><dl className="detail-grid"><div><dt>稳定 ID</dt><dd className="mono copy-value">{resource.data.storeId}<CopyButton value={resource.data.storeId} label="店铺 ID" /></dd></div><div><dt>环境</dt><dd>{admin.environment}</dd></div><div><dt>授权范围</dt><dd>{resource.data.scope || '未知'}</dd></div><div><dt>最近同步</dt><dd>{absoluteTime(resource.data.updatedAt)}</dd></div></dl></section>
      <section className="detail-section"><h2>安装周期</h2>{resource.data.installations?.length ? <ol className="timeline">{resource.data.installations.map((cycle, index) => <li key={`${cycle.installedAt}-${index}`}><strong>安装于 {absoluteTime(cycle.installedAt)}</strong><span>{cycle.uninstalledAt ? `卸载于 ${absoluteTime(cycle.uninstalledAt)}` : '当前安装周期'}</span></li>)}</ol> : <p className="muted">暂无安装周期记录。</p>}</section>
      <section className="detail-section"><h2>Bundle 活动</h2><div className="source-callout"><ServerOff size={19} /><div><strong>活动数据源未接入</strong><p>当前暂无可信的活动记录来源。</p></div></div></section>
    </>}</Status>
  </>;
}

export function BundlesPage() {
  const resource = useResource('/bundles');
  return <><PageTitle title="Bundles" note="跨店查看本应用创建的活动" />
    {resource.loading ? <Status {...resource}>{null}</Status> : resource.error?.code === 'SOURCE_UNAVAILABLE' ? <div className="source-callout large" role="status"><ServerOff size={24} /><div><h2>活动数据源未接入</h2><p>当前暂无可信的活动记录来源。</p><button className="button secondary" onClick={resource.retry}><RefreshCw size={15} />重新检查</button></div></div> : <Status {...resource}><Empty subject="活动" filtered={false} /></Status>}
  </>;
}

export function ErrorsPage() {
  const [params, setParams] = useSearchParams();
  const storeId = params.get('storeId') || '';
  const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
  const [draft, setDraft] = useState(storeId);
  const resource = useResource<List<ErrorEvent>>(`/events/errors?${new URLSearchParams({ storeId, offset: String(offset), limit: '25' })}`);
  const update = (values: Record<string, string>) => { const next = new URLSearchParams(params); Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); if (!('offset' in values)) next.delete('offset'); setParams(next); };
  return <><PageTitle title="Errors" note="已采集的脱敏应用错误" /><div className="toolbar"><form className="search-box" onSubmit={(event) => { event.preventDefault(); update({ storeId: draft }); }}><Search size={17} /><label className="sr-only" htmlFor="error-store">按店铺 ID 筛选</label><input id="error-store" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="按店铺 ID 筛选" /><button type="submit" aria-label="筛选" title="筛选"><ArrowRight size={17} /></button></form><span className="toolbar-note">默认显示最近记录 · 内容已脱敏</span></div>
    <Status {...resource}>{resource.data && (resource.data.items.length ? <><div className="table-wrap"><table><thead><tr><th>发生时间</th><th>级别</th><th>类型 / 错误码</th><th>店铺</th><th>Trace ID</th></tr></thead><tbody>{resource.data.items.map((event) => <tr key={event.id}><td>{absoluteTime(event.occurredAt)}</td><td><span className="badge error">{event.severity}</span></td><td><strong>{event.kind}</strong><small className="cell-sub">{event.code}</small></td><td>{event.storeId ? <Link className="table-link mono" to={`/stores/${encodeURIComponent(event.storeId)}`}>{event.storeId}</Link> : '无法关联'}</td><td className="mono copy-value">{event.traceId || '无'}{event.traceId && <CopyButton value={event.traceId} label="Trace ID" />}</td></tr>)}</tbody></table></div><div className="mobile-records">{resource.data.items.map((event) => <article className="mobile-record" key={event.id}><div><strong>{event.code}</strong><span className="badge error">{event.severity}</span></div><small>{event.kind} · {absoluteTime(event.occurredAt)}</small><span>{event.storeId || '无法关联店铺'}</span></article>)}</div><Pager offset={offset} count={resource.data.items.length} total={resource.data.total || 0} onPage={(value) => update({ offset: String(value) })} /></> : <Empty subject="错误记录" filtered={Boolean(storeId)} onClear={() => { setDraft(''); setParams({}); }} />)}</Status>
  </>;
}

export function AuditPage() {
  const resource = useResource<List<AuditEvent>>('/audit-events?limit=25&offset=0');
  return <><PageTitle title="Audit" note="管理员访问和操作记录" /><Status {...resource}>{resource.data && (resource.data.items.length ? <><div className="table-wrap"><table><thead><tr><th>时间</th><th>管理员</th><th>动作</th><th>对象</th><th>结果</th><th>Request ID</th></tr></thead><tbody>{resource.data.items.map((event) => <tr key={event.id}><td>{absoluteTime(event.occurredAt)}</td><td className="mono">{event.actorId || '未知'}</td><td>{event.action}</td><td className="mono">{event.targetId || '—'}</td><td>{event.result}</td><td className="mono">{event.requestId}</td></tr>)}</tbody></table></div><div className="mobile-records">{resource.data.items.map((event) => <article className="mobile-record" key={event.id}><strong>{event.action}</strong><small>{absoluteTime(event.occurredAt)} · {event.result}</small><span className="mono">{event.targetId || '无对象'}</span></article>)}</div></> : <Empty subject="审计记录" filtered={false} />)}</Status></>;
}

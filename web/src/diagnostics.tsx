import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Copy, RefreshCw, Search, X } from 'lucide-react';
import { api, ApiError, type Diagnostic, type List } from './api';
import { absoluteTime } from './state';
import { canViewDiagnosticResponse, formatDiagnosticResponseBody } from '../../shared/campaign-presentation.mjs';
import { RefreshButton } from './refresh-button';

const eventLabel: Record<string, string> = {
  shopline_api: '调用 SHOPLINE 接口', worker_error: '应用 Worker 异常', campaign_pause: '暂停活动',
  campaign_platform_delete: '删除 SHOPLINE 自动折扣', campaign_read: '查询活动',
};

function merchantLabel(item: Diagnostic): string { return item.shopHandle || '未识别商家'; }

function useDiagnostics(path: string) {
  const [data, setData] = useState<List<Diagnostic> | null>(null); const [error, setError] = useState<ApiError | null>(null); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true); setError(null);
    api<List<Diagnostic>>(path).then((next) => { if (live) setData(next); }).catch((cause) => { if (live) setError(cause instanceof ApiError ? cause : new ApiError(503, 'SOURCE_UNAVAILABLE')); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, revision]);
  return { data, error, loading, retry: () => setRevision((value) => value + 1) };
}

function ResponseButton({ body, open }: { body: string | null; open: (body: string) => void }) {
  return body && canViewDiagnosticResponse(body) ? <button className="row-action" onClick={() => open(body)}>查看完整响应 <ArrowRight size={14} /></button> : null;
}

export function DiagnosticsPage() {
  const [params, setParams] = useSearchParams(); const [trace, setTrace] = useState(params.get('traceId') || ''); const [selectedResponse, setSelectedResponse] = useState<string | null>(null); const [copyNotice, setCopyNotice] = useState('');
  const query = new URLSearchParams({ traceId: params.get('traceId') || '', storeId: params.get('storeId') || '', campaignId: params.get('campaignId') || '', outcome: params.get('outcome') || '', from: params.get('from') || '', to: params.get('to') || '', limit: '100', offset: '0' }); const resource = useDiagnostics(`/diagnostics?${query}`);
  const update = (values: Record<string, string>) => { const next = new URLSearchParams(params); Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); setParams(next); };
  const openResponse = (body: string) => { setSelectedResponse(formatDiagnosticResponseBody(body)); setCopyNotice(''); };
  const copyResponse = async () => { if (!selectedResponse) return; try { await navigator.clipboard.writeText(selectedResponse); setCopyNotice('已复制'); } catch { setCopyNotice('复制失败'); } };
  const rows = resource.data?.items || [];
  return <>
    <div className="page-title"><div><h1>诊断</h1><p>D1 业务诊断事件保留 30 天；仅保存脱敏后的 SHOPLINE 响应详情。</p></div><RefreshButton loading={resource.loading} onRefresh={resource.retry} /></div>
    <div className="diagnostic-toolbar"><form className="search-box" onSubmit={(event) => { event.preventDefault(); update({ traceId: trace.trim() }); }}><Search size={17} /><label className="sr-only" htmlFor="trace-id">应用 Trace ID</label><input id="trace-id" value={trace} onChange={(event) => setTrace(event.target.value)} placeholder="按应用 Trace ID 查询" /><button type="submit" aria-label="查询 Trace ID" title="查询"><ArrowRight size={17} /></button></form><label className="field-inline">商家 ID<input value={params.get('storeId') || ''} onChange={(event) => update({ storeId: event.target.value })} placeholder="商家 ID" /></label><label className="field-inline">活动 ID<input value={params.get('campaignId') || ''} onChange={(event) => update({ campaignId: event.target.value })} placeholder="活动 ID" /></label><label className="select-label">结果<select value={params.get('outcome') || ''} onChange={(event) => update({ outcome: event.target.value })}><option value="">全部结果</option><option value="failure">失败</option><option value="uncertain">待确认</option><option value="success">成功</option></select></label></div>
    {resource.loading ? <div className="loading-panel" role="status"><div className="skeleton-line wide" /></div> : resource.error ? <div className="state-block" role="alert"><AlertTriangle size={23} /><h2>诊断数据暂不可用</h2><p>{resource.error.code}</p><button className="button" onClick={resource.retry}><RefreshCw size={15} />重试</button></div> : rows.length ? <><div className="table-wrap"><table className="diagnostic-table"><thead><tr><th>发生时间</th><th>结果</th><th>商家 / 活动</th><th>事件</th><th>SHOPLINE 调用</th><th>响应摘要</th><th>应用 Trace ID</th><th>SHOPLINE TraceID</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{absoluteTime(item.occurredAt)}</td><td><span className={`badge diagnostic-${item.outcome}`}>{item.outcome === 'uncertain' ? '待确认' : item.outcome === 'failure' ? '失败' : '成功'}</span></td><td>{item.storeId ? <Link className="table-link" to={`/campaigns?storeId=${encodeURIComponent(item.storeId)}`}>{merchantLabel(item)}</Link> : merchantLabel(item)}<small className="cell-sub mono">{item.campaignId || '无活动'}</small></td><td>{eventLabel[item.eventType] || item.eventType}<small className="cell-sub">{item.errorCode || '—'}</small></td><td className="mono">{item.upstreamPath || '—'}<small className="cell-sub">{item.upstreamService || '—'}</small></td><td>{item.upstreamStatus ?? '—'}{item.durationMs !== null ? <small className="cell-sub">{item.durationMs} ms</small> : null}<small className="cell-sub mono">{item.upstreamResponseCode || '—'}</small><small className="cell-sub">{item.upstreamResponseMessage || '未提供安全响应摘要'}</small><ResponseButton body={item.upstreamResponseBody} open={openResponse} /></td><td className="mono">{item.traceId}</td><td className="mono">{item.upstreamRequestId || '—'}</td></tr>)}</tbody></table></div><div className="mobile-records">{rows.map((item) => <article className="mobile-record" key={item.id}><div><strong>{eventLabel[item.eventType] || item.eventType}</strong><span className={`badge diagnostic-${item.outcome}`}>{item.outcome === 'uncertain' ? '待确认' : item.outcome === 'failure' ? '失败' : '成功'}</span></div><small>{merchantLabel(item)} · {item.campaignId || '无活动'}</small><small>{absoluteTime(item.occurredAt)} · {item.errorCode || '无错误摘要'}</small><small className="mono">{item.upstreamPath || '无 SHOPLINE 调用'}</small><small>{item.upstreamStatus ?? '—'} · {item.upstreamResponseCode || '—'} · {item.upstreamResponseMessage || '未提供安全响应摘要'}</small><ResponseButton body={item.upstreamResponseBody} open={openResponse} /><span className="mono">应用 Trace ID：{item.traceId}</span><span className="mono">SHOPLINE TraceID：{item.upstreamRequestId || '—'}</span></article>)}</div></> : <div className="empty-state"><strong>没有匹配的诊断事件</strong><p>可按应用 Trace ID、商家 ID、活动 ID 或处理结果筛选。</p></div>}
    {selectedResponse && <div className="dialog-backdrop" role="presentation"><section className="confirm-dialog response-dialog" role="dialog" aria-modal="true" aria-labelledby="response-dialog-title"><div className="dialog-heading"><div><h2 id="response-dialog-title">SHOPLINE 完整响应</h2><p>已脱敏，保留用于本次诊断排障。</p></div><button className="icon-button" aria-label="关闭响应详情" title="关闭" onClick={() => setSelectedResponse(null)}><X size={17} /></button></div><pre className="response-body">{selectedResponse}</pre><div className="dialog-actions"><span className="copy-notice" role="status">{copyNotice}</span><button className="button" onClick={copyResponse}><Copy size={15} />复制</button><button className="button" onClick={() => setSelectedResponse(null)}>关闭</button></div></section></div>}
  </>;
}

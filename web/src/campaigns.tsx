import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, PauseCircle, RefreshCw, Search, X } from 'lucide-react';
import { api, ApiError, type Admin, type Campaign, type CampaignStatus, type List } from './api';
import { absoluteTime } from './state';

function useCampaignResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<ApiError | null>(null); const [loading, setLoading] = useState(Boolean(path)); const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let live = true;
    setLoading(true); setError(null);
    api<T>(path)
      .then((next) => { if (live) setData(next); })
      .catch((cause) => { if (live) setError(cause instanceof ApiError ? cause : new ApiError(503, 'SOURCE_UNAVAILABLE')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, revision]);
  return { data, error, loading, retry: () => setRevision((value) => value + 1) };
}

const labels: Record<CampaignStatus, string> = { draft: '草稿', active: '启用', scheduled: '计划中', paused: '已暂停', ended: '已结束' };
const canPause = (status: CampaignStatus) => status === 'active' || status === 'scheduled';
const scopeText = (campaign: Campaign) => campaign.scope.kind === 'products' ? `指定商品 · ${(campaign.scope.productIds || []).length} 个` : campaign.scope.kind === 'collections' ? `指定集合 · ${(campaign.scope.collectionIds || []).length} 个` : '全部商品';

function PageState({ loading, error, retry, children }: { loading: boolean; error: ApiError | null; retry: () => void; children: React.ReactNode }) {
  if (loading) return <div className="loading-panel" role="status"><div className="skeleton-line wide" /><div className="skeleton-line" /></div>;
  if (error) return <div className="state-block" role="alert"><AlertTriangle size={23} /><h2>{error.code === 'SOURCE_UNAVAILABLE' ? '活动数据暂不可用' : '活动请求未完成'}</h2><p>{error.code}</p><button className="button" onClick={retry}><RefreshCw size={15} />重试</button></div>;
  return <>{children}</>;
}

export function CampaignsPage() {
  const [params, setParams] = useSearchParams(); const storeId = params.get('storeId') || ''; const status = params.get('status') || 'all'; const [draft, setDraft] = useState(storeId);
  useEffect(() => setDraft(storeId), [storeId]);
  const resource = useCampaignResource<List<Campaign>>(storeId ? `/campaigns?${new URLSearchParams({ storeId, limit: '100', offset: '0' })}` : null);
  const items = (resource.data?.items || []).filter((item) => status === 'all' || item.status === status);
  const update = (values: Record<string, string>) => { const next = new URLSearchParams(params); Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); setParams(next); };
  return <><div className="page-title"><div><h1>活动与排障</h1><p>按商家查看多件优惠活动、配置版本与异常处理。</p></div><Link className="button" to="/diagnostics">查看诊断</Link></div>
    <div className="campaign-toolbar"><form className="search-box" onSubmit={(event) => { event.preventDefault(); update({ storeId: draft.trim() }); }}><Search size={17} /><label className="sr-only" htmlFor="campaign-store">商家稳定 ID</label><input id="campaign-store" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="输入商家稳定 ID" /><button type="submit" aria-label="查询活动" title="查询活动"><ArrowRight size={17} /></button></form><label className="select-label">状态<select value={status} onChange={(event) => update({ status: event.target.value })}><option value="all">全部状态</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{storeId && <span className="scope-pill">商家 {storeId}</span>}</div>
    {!storeId ? <div className="empty-state"><strong>选择一个商家后查看活动</strong><p>使用稳定商家 ID 查询实时活动与配置。</p></div> : <PageState {...resource}>{resource.data && (items.length ? <><div className="table-wrap"><table className="campaign-table"><thead><tr><th>活动</th><th>状态</th><th>范围</th><th>折扣档位</th><th>版本</th><th>最近更新</th><th>查看</th></tr></thead><tbody>{items.map((campaign) => <tr key={campaign.id}><td><strong>{campaign.name}</strong><small className="cell-sub mono">{campaign.id}</small></td><td><span className={`badge campaign-${campaign.status}`}>{labels[campaign.status]}</span></td><td>{scopeText(campaign)}</td><td>{campaign.tiers.length} 档</td><td className="mono">r{campaign.revision}</td><td>{absoluteTime(campaign.updatedAt)}</td><td><Link className="row-action" to={`/campaigns/${encodeURIComponent(campaign.id)}?storeId=${encodeURIComponent(storeId)}`}>详情 <ArrowRight size={14} /></Link></td></tr>)}</tbody></table></div><div className="mobile-records">{items.map((campaign) => <Link className="mobile-record" key={campaign.id} to={`/campaigns/${encodeURIComponent(campaign.id)}?storeId=${encodeURIComponent(storeId)}`}><div><strong>{campaign.name}</strong><span className={`badge campaign-${campaign.status}`}>{labels[campaign.status]}</span></div><small>{scopeText(campaign)} · {campaign.tiers.length} 档 · r{campaign.revision}</small><span className="mono">{campaign.id}</span></Link>)}</div></> : <div className="empty-state"><strong>没有符合条件的活动</strong><p>调整状态筛选或检查商家 ID。</p></div>)}</PageState>}</>;
}

export function CampaignDetailPage({ admin }: { admin: Admin }) {
  const { id = '' } = useParams(); const [params] = useSearchParams(); const storeId = params.get('storeId') || ''; const resource = useCampaignResource<{ campaign: Campaign }>(storeId && id ? `/campaigns/${encodeURIComponent(id)}?storeId=${encodeURIComponent(storeId)}` : null);
  const [confirming, setConfirming] = useState(false); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const campaign = resource.data?.campaign;
  const pause = async () => { if (!campaign) return; setBusy(true); setNotice(''); try { await api(`/campaigns/${encodeURIComponent(campaign.id)}/pause`, { method: 'POST', headers: { 'x-csrf-token': admin.csrfToken }, body: JSON.stringify({ storeId, expectedRevision: campaign.revision, ...(reason.trim() ? { reason: reason.trim() } : {}) }) }); setConfirming(false); setReason(''); setNotice('暂停成功，正在刷新活动状态。'); resource.retry(); } catch (cause) { setNotice(cause instanceof ApiError && cause.code === 'CAMPAIGN_CONFLICT' ? '活动版本已变化，请刷新后确认。' : '暂停结果待确认，请用 Trace ID 在诊断页核查。'); } finally { setBusy(false); } };
  if (!storeId) return <div className="state-block"><h2>缺少商家 ID</h2><Link to="/campaigns">返回活动列表</Link></div>;
  return <><Link className="back-link" to={`/campaigns?storeId=${encodeURIComponent(storeId)}`}><ArrowLeft size={16} />返回活动列表</Link><PageState {...resource}>{campaign && <><div className="page-title"><div><h1>{campaign.name}</h1><p className="mono">{campaign.id}</p></div><div className="title-status"><span className={`badge campaign-${campaign.status}`}>{labels[campaign.status]}</span>{canPause(campaign.status) && <button className="button destructive" onClick={() => setConfirming(true)}><PauseCircle size={16} />紧急暂停</button>}</div></div>{notice && <div className="campaign-notice" role="status">{notice}</div>}
    <section className="detail-section"><h2>活动状态</h2><dl className="detail-grid"><div><dt>商家 ID</dt><dd className="mono">{storeId}</dd></div><div><dt>当前版本</dt><dd>r{campaign.revision}</dd></div><div><dt>开始时间</dt><dd>{campaign.startsAt ? absoluteTime(campaign.startsAt) : '立即生效'}</dd></div><div><dt>结束时间</dt><dd>{campaign.endsAt ? absoluteTime(campaign.endsAt) : '无结束时间'}</dd></div><div><dt>最后更新</dt><dd>{absoluteTime(campaign.updatedAt)}</dd></div><div><dt>暂停原因</dt><dd>{campaign.pauseReason || '无'}</dd></div></dl></section>
    <section className="detail-section"><h2>适用范围</h2><dl className="detail-grid"><div><dt>范围</dt><dd>{scopeText(campaign)}</dd></div><div><dt>排除商品</dt><dd>{campaign.scope.excludedProductIds.length ? campaign.scope.excludedProductIds.join('、') : '无'}</dd></div>{campaign.scope.productIds && <div><dt>商品 ID</dt><dd className="mono">{campaign.scope.productIds.join('、')}</dd></div>}{campaign.scope.collectionIds && <div><dt>集合 ID</dt><dd className="mono">{campaign.scope.collectionIds.join('、')}</dd></div>}</dl></section>
    <section className="detail-section"><h2>折扣档位</h2><div className="table-wrap"><table><thead><tr><th>数量</th><th>折扣类型</th><th>数值</th><th>名称</th><th>推荐</th></tr></thead><tbody>{campaign.tiers.map((tier) => <tr key={tier.tierId}><td>{tier.quantity} 件</td><td>{tier.discountType}</td><td>{tier.discountValue ?? '—'}</td><td>{tier.label || tier.tag || '—'}</td><td>{tier.recommended ? '是' : '否'}</td></tr>)}</tbody></table></div></section>
    {confirming && <div className="dialog-backdrop" role="presentation"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="pause-title"><div className="dialog-heading"><div><h2 id="pause-title">确认紧急暂停</h2><p>将暂停 {campaign.name}（r{campaign.revision}），并请求 SHOPLINE 撤销对应自动折扣。</p></div><button className="icon-button" aria-label="关闭确认框" title="关闭" disabled={busy} onClick={() => setConfirming(false)}><X size={17} /></button></div><label className="dialog-field">处理原因（可选）<textarea value={reason} maxLength={300} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="例如：排查异常折扣结果" /></label><div className="dialog-actions"><button className="button" disabled={busy} onClick={() => setConfirming(false)}>取消</button><button className="button destructive" disabled={busy} onClick={pause}>{busy ? '正在暂停…' : '确认暂停活动'}</button></div></section></div>}</>}</PageState></>;
}

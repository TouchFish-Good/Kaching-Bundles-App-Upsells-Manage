import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, PauseCircle, PlayCircle, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { api, ApiError, type Admin, type Campaign, type CampaignStatus, type List } from './api';
import { absoluteTime } from './state';
import { campaignCombinationDisplay, campaignListPath, campaignScopeResourceUrl, campaignTierDisplay, coverageConflictNotice, specifiedMarketAmountDisplays } from '../../shared/campaign-presentation.mjs';
import { RefreshButton } from './refresh-button';
import { storeUrl } from './store-presentation';

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
  return { data, error, loading, update: setData, retry: () => setRevision((value) => value + 1) };
}

const labels: Record<CampaignStatus, string> = { draft: '草稿', active: '生效', expired: '已失效' };
const canPause = (campaign: Campaign) => campaign.status === 'active' && campaign.platformDiscountState === 'active';
const canActivate = (campaign: Campaign) => campaign.status === 'expired' && !campaign.activationPending;
const canDeletePlatform = (campaign: Campaign) => campaign.platformDiscountState === 'active' || campaign.platformDiscountState === 'paused';
const scopeText = (campaign: Campaign) => campaign.scope.kind === 'products' ? `指定商品 · ${(campaign.scope.productIds || []).length} 个` : campaign.scope.kind === 'collections' ? `指定集合 · ${(campaign.scope.collectionIds || []).length} 个` : '全部商品';

function MerchantLink({ handle }: { handle: string | undefined }) {
  return handle ? <a className="table-link" href={`${storeUrl(handle)}/`} target="_blank" rel="noopener noreferrer" title={`打开 ${handle}.myshopline.com`}>{handle}</a> : <>—</>;
}

function ScopeResourceLinks({ storeHandle, kind, ids, handles }: { storeHandle: string | undefined; kind: 'products' | 'collections'; ids: string[]; handles: Record<string, string> | undefined }) {
  return <span className="scope-resource-links">{ids.map((id) => {
    const handle = handles?.[id];
    const href = campaignScopeResourceUrl(storeHandle, kind, id, handle);
    return <span key={id}>{href ? <a href={href} target="_blank" rel="noreferrer">{id} {handle}</a> : id}</span>;
  })}</span>;
}

function PageState({ loading, error, retry, children }: { loading: boolean; error: ApiError | null; retry: () => void; children: React.ReactNode }) {
  if (loading) return <div className="loading-panel" role="status"><div className="skeleton-line wide" /><div className="skeleton-line" /></div>;
  if (error) return <div className="state-block" role="alert"><AlertTriangle size={23} /><h2>{error.code === 'SOURCE_UNAVAILABLE' ? '活动数据暂不可用' : '活动请求未完成'}</h2><p>{error.code}</p><button className="button" onClick={retry}><RefreshCw size={15} />重试</button></div>;
  return <>{children}</>;
}

export function CampaignsPage() {
  const [params, setParams] = useSearchParams(); const storeId = params.get('storeId') || ''; const status = params.get('status') || 'all'; const query = params.get('query') || ''; const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  const resource = useCampaignResource<List<Campaign>>(`/campaigns?${new URLSearchParams({ ...(storeId ? { storeId } : {}), ...(query ? { query } : {}), ...(status !== 'all' ? { status } : {}), limit: '100', offset: '0' })}`);
  const items = resource.data?.items || [];
  const update = (values: Record<string, string>) => { const next = new URLSearchParams(params); Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); setParams(next); };
  return <><div className="page-title"><div><h1>活动与排障</h1><p>跨商家查看多件优惠活动、配置版本与异常处理。</p></div><div className="page-actions"><RefreshButton loading={resource.loading} onRefresh={resource.retry} /><Link className="button" to="/diagnostics">查看诊断</Link></div></div>
    <div className="campaign-toolbar"><form className="search-box" onSubmit={(event) => { event.preventDefault(); update({ query: draft.trim() }); }}><Search size={17} /><label className="sr-only" htmlFor="campaign-query">搜索商家或活动</label><input id="campaign-query" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="搜索商家 handle、ID 或活动名称" /><button type="submit" aria-label="查询活动" title="查询活动"><ArrowRight size={17} /></button></form><label className="select-label">状态<select value={status} onChange={(event) => update({ status: event.target.value })}><option value="all">全部状态</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{storeId && <span className="scope-pill">商家 {storeId}</span>}</div>
    <PageState {...resource}>{resource.data && (items.length ? <><div className="table-wrap"><table className="campaign-table"><thead><tr><th>活动</th><th>商家</th><th>状态</th><th>平台折扣</th><th>范围</th><th>档位</th><th>版本</th><th>最近更新</th><th>查看</th></tr></thead><tbody>{items.map((campaign) => <tr key={`${campaign.storeId}-${campaign.id}`}><td><strong>{campaign.name}</strong><small className="cell-sub mono">{campaign.id}</small></td><td><strong><MerchantLink handle={campaign.shopHandle} /></strong><small className="cell-sub mono">{campaign.storeId || '—'}</small></td><td><span className={`badge campaign-${campaign.status}`}>{campaign.activationPending ? '待确认' : labels[campaign.status]}</span></td><td>{campaign.platformDiscountState === 'active' ? '启用' : campaign.platformDiscountState === 'paused' ? '已暂停' : campaign.platformDiscountState === 'removed' ? '已删除' : '无'}</td><td>{scopeText(campaign)}</td><td>{campaign.tiers.length} 档</td><td className="mono">r{campaign.revision}</td><td>{absoluteTime(campaign.updatedAt)}</td><td><Link className="row-action" to={`/campaigns/${encodeURIComponent(campaign.id)}?storeId=${encodeURIComponent(campaign.storeId || storeId)}`}>详情 <ArrowRight size={14} /></Link></td></tr>)}</tbody></table></div><div className="mobile-records">{items.map((campaign) => <article className="mobile-record" key={`${campaign.storeId}-${campaign.id}`}><div><strong><Link to={`/campaigns/${encodeURIComponent(campaign.id)}?storeId=${encodeURIComponent(campaign.storeId || storeId)}`}>{campaign.name}</Link></strong><span className={`badge campaign-${campaign.status}`}>{campaign.activationPending ? '待确认' : labels[campaign.status]}</span></div><small><MerchantLink handle={campaign.shopHandle} /> · {scopeText(campaign)}</small><span className="mono">{campaign.id}</span><Link className="row-action" to={`/campaigns/${encodeURIComponent(campaign.id)}?storeId=${encodeURIComponent(campaign.storeId || storeId)}`}>详情 <ArrowRight size={14} /></Link></article>)}</div></> : <div className="empty-state"><strong>没有符合条件的活动</strong><p>调整搜索或状态筛选后重试。</p></div>)}</PageState></>;
}

export function CampaignDetailPage({ admin }: { admin: Admin }) {
  const navigate = useNavigate();
  const { id = '' } = useParams(); const [params] = useSearchParams(); const storeId = params.get('storeId') || ''; const resource = useCampaignResource<{ campaign: Campaign }>(storeId && id ? `/campaigns/${encodeURIComponent(id)}?storeId=${encodeURIComponent(storeId)}` : null);
  const [confirming, setConfirming] = useState<'pause' | 'activate' | 'delete' | null>(null); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const campaign = resource.data?.campaign;
  useEffect(() => {
    if (!campaign?.activationPending || !storeId || !id) return;
    let cancelled = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<{ campaign: Campaign }>(`/campaigns/${encodeURIComponent(id)}?storeId=${encodeURIComponent(storeId)}`);
        if (cancelled) return;
        resource.update(next);
        if (!next.campaign.activationPending) {
          setNotice(next.campaign.status === 'active' && next.campaign.platformDiscountState === 'active' ? '活动已启动。' : '活动状态已更新，请核对详情。');
          return;
        }
      } catch { /* Keep the pending result; a read failure never resends a create. */ }
      if (cancelled) return;
      if (Date.now() - startedAt >= 60_000) { setNotice('活动启动结果仍待确认，请稍后刷新或查看诊断。'); return; }
      timer = setTimeout(poll, Date.now() - startedAt < 10_000 ? 2_000 : 5_000);
    };
    timer = setTimeout(poll, 2_000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, storeId, campaign?.activationPending]);
  const runAction = async () => {
    if (!campaign || !confirming || busy) return;
    setBusy(true); setNotice('');
    const operation = confirming === 'pause' ? 'pause' : confirming === 'activate' ? 'activate' : 'platform-delete';
    try {
      const result = await api<{ campaign: Campaign; outcome?: string }>(`/campaigns/${encodeURIComponent(campaign.id)}/${operation}`, { method: 'POST', headers: { 'x-csrf-token': admin.csrfToken }, body: JSON.stringify({ storeId, expectedRevision: campaign.revision, ...(reason.trim() ? { reason: reason.trim() } : {}) }) });
      setConfirming(null); setReason('');
      setNotice(operation === 'pause' ? '已暂停活动。' : operation === 'activate' ? result.outcome === 'activation_pending' || result.campaign.activationPending ? '正在确认活动启动结果。' : '活动已启动。' : '已删除 SHOPLINE 自动折扣，应用活动配置仍保留。');
      if (operation === 'activate') {
        resource.update({ campaign: { ...campaign, ...result.campaign } });
        if (result.campaign.id !== id) navigate(`/campaigns/${encodeURIComponent(result.campaign.id)}?storeId=${encodeURIComponent(storeId)}`, { replace: true });
        else resource.retry();
      } else resource.retry();
    } catch (cause) {
      const conflictDetails = cause instanceof ApiError && cause.details && typeof cause.details === 'object' && Array.isArray((cause.details as { conflicts?: unknown }).conflicts) ? (cause.details as { conflicts: unknown[] }).conflicts : null;
      setNotice(cause instanceof ApiError && cause.code === 'CAMPAIGN_SCOPE_CONFLICT' ? coverageConflictNotice(conflictDetails) : cause instanceof ApiError && cause.status === 409 ? '活动已发生变化，请关闭确认框并刷新后重试。' : '结果待确认，请使用诊断页 Trace ID 核查。');
    } finally { setBusy(false); }
  };
  if (!storeId) return <div className="state-block"><h2>缺少商家 ID</h2><Link to="/campaigns">返回活动列表</Link></div>;
  return <><Link className="back-link" to={campaignListPath()}><ArrowLeft size={16} />返回活动列表</Link><PageState {...resource}>{campaign && <><div className="page-title"><div><h1>{campaign.name}</h1><p className="mono"><MerchantLink handle={campaign.shopHandle} /> · {campaign.id}</p></div><div className="title-status"><RefreshButton loading={resource.loading} onRefresh={resource.retry} /><span className={`badge campaign-${campaign.status}`}>{campaign.activationPending ? '待确认' : labels[campaign.status]}</span>{canPause(campaign) && <button className="button destructive" onClick={() => setConfirming('pause')}><PauseCircle size={16} />暂停</button>}{canActivate(campaign) && <button className="button" onClick={() => setConfirming('activate')}><PlayCircle size={16} />启动</button>}{canDeletePlatform(campaign) && <button className="button destructive" onClick={() => setConfirming('delete')}><Trash2 size={16} />删除平台折扣</button>}</div></div>{notice && <div className="campaign-notice" role="status">{notice}</div>}
    <section className="detail-section"><h2>活动状态</h2><dl className="detail-grid campaign-info-grid"><div><dt>商家 ID</dt><dd className="mono">{storeId}</dd></div><div><dt>当前版本</dt><dd>r{campaign.revision}</dd></div><div><dt>开始时间</dt><dd>{campaign.startsAt ? absoluteTime(campaign.startsAt) : '立即生效'}</dd></div><div><dt>结束时间</dt><dd>{campaign.endsAt ? absoluteTime(campaign.endsAt) : '无结束时间'}</dd></div><div><dt>最后更新</dt><dd>{absoluteTime(campaign.updatedAt)}</dd></div><div><dt>暂停原因</dt><dd>{campaign.pauseReason || '无'}</dd></div></dl></section>
    <section className="detail-section"><h2>折扣信息</h2><dl className="detail-grid campaign-info-grid"><div><dt>活动名称</dt><dd>{campaign.name}</dd></div><div><dt>折扣名称（购物车/结账）</dt><dd>{campaign.discountName || campaign.name}</dd></div>{campaignCombinationDisplay(campaign.combinesWith).map((combination) => <div key={combination.label}><dt>{combination.label}</dt><dd>{combination.value}</dd></div>)}</dl></section>
    <section className="detail-section"><h2>适用范围</h2><dl className="detail-grid scope-detail-grid"><div><dt>范围</dt><dd>{scopeText(campaign)}</dd></div><div><dt>排除商品</dt><dd>{campaign.scope.excludedProductIds.length ? <ScopeResourceLinks storeHandle={campaign.shopHandle} kind="products" ids={campaign.scope.excludedProductIds} handles={campaign.scope.productHandles} /> : '无'}</dd></div>{campaign.scope.productIds && <div><dt>商品</dt><dd className="mono"><ScopeResourceLinks storeHandle={campaign.shopHandle} kind="products" ids={campaign.scope.productIds} handles={campaign.scope.productHandles} /></dd></div>}{campaign.scope.collectionIds && <div><dt>集合</dt><dd className="mono"><ScopeResourceLinks storeHandle={campaign.shopHandle} kind="collections" ids={campaign.scope.collectionIds} handles={campaign.scope.collectionHandles} /></dd></div>}</dl></section>
    <section className="detail-section"><h2>折扣档位</h2><div className="table-wrap"><table><thead><tr><th>数量</th><th>折扣类型</th><th>数值</th><th>名称</th><th>指定市场金额</th><th>推荐</th></tr></thead><tbody>{campaign.tiers.map((tier) => { const display = campaignTierDisplay(tier); const marketAmounts = specifiedMarketAmountDisplays(tier.marketOverrides); return <tr key={tier.tierId}><td>{tier.quantity} 件</td><td>{display.type}</td><td>{display.value}</td><td>{tier.label || tier.tag || '—'}</td><td>{marketAmounts.length ? <div className="market-amounts">{marketAmounts.map((market) => <div className="market-amount" key={market.marketId}><strong>{market.marketName}</strong><span className="mono">ID: {market.marketId}</span><span>{market.value}</span></div>)}</div> : '—'}</td><td>{tier.recommended ? '是' : '否'}</td></tr>; })}</tbody></table></div><div className="mobile-records campaign-tier-records">{campaign.tiers.map((tier) => { const display = campaignTierDisplay(tier); const marketAmounts = specifiedMarketAmountDisplays(tier.marketOverrides); return <article className="campaign-tier-record" key={tier.tierId}><div><strong>{tier.quantity} 件 · {display.type}</strong><span>{display.value}</span></div><dl><div><dt>名称</dt><dd>{tier.label || tier.tag || '—'}</dd></div><div><dt>推荐</dt><dd>{tier.recommended ? '是' : '否'}</dd></div><div><dt>指定市场金额</dt><dd>{marketAmounts.length ? <div className="market-amounts">{marketAmounts.map((market) => <div className="market-amount" key={market.marketId}><strong>{market.marketName}</strong><span className="mono">ID: {market.marketId}</span><span>{market.value}</span></div>)}</div> : '—'}</dd></div></dl></article>; })}</div></section>
    {confirming && <div className="dialog-backdrop" role="presentation"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="campaign-action-title"><div className="dialog-heading"><div><h2 id="campaign-action-title">{confirming === 'pause' ? '确认暂停' : confirming === 'activate' ? '确认启动' : '确认删除平台折扣'}</h2><p>{confirming === 'pause' ? `将停用同一个 SHOPLINE 自动折扣，活动配置保留。` : confirming === 'activate' ? '按应用现有启动流程重新发布活动，并核验平台结果。' : '将删除 SHOPLINE 自动折扣，应用中的活动配置继续保留。'}</p></div><button className="icon-button" aria-label="关闭确认框" title="关闭" disabled={busy} onClick={() => setConfirming(null)}><X size={17} /></button></div><label className="dialog-field">处理原因（可选）<textarea value={reason} maxLength={300} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="例如：排查异常折扣结果" /></label><div className="dialog-actions"><button className="button" disabled={busy} onClick={() => setConfirming(null)}>取消</button><button className="button destructive" disabled={busy} onClick={runAction}>{busy ? '正在处理…' : '确认'}</button></div></section></div>}</>}</PageState></>;
}

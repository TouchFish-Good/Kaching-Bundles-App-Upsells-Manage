import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, MessageSquare, Search, Send, ShieldAlert, Trash2 } from 'lucide-react';
import { api, ApiError, type Admin, type Feedback, type FeedbackComment, type FeedbackDetail, type FeedbackList, type FeedbackStatus, type List } from './api';
import { absoluteTime } from './state.ts';
import { canChangeStatus, commentFiltersPath, commentManagementHeaders, commentSourceLabel, displayStatus } from '../../shared/feedback-presentation.mjs';
import { RefreshButton } from './refresh-button';

function useFeedbackResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    api<T>(path).then((result) => { if (active) setData(result); }).catch((cause) => { if (active) setError(cause instanceof ApiError ? cause : new ApiError(503, 'SOURCE_UNAVAILABLE')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, revision]);
  return { data, setData, error, loading, refresh: () => setRevision((value) => value + 1) };
}

function FeedbackBadge({ feedback }: { feedback: Pick<Feedback, 'status' | 'displayStatus'> }) {
  const status = displayStatus(feedback);
  return <span className={`badge feedback-${status.tone}`}>{status.label}</span>;
}

function FeedbackLoading() { return <div className="loading-panel" role="status"><div className="skeleton-line wide" /><div className="skeleton-line medium" /><div className="skeleton-line" /></div>; }

function FeedbackError({ error, retry }: { error: ApiError; retry: () => void }) {
  return <div className="state-block" role="alert"><ShieldAlert size={24} /><h2>{error.code === 'SOURCE_UNAVAILABLE' ? '商家数据暂不可用' : '加载失败'}</h2><p>请求未完成 · {error.code}</p><button className="button" onClick={retry}>重试</button></div>;
}

const actions: Array<{ label: string; status: FeedbackStatus; hide?: boolean }> = [
  { label: '批准', status: 'approved' }, { label: '标记开发中', status: 'in_progress' }, { label: '标记已上线', status: 'released' },
  { label: '拒绝', status: 'rejected' }, { label: '拒绝显示', status: 'rejected', hide: true },
];

export function FeedbackPage() {
  const [params, setParams] = useSearchParams();
  const [keyword, setKeyword] = useState(params.get('query') ?? '');
  const [store, setStore] = useState(params.get('store') ?? '');
  const offset = Number(params.get('offset') ?? '0');
  const path = useMemo(() => `/feedback?${new URLSearchParams({ ...Object.fromEntries(params.entries()), limit: '25', offset: String(offset) })}`, [params, offset]);
  const resource = useFeedbackResource<FeedbackList>(path);
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    setParams((current) => { const next = new URLSearchParams(current); keyword.trim() ? next.set('query', keyword.trim()) : next.delete('query'); store.trim() ? next.set('store', store.trim()) : next.delete('store'); next.set('offset', '0'); return next; });
  };
  const filter = (key: string, value: string) => setParams((current) => { const next = new URLSearchParams(current); value ? next.set(key, value) : next.delete(key); next.set('offset', '0'); return next; });
  const results = resource.data;
  return <>
    <div className="page-title"><div><h1>需求与建议</h1><p>审核商家建议、官方回复与评论内容</p></div><RefreshButton loading={resource.loading} onRefresh={resource.refresh} /></div>
    <form className="feedback-toolbar" onSubmit={apply}>
      <label className="search-box"><Search size={16} aria-hidden="true" /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索标题或内容" aria-label="搜索标题或内容" /></label>
      <label className="select-label">状态<select value={params.get('status') ?? ''} onChange={(event) => filter('status', event.target.value)}><option value="">全部</option><option value="pending">待审核</option><option value="approved">已批准</option><option value="in_progress">开发中</option><option value="released">已上线</option><option value="rejected">已拒绝</option></select></label>
      <label className="select-label">生命周期<select value={params.get('display') ?? ''} onChange={(event) => filter('display', event.target.value)}><option value="">全部</option><option value="visible">商家可见</option><option value="rejected_hidden">拒绝显示</option><option value="withdrawn">已撤回</option></select></label>
      <label className="select-label">排序<select value={params.get('sort') ?? 'newest'} onChange={(event) => filter('sort', event.target.value)}><option value="newest">最新发布</option><option value="comments">评论最多</option><option value="votes">投票最多</option></select></label>
      <label className="checkbox-label"><input type="checkbox" checked={params.get('replied') === '1'} onChange={(event) => filter('replied', event.target.checked ? '1' : '')} />官方已回复</label>
      <label className="field-inline">商家<input value={store} onChange={(event) => setStore(event.target.value)} placeholder="handle 或店铺 ID" /></label>
      <label className="field-inline">起始<input type="date" value={params.get('from') ?? ''} onChange={(event) => filter('from', event.target.value)} /></label>
      <label className="field-inline">结束<input type="date" value={params.get('to') ?? ''} onChange={(event) => filter('to', event.target.value)} /></label>
      <button className="button primary" type="submit"><Search size={15} />搜索</button>
    </form>
    {resource.loading ? <FeedbackLoading /> : resource.error ? <FeedbackError error={resource.error} retry={resource.refresh} /> : results && (results.items.length ? <>
      <div className="table-wrap"><table className="feedback-table"><thead><tr><th>建议</th><th>商家</th><th>状态</th><th>互动</th><th>创建时间</th><th className="action-col">查看</th></tr></thead><tbody>{results.items.map((feedback) => <tr key={feedback.id}><td><strong>{feedback.title}</strong><small className="cell-sub clamp-copy">{feedback.excerpt}</small></td><td><strong>{feedback.handle}</strong><small className="cell-sub mono">{feedback.storeId}{feedback.isAnonymous ? ' · 匿名发布' : ''}</small></td><td><FeedbackBadge feedback={feedback} /></td><td><span className="mono">{feedback.voteCount}</span><small className="cell-sub">{feedback.commentCount} 条评论{feedback.hasOfficialReply ? ' · 已回复' : ''}</small></td><td>{absoluteTime(feedback.createdAt)}</td><td><Link className="row-action" to={`/feedback/${feedback.id}?return=${encodeURIComponent(params.toString())}`}>详情 <ArrowRight size={14} /></Link></td></tr>)}</tbody></table></div>
      <div className="mobile-records feedback-mobile-records">{results.items.map((feedback) => <Link className="mobile-record" key={feedback.id} to={`/feedback/${feedback.id}?return=${encodeURIComponent(params.toString())}`}><div><strong>{feedback.title}</strong><FeedbackBadge feedback={feedback} /></div><span>{feedback.handle}{feedback.isAnonymous ? ' · 匿名发布' : ''}</span><small>{absoluteTime(feedback.createdAt)} · {feedback.commentCount} 条评论</small></Link>)}</div>
      <div className="pager"><span>共 {results.total} 条</span><div><button className="icon-button" title="上一页" aria-label="上一页" disabled={offset === 0} onClick={() => filter('offset', String(Math.max(0, offset - 25)))}><ArrowLeft size={16} /></button><button className="icon-button" title="下一页" aria-label="下一页" disabled={results.items.length < 25} onClick={() => filter('offset', String(offset + 25))}><ArrowRight size={16} /></button></div></div>
    </> : <div className="empty-state"><strong>暂无建议</strong><p>调整筛选条件后再试。</p></div>) }
  </>;
}

export function FeedbackCommentsPage({ admin }: { admin: Admin }) {
  const [params, setParams] = useSearchParams();
  const query = params.get('query') ?? '';
  const store = params.get('store') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const path = commentFiltersPath({ query, store, from, to, offset: params.get('offset') ?? '0' });
  const resource = useFeedbackResource<List<FeedbackComment>>(path);
  const [draft, setDraft] = useState(query);
  const [busy, setBusy] = useState(false);
  const apply = (event: React.FormEvent) => { event.preventDefault(); const next = new URLSearchParams(params); draft.trim() ? next.set('query', draft.trim()) : next.delete('query'); next.delete('offset'); setParams(next); };
  const remove = async (comment: FeedbackComment) => { if (!window.confirm('确定删除这条评论？')) return; setBusy(true); try { await api(`/feedback/${encodeURIComponent(comment.feedbackId)}/comments/${encodeURIComponent(comment.id)}`, { method: 'DELETE', headers: { 'x-csrf-token': admin.csrfToken }, body: JSON.stringify({ reason: '开发者后台删除' }) }); resource.refresh(); } finally { setBusy(false); } };
  return <><div className="page-title"><div><h1>评论管理</h1><p>查看全部评论、所属建议和匿名标记。</p></div><RefreshButton loading={resource.loading} onRefresh={resource.refresh} /></div><form className="feedback-toolbar" onSubmit={apply}><label className="search-box"><Search size={16} aria-hidden="true" /><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="搜索评论、建议标题或 handle" aria-label="搜索评论" /></label><label className="field-inline">商家<input value={store} onChange={(event) => { const next = new URLSearchParams(params); event.target.value ? next.set('store', event.target.value) : next.delete('store'); next.delete('offset'); setParams(next); }} placeholder="handle 或店铺 ID" /></label><label className="field-inline">起始<input type="date" value={from} onChange={(event) => { const next = new URLSearchParams(params); event.target.value ? next.set('from', event.target.value) : next.delete('from'); next.delete('offset'); setParams(next); }} /></label><label className="field-inline">结束<input type="date" value={to} onChange={(event) => { const next = new URLSearchParams(params); event.target.value ? next.set('to', event.target.value) : next.delete('to'); next.delete('offset'); setParams(next); }} /></label><button className="button primary" type="submit"><Search size={15} />搜索</button></form>{resource.loading ? <FeedbackLoading /> : resource.error ? <FeedbackError error={resource.error} retry={resource.refresh} /> : resource.data && (resource.data.items.length ? <div className="table-wrap"><table className="feedback-table"><thead><tr>{commentManagementHeaders.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{resource.data.items.map((comment) => <tr key={comment.id}><td><strong>{comment.content}</strong></td><td><strong>{comment.authorHandle}</strong></td><td>{comment.isAnonymous ? '是' : '否'}</td><td>{comment.isDeleted ? <span className="badge rejected">已删除</span> : <span className="badge approved">正常</span>}</td><td>{absoluteTime(comment.createdAt)}</td><td><Link className="table-link" to={`/feedback/${encodeURIComponent(comment.feedbackId)}`}>{commentSourceLabel(comment)}</Link></td><td>{!comment.isDeleted && <button className="icon-button" title="删除评论" aria-label="删除评论" disabled={busy} onClick={() => void remove(comment)}><Trash2 size={15} /></button>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>暂无评论</strong><p>当前筛选没有评论记录。</p></div>)}</>;
}

export function FeedbackDetailPage({ admin }: { admin: Admin }) {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const resource = useFeedbackResource<FeedbackDetail>(`/feedback/${encodeURIComponent(id)}`);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const write = async (path: string, method: 'PATCH' | 'POST' | 'DELETE', body: Record<string, unknown>) => {
    setBusy(true); setNotice('');
    try { await api(path, { method, headers: { 'x-csrf-token': admin.csrfToken }, body: JSON.stringify(body) }); setNotice('操作已保存。'); resource.refresh(); }
    catch (cause) { setNotice(`操作失败 · ${cause instanceof ApiError ? cause.code : 'REQUEST_FAILED'}`); }
    finally { setBusy(false); }
  };
  const feedback = resource.data;
  const changeStatus = (status: FeedbackStatus, hide = false) => { if (feedback && (hide ? window.confirm('确定将此建议设为拒绝显示？商家将无法再查看。') : true)) void write(`/feedback/${feedback.id}/status`, 'PATCH', { status, ...(hide ? { hideFromMerchants: true } : {}) }); };
  return <><Link className="back-link" to={`/feedback${params.get('return') ? `?${params.get('return')}` : ''}`}><ArrowLeft size={16} />返回需求与建议</Link>
    {resource.loading ? <FeedbackLoading /> : resource.error ? <FeedbackError error={resource.error} retry={resource.refresh} /> : feedback && <>
      <div className="page-title feedback-detail-title"><div><div className="title-status"><h1>{feedback.title}</h1><FeedbackBadge feedback={feedback} /></div><p>{feedback.handle} · {feedback.storeId}{feedback.isAnonymous ? ' · 匿名发布' : ''}</p></div><RefreshButton loading={resource.loading} onRefresh={resource.refresh} /></div>
      {notice && <p className="feedback-notice" role="status">{notice}</p>}
      <section className="detail-section"><h2>建议内容</h2><p className="feedback-content">{feedback.content}</p><dl className="detail-grid feedback-meta"><div><dt>创建时间</dt><dd>{absoluteTime(feedback.createdAt)}</dd></div><div><dt>最近更新</dt><dd>{absoluteTime(feedback.updatedAt)}</dd></div><div><dt>投票 / 评论</dt><dd>{feedback.voteCount} / {feedback.commentCount}</dd></div><div><dt>商家可见性</dt><dd>{feedback.displayStatus === 'rejected_hidden' || feedback.displayStatus === 'withdrawn' ? '不可见' : '可见'}</dd></div></dl></section>
      <section className="detail-section"><h2>审核操作</h2>{canChangeStatus(feedback) ? <div className="feedback-actions">{actions.map((action) => <button key={`${action.status}-${action.hide ?? false}`} className={`button ${action.hide ? 'destructive' : ''}`} disabled={busy} onClick={() => changeStatus(action.status, action.hide)}>{action.label}</button>)}</div> : <p className="muted">商家已撤回，此记录不可再变更。</p>}</section>
      <section className="detail-section"><h2>状态历史</h2>{feedback.statusHistory.length ? <ol className="timeline">{feedback.statusHistory.map((entry) => <li key={entry.id}><strong>{displayStatus({ status: entry.nextStatus, displayStatus: entry.nextStatus }).label}</strong><span>{absoluteTime(entry.createdAt)}{entry.note ? ` · ${entry.note}` : ''}</span></li>)}</ol> : <p className="muted">暂无状态记录。</p>}</section>
      <section className="detail-section"><h2>官方回复</h2>{feedback.replies.length ? <div className="feedback-thread">{feedback.replies.map((item) => <article key={item.id}><div><strong>多件折扣</strong><span className="official-mark">官方</span></div><p>{item.content}</p><small>{absoluteTime(item.createdAt)}</small></article>)}</div> : null}{canChangeStatus(feedback) && feedback.displayStatus !== 'pending' && <form className="feedback-reply" onSubmit={async (event) => { event.preventDefault(); if (!reply.trim()) return; setBusy(true); try { const result = await api<{ reply: FeedbackDetail['replies'][number] }>(`/feedback/${feedback.id}/replies`, { method: 'POST', headers: { 'x-csrf-token': admin.csrfToken }, body: JSON.stringify({ content: reply.trim() }) }); resource.setData({ ...feedback, replies: [...feedback.replies, result.reply], hasOfficialReply: true }); setReply(''); setNotice('官方回复已发布。'); resource.refresh(); } catch (cause) { setNotice(`操作失败 · ${cause instanceof ApiError ? cause.code : 'REQUEST_FAILED'}`); } finally { setBusy(false); } }}><textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={5000} placeholder="以多件折扣身份发布官方回复" aria-label="官方回复内容" /><button className="button primary" disabled={busy || !reply.trim()}><Send size={15} />发布官方回复</button></form>}</section>
      <section className="detail-section"><h2>评论</h2>{feedback.comments.length ? <div className="feedback-thread">{feedback.comments.map((comment) => <article key={comment.id} className={comment.isDeleted ? 'deleted-comment' : ''}><div><strong>{comment.authorHandle}</strong>{comment.isAnonymous && <span className="anonymous-mark">匿名</span>}{comment.isDeleted && <span className="deleted-mark">已删除</span>}</div><p>{comment.content}</p><small>{absoluteTime(comment.createdAt)}{comment.deletionReason ? ` · 删除原因：${comment.deletionReason}` : ''}</small>{!comment.isDeleted && <button className="icon-button comment-delete" title="删除评论" aria-label="删除评论" disabled={busy} onClick={() => { if (window.confirm('确定删除这条评论？此操作不可恢复。')) { const reason = window.prompt('删除原因（可选）'); void write(`/feedback/${feedback.id}/comments/${comment.id}`, 'DELETE', reason ? { reason } : {}); } }}><Trash2 size={15} /></button>}</article>)}</div> : <div className="empty-inline"><MessageSquare size={16} />暂无评论</div>}</section>
    </>}
  </>;
}

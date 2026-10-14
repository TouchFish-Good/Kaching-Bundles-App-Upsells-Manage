import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { Copy, Plus, ShieldCheck, UserX, X } from 'lucide-react';
import { api, ApiError, type Admin, type AdminUser, type List, type Role } from './api';
import { absoluteTime } from './state.ts';

export function ActivationPage() {
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
  const [details, setDetails] = useState<{ email: string; role: Role; mfaSecret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'invalid' | 'done'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    window.history.replaceState(null, '', '/activate');
    if (!token) { setStatus('invalid'); return; }
    api<{ email: string; role: Role; mfaSecret: string; otpauthUrl: string }>('/auth/invitation', { method: 'POST', body: JSON.stringify({ token }) })
      .then(async (value) => { setDetails(value); setQr(await QRCode.toDataURL(value.otpauthUrl, { width: 176, margin: 1 })); setStatus('ready'); })
      .catch(() => setStatus('invalid'));
  }, [token]);
  const activate = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/auth/activate', { method: 'POST', body: JSON.stringify({ token, password, code }) }); setStatus('done'); setPassword(''); }
    catch (cause) { setError(cause instanceof ApiError && cause.code === 'INVITATION_NOT_FOUND' ? '邀请已失效，请联系管理员。' : '激活失败，请检查密码和验证码。'); }
    finally { setBusy(false); }
  };
  return <main className="login-wrap"><div className="login-brand"><span className="brand-mark">K</span><div><strong>Kaching</strong><span>Developer Admin</span></div></div><section className="login-panel activation-panel">
    {status === 'loading' && <p role="status">正在验证邀请…</p>}
    {status === 'invalid' && <><h1>邀请无效</h1><p className="form-note">链接已过期或已经使用。</p><button className="button secondary" onClick={() => navigate('/')}>返回登录</button></>}
    {status === 'done' && <><ShieldCheck size={28} color="#0f766e" /><h1>账号已激活</h1><p className="form-note">现在可以使用密码和身份验证器登录。</p><button className="button primary" onClick={() => navigate('/')}>前往登录</button></>}
    {status === 'ready' && details && <><p className="eyebrow">管理员邀请</p><h1>设置账号</h1><p className="form-note">{details.email} · {details.role}</p><div className="mfa-setup"><strong>关联身份验证器</strong>{qr && <img src={qr} width="176" height="176" alt="身份验证器设置二维码" />}<small>无法扫描时输入密钥：</small><code>{details.mfaSecret}</code></div>
      <form onSubmit={activate}><label htmlFor="new-password">设置密码</label><input id="new-password" type="password" minLength={12} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 12 个字符" /><label htmlFor="activation-code">验证码</label><input id="activation-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value)} />{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full" disabled={busy}>{busy ? '激活中…' : '激活账号'}</button></form></>}
  </section></main>;
}

export function AdministratorsPage({ admin }: { admin: Admin }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('Viewer');
  const [invitationUrl, setInvitationUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [disableTarget, setDisableTarget] = useState<AdminUser | null>(null);
  const refresh = () => { setLoading(true); api<List<AdminUser>>('/admin-users').then((data) => { setUsers(data.items); setError(''); }).catch(() => setError('管理员列表暂不可用。')).finally(() => setLoading(false)); };
  useEffect(refresh, []);
  const invite = async (event: React.FormEvent) => {
    event.preventDefault(); setPending(true); setError('');
    try {
      const result = await api<{ token: string }>('/admin-users/invitations', { method: 'POST', headers: { 'x-csrf-token': admin.csrfToken }, body: JSON.stringify({ email, role }) });
      setInvitationUrl(`${window.location.origin}/activate#token=${encodeURIComponent(result.token)}`);
      refresh();
    } catch { setError('邀请失败，请检查邮箱是否已使用。'); }
    finally { setPending(false); }
  };
  const disable = async () => {
    if (!disableTarget) return; setPending(true); setError('');
    try { await api(`/admin-users/${encodeURIComponent(disableTarget.id)}/disable`, { method: 'POST', headers: { 'x-csrf-token': admin.csrfToken } }); setDisableTarget(null); refresh(); }
    catch (cause) { setError(cause instanceof ApiError && cause.code === 'LAST_OWNER' ? '不能停用最后一个 Owner。' : '停用失败，请稍后重试。'); }
    finally { setPending(false); }
  };
  return <><div className="page-title"><div><h1>Administrators</h1><p>内部账号与访问角色</p></div><button className="button primary" onClick={() => { setInviteOpen(true); setInvitationUrl(''); setError(''); }}><Plus size={16} />邀请管理员</button></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {loading ? <div className="loading-panel" role="status">正在加载管理员…</div> : <div className="table-wrap"><table><thead><tr><th>邮箱</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.email}</td><td>{user.role}</td><td><span className={`badge ${user.status === 'active' ? 'installed' : 'uninstalled'}`}>{user.status === 'active' ? '已启用' : '已停用'}</span></td><td>{absoluteTime(user.createdAt)}</td><td>{user.status === 'active' && <button className="row-button danger" onClick={() => setDisableTarget(user)}><UserX size={14} />停用</button>}</td></tr>)}</tbody></table></div>}
    <div className="mobile-records">{users.map((user) => <article className="mobile-record" key={user.id}><div><strong>{user.email}</strong><span>{user.role}</span></div><small>{user.status === 'active' ? '已启用' : '已停用'} · {absoluteTime(user.createdAt)}</small>{user.status === 'active' && <button className="row-button danger" onClick={() => setDisableTarget(user)}>停用</button>}</article>)}</div>
    {inviteOpen && <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setInviteOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="invite-title"><button className="icon-button modal-close" aria-label="关闭" title="关闭" onClick={() => setInviteOpen(false)}><X size={17} /></button><h2 id="invite-title">邀请管理员</h2>{invitationUrl ? <><p>邀请链接将在 24 小时后失效，且只能使用一次。</p><div className="invitation-link">{invitationUrl}</div><button className="button primary" onClick={() => navigator.clipboard.writeText(invitationUrl)}><Copy size={15} />复制邀请链接</button></> : <form onSubmit={invite}><label htmlFor="invite-email">邮箱</label><input id="invite-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /><label htmlFor="invite-role">角色</label><select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as Role)}><option value="Viewer">Viewer · 只读概览与商家</option><option value="Operator">Operator · 排障与错误</option><option value="Owner">Owner · 管理管理员</option></select><button className="button primary" disabled={pending}>生成邀请链接</button></form>}</section></div>}
    {disableTarget && <div className="modal-scrim"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="disable-title"><h2 id="disable-title">停用管理员？</h2><p>{disableTarget.email} 的所有会话将立即失效。</p><div className="modal-actions"><button className="button secondary" onClick={() => setDisableTarget(null)}>取消</button><button className="button danger-button" disabled={pending} onClick={disable}>停用</button></div></section></div>}
    <p className="admin-footnote">管理员操作会写入 <Link to="/audit">Audit</Link>。</p>
  </>;
}

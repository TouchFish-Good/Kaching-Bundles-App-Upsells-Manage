import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Activity, ChevronDown, ClipboardList, LayoutDashboard, LogOut, Menu, Package, ShieldCheck, Store as StoreIcon, X } from 'lucide-react';
import { api, ApiError, type Admin } from './api';
import { AuditPage, BundlesPage, ErrorsPage, OverviewPage, StoreDetailPage, StoresPage } from './pages';

function Login({ onReady }: { onReady: (admin: Admin) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      setPassword('');
      onReady(await api<Admin>('/auth/me'));
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 429 ? '尝试次数过多，请稍后再试。' : '登录失败，请核对账号和密码。');
    } finally { setBusy(false); }
  };
  return <main className="login-wrap"><div className="login-brand"><span className="brand-mark">K</span><div><strong>Kaching</strong><span>Developer Admin</span></div></div>
    <section className="login-panel"><p className="eyebrow">Owner access</p><h1>登录管理后台</h1>
      <form onSubmit={submit} noValidate>
        <label htmlFor="email">邮箱</label><input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">密码</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary full" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
      </form>
    </section>
  </main>;
}

function Shell({ admin, onLogout }: { admin: Admin; onLogout: () => Promise<void> }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const items = [
    { to: '/overview', label: 'Overview', icon: LayoutDashboard },
    { to: '/stores', label: 'Stores', icon: StoreIcon },
    { to: '/bundles', label: 'Bundles', icon: Package },
    { to: '/errors', label: 'Errors', icon: Activity },
    { to: '/audit', label: 'Audit', icon: ClipboardList },
  ];
  return <div className="shell">
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <Link to="/overview" className="brand"><span className="brand-mark">K</span><span><strong>Kaching</strong><small>Developer Admin</small></span></Link>
      <div className="nav-label">WORKSPACE</div><nav aria-label="主导航">{items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={17} aria-hidden="true" />{label}</NavLink>)}</nav>
      <div className="sidebar-foot"><ShieldCheck size={16} aria-hidden="true" /><span>Owner 内部访问</span></div>
    </aside>
    {menuOpen && <button className="menu-scrim" onClick={() => setMenuOpen(false)} aria-label="关闭导航" />}
    <div className="main-column"><header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? '关闭导航' : '打开导航'} title="导航">{menuOpen ? <X size={19} /> : <Menu size={19} />}</button>
      <div className="topbar-crumb">Kaching <span>/</span> {items.find((item) => location.pathname.startsWith(item.to))?.label || 'Workspace'}</div>
      <div className="topbar-right"><span className="environment"><span className="environment-dot" />{admin.environment}</span><span className="account">{admin.email}<ChevronDown size={14} aria-hidden="true" /></span><button className="icon-button" aria-label="退出登录" title="退出登录" onClick={onLogout}><LogOut size={17} /></button></div>
    </header><main className="content"><Routes>
      <Route path="/overview" element={<OverviewPage admin={admin} />} />
      <Route path="/stores" element={<StoresPage />} />
      <Route path="/stores/:storeId" element={<StoreDetailPage admin={admin} />} />
      <Route path="/bundles" element={<BundlesPage />} />
      <Route path="/errors" element={<ErrorsPage />} />
      <Route path="/audit" element={<AuditPage />} />
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="*" element={<div className="state-block"><h1>页面不存在</h1><Link to="/overview">返回 Overview</Link></div>} />
    </Routes></main></div>
  </div>;
}

export default function App() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api<Admin>('/auth/me').then(setAdmin).catch(() => setAdmin(null)).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="boot-loading" role="status">正在载入管理后台…</div>;
  if (!admin) return <Login onReady={setAdmin} />;
  const logout = async () => { try { await api('/auth/logout', { method: 'POST', headers: { 'x-csrf-token': admin.csrfToken } }); } finally { setAdmin(null); } };
  return <Shell admin={admin} onLogout={logout} />;
}

import { AnimatePresence, motion } from 'framer-motion';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage, mins } from '../lib/api';
import { useSite } from '../lib/site';
import { ErrorNote, PageLoader, Spinner } from '../components/ui';
import { AuthContext, PageHeader, ToastProvider, useAuth, useLoad, type AdminUser } from './kit';

const Bookings = lazy(() => import('./Bookings'));
const ServicesAdmin = lazy(() => import('./Services'));
const GalleryAdmin = lazy(() => import('./Gallery'));
const { ContentAdmin, SettingsAdmin, TestimonialsAdmin, PromotionsAdmin, SocialAdmin, InquiriesAdmin, CustomersAdmin, UsersAdmin, AnalyticsAdmin } = {
  ContentAdmin: lazy(() => import('./Pages').then((m) => ({ default: m.ContentAdmin }))),
  SettingsAdmin: lazy(() => import('./Pages').then((m) => ({ default: m.SettingsAdmin }))),
  TestimonialsAdmin: lazy(() => import('./Pages').then((m) => ({ default: m.TestimonialsAdmin }))),
  PromotionsAdmin: lazy(() => import('./Pages').then((m) => ({ default: m.PromotionsAdmin }))),
  SocialAdmin: lazy(() => import('./Pages').then((m) => ({ default: m.SocialAdmin }))),
  InquiriesAdmin: lazy(() => import('./Pages').then((m) => ({ default: m.InquiriesAdmin }))),
  CustomersAdmin: lazy(() => import('./Pages').then((m) => ({ default: m.CustomersAdmin }))),
  UsersAdmin: lazy(() => import('./Pages').then((m) => ({ default: m.UsersAdmin }))),
  AnalyticsAdmin: lazy(() => import('./Pages').then((m) => ({ default: m.AnalyticsAdmin }))),
};

function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => { if (user) nav('/admin', { replace: true }); }, [user, nav]);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const f = new FormData(e.currentTarget);
    try {
      if (forgot) { await api.post('/auth/forgot', { email: f.get('email') }); setSent(true); } else await login(String(f.get('email')), String(f.get('password')));
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-screen place-items-center bg-blush/40 px-4">
      <motion.form initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} onSubmit={submit} className="w-full max-w-sm space-y-4 bg-paper p-8 shadow-xl">
        <p className="eyebrow text-center">Admin</p><h1 className="text-center text-4xl">{forgot ? 'Reset password' : 'Sign in'}</h1>
        {sent ? <p className="text-center text-sm text-charcoal/70" role="status">If that email has an account, a reset link is on its way.</p> : (<>
          <div><label className="label" htmlFor="l-email">Email</label><input id="l-email" name="email" type="email" required autoComplete="username" className="input" /></div>
          {!forgot && <div><label className="label" htmlFor="l-pw">Password</label><input id="l-pw" name="password" type="password" required autoComplete="current-password" className="input" /></div>}
          <ErrorNote message={err} /><button className="btn btn-solid w-full" disabled={busy}>{busy ? <Spinner /> : forgot ? 'Send reset link' : 'Sign in'}</button></>)}
        <button type="button" className="block w-full text-center text-xs text-charcoal/55 hover:text-gold" onClick={() => { setForgot(!forgot); setSent(false); setErr(null); }}>{forgot ? 'Back to sign in' : 'Forgot password?'}</button>
      </motion.form>
    </div>
  );
}

function ResetPassword() {
  const [params] = useSearchParams();
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { await api.post('/auth/reset', { token: params.get('token'), password: pw }); setMsg({ ok: true, text: 'Password updated. You can sign in now.' }); } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
  };
  return (
    <div className="grid min-h-screen place-items-center bg-blush/40 px-4"><form onSubmit={submit} className="w-full max-w-sm space-y-4 bg-paper p-8 shadow-xl">
      <h1 className="text-center text-4xl">New password</h1>
      <div><label className="label" htmlFor="np">New password</label><input id="np" type="password" minLength={10} required className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /><p className="mt-1 text-xs text-charcoal/50">At least 10 characters with letters and numbers.</p></div>
      {msg && (msg.ok ? <p role="status" className="text-sm">{msg.text} <Link className="text-gold underline" to="/admin/login">Sign in</Link></p> : <ErrorNote message={msg.text} />)}
      <button className="btn btn-solid w-full">Update password</button></form></div>
  );
}

const NAV: { to: string; label: string; perm?: string; icon: string }[] = [
  { to: '/admin', label: 'Dashboard', icon: '◧' },
  { to: '/admin/bookings', label: 'Bookings', perm: 'bookings', icon: '▦' },
  { to: '/admin/inquiries', label: 'Inquiries', perm: 'inquiries', icon: '✉' },
  { to: '/admin/customers', label: 'Customers', perm: 'customers', icon: '☺' },
  { to: '/admin/services', label: 'Services', perm: 'services', icon: '✦' },
  { to: '/admin/gallery', label: 'Gallery & Studio', perm: 'gallery', icon: '▣' },
  { to: '/admin/content', label: 'Website content', perm: 'content', icon: '✎' },
  { to: '/admin/testimonials', label: 'Testimonials', perm: 'testimonials', icon: '❝' },
  { to: '/admin/promotions', label: 'Promotions', perm: 'promotions', icon: '%' },
  { to: '/admin/social', label: 'Social media', perm: 'social', icon: '@' },
  { to: '/admin/analytics', label: 'Analytics', perm: 'analytics', icon: '↗' },
  { to: '/admin/settings', label: 'Settings', perm: 'settings', icon: '⚙' },
  { to: '/admin/users', label: 'Users & audit', perm: 'users', icon: '♟' },
];

function Shell() {
  const { user, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  if (!user) return <Navigate to="/admin/login" replace />;
  const items = NAV.filter((n) => !n.perm || can(n.perm));
  const side = (
    <nav className="flex h-full flex-col" aria-label="Admin">
      <p className="px-5 py-6 font-heading text-2xl">Studio admin</p>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2">{items.map((n) => (
        <li key={n.to}><NavLink to={n.to} end={n.to === '/admin'} className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${isActive ? 'bg-charcoal text-paper' : 'hover:bg-nude'}`}><span aria-hidden className="w-4 text-center opacity-70">{n.icon}</span>{n.label}</NavLink></li>))}</ul>
      <div className="border-t border-charcoal/10 p-4 text-xs"><p className="truncate font-medium">{user.name}</p><p className="truncate text-charcoal/55">{user.role}</p>
        <div className="mt-3 flex gap-3"><a href="/" target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">View site ↗</a><button onClick={logout} className="hover:text-rose">Sign out</button></div></div>
    </nav>
  );
  return (
    <div className="min-h-screen bg-ivory lg:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-charcoal/10 bg-paper lg:block">{side}</aside>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-charcoal/10 bg-paper px-4 lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="grid h-10 w-10 place-items-center text-xl">☰</button><span className="font-heading text-xl">Studio admin</span><span className="w-10" />
      </header>
      <AnimatePresence>{open && (<motion.div className="fixed inset-0 z-40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="absolute inset-0 bg-charcoal/40" onClick={() => setOpen(false)} />
        <motion.aside initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }} transition={{ type: 'spring', stiffness: 340, damping: 34 }} className="absolute inset-y-0 left-0 w-64 bg-paper">{side}</motion.aside></motion.div>)}</AnimatePresence>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10"><Suspense fallback={<PageLoader />}><Outlet /></Suspense></main>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return <div className="admin-card p-4"><p className="text-[11px] uppercase tracking-[0.14em] text-charcoal/50">{label}</p><p className="mt-1 font-heading text-4xl">{value}</p>{sub && <p className="text-xs text-charcoal/50">{sub}</p>}</div>;
}

function Dashboard() {
  const { user } = useAuth();
  const { money } = useSite();
  const { data, error, loading } = useLoad<any>('/admin/dashboard');
  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} />;
  const b = data.bookings;
  return (
    <div>
      <PageHeader title={`Welcome, ${user!.name.split(' ')[0]}`} sub={`Today is ${data.today}`} />
      {b && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today" value={b.today} sub="appointments" /><Stat label="Upcoming" value={b.upcoming} /><Stat label="Awaiting confirmation" value={b.pending} />
        <Stat label="Confirmed" value={b.confirmed} /><Stat label="Closed" value={b.completed} /><Stat label="All bookings" value={b.total} />
        <Stat label="Revenue" value={money(b.revenue_cents)} sub="closed / paid" /><Stat label="Pipeline" value={money(b.pipeline_cents)} sub="confirmed, unpaid" /></div>}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {data.todaysAppointments && <section className="admin-card p-5"><h2 className="mb-3 text-2xl">Today's schedule</h2>
          {!data.todaysAppointments.length ? <p className="text-sm text-charcoal/55">No appointments today.</p> : <ul className="divide-y divide-charcoal/10">{data.todaysAppointments.map((a: any) => <li key={a.id} className="flex justify-between gap-3 py-2.5 text-sm"><span><strong>{mins(a.start_min)}</strong> {a.customer_name}<span className="block text-xs text-charcoal/55">{a.service_names}</span></span><span className="badge h-fit">{a.status.replace(/_/g, ' ')}</span></li>)}</ul>}</section>}
        {data.recentInquiries && <section className="admin-card p-5"><div className="mb-3 flex items-center justify-between"><h2 className="text-2xl">Recent inquiries</h2><Link to="/admin/inquiries" className="text-xs text-gold">{data.inquiries.pending} new</Link></div>
          {!data.recentInquiries.length ? <p className="text-sm text-charcoal/55">No inquiries yet.</p> : <ul className="divide-y divide-charcoal/10">{data.recentInquiries.map((i: any) => <li key={i.id} className="py-2.5 text-sm"><strong>{i.name}</strong> <span className="text-charcoal/50">{i.service_interest}</span><p className="line-clamp-1 text-charcoal/65">{i.message}</p></li>)}</ul>}</section>}
        {data.popularServices && <section className="admin-card p-5"><h2 className="mb-3 text-2xl">Popular services</h2>
          {!data.popularServices.length ? <p className="text-sm text-charcoal/55">Appears once bookings arrive.</p> : <ul className="space-y-2">{data.popularServices.map((s: any) => <li key={s.name} className="flex justify-between text-sm"><span>{s.name}</span><span className="font-medium">{s.count}</span></li>)}</ul>}</section>}
        {data.gallery && <section className="admin-card p-5"><h2 className="mb-3 text-2xl">Gallery</h2><p className="text-sm">{data.gallery.images} images · {data.gallery.views} total views</p></section>}
      </div>
    </div>
  );
}

export default function AdminApp() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(() => api.get('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setReady(true)), []);
  useEffect(() => { refresh(); }, [refresh]);
  const ctx = useMemo(() => ({
    user, ready,
    login: async (email: string, password: string) => { const r = await api.post('/auth/login', { email, password }); setUser(r.user); },
    logout: async () => { await api.post('/auth/logout'); setUser(null); },
    can: (p: string) => !!user && (user.permissions.includes('*') || user.permissions.includes(p)),
  }), [user, ready]);
  if (!ready) return <PageLoader />;
  return (
    <AuthContext.Provider value={ctx}><ToastProvider>
      <Routes>
        <Route path="login" element={<Login />} /><Route path="reset" element={<ResetPassword />} />
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} /><Route path="bookings" element={<Bookings />} /><Route path="services" element={<ServicesAdmin />} /><Route path="gallery" element={<GalleryAdmin />} />
          <Route path="content" element={<ContentAdmin />} /><Route path="testimonials" element={<TestimonialsAdmin />} /><Route path="promotions" element={<PromotionsAdmin />} /><Route path="social" element={<SocialAdmin />} />
          <Route path="inquiries" element={<InquiriesAdmin />} /><Route path="customers" element={<CustomersAdmin />} /><Route path="settings" element={<SettingsAdmin />} /><Route path="users" element={<UsersAdmin />} /><Route path="analytics" element={<AnalyticsAdmin />} />
        </Route>
      </Routes>
    </ToastProvider></AuthContext.Provider>
  );
}

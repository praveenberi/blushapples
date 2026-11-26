import { useEffect, useState } from 'react';
import { api, errorMessage, mins, toMins } from '../lib/api';
import { applyTheme, useSite } from '../lib/site';
import { ErrorNote, Modal, PageLoader, Spinner } from '../components/ui';
import { Bool, Fields, PageHeader, ResourceManager, SettingsForm, useAuth, useLoad, useToast, type FieldDef } from './kit';

const Tabs = <T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) => (
  <div className="mb-5 flex flex-wrap gap-1 border-b border-charcoal/10" role="tablist">{tabs.map(([t, l]) => <button key={t} role="tab" aria-selected={value === t} onClick={() => onChange(t)} className={`-mb-px border-b-2 px-4 py-2 text-xs uppercase tracking-widest ${value === t ? 'border-gold' : 'border-transparent text-charcoal/50 hover:text-charcoal'}`}>{l}</button>)}</div>
);

/* ============================== content ============================== */
const SECTION_TYPES: [string, string][] = [['hero', 'Hero'], ['featured_gallery', 'Featured gallery'], ['services', 'Popular services'], ['before_after', 'Before & after'], ['story', 'Brand story'], ['testimonials', 'Testimonials'], ['promotions', 'Promotions'], ['instagram', 'Instagram / social'], ['contact', 'Contact'], ['text', 'Text block'], ['image_text', 'Image + text'], ['list', 'List (qualifications, awards)']];
const has = (...types: string[]) => (v: any) => types.includes(v.type);
const sectionFields: FieldDef[] = [
  { key: 'type', label: 'Section type', type: 'select', options: SECTION_TYPES, half: true }, { key: 'name', label: 'Internal name', half: true },
  { key: 'visible', label: 'Visibility', type: 'bool', help: 'Show this section on the website' },
  { key: 'content.eyebrow', label: 'Small heading above', half: true, show: (v) => v.type !== 'list' }, { key: 'content.heading', label: 'Heading' },
  { key: 'content.body', label: 'Text', type: 'textarea', show: (v) => v.type !== 'list' && !['featured_gallery', 'before_after'].includes(v.type) || ['featured_gallery', 'before_after'].includes(v.type) },
  { key: 'content.image', label: 'Image', type: 'image', show: has('hero', 'story', 'image_text'), help: 'If empty, Brand story uses your About page photo. Brand story and Hero can also use a featured gallery photo.' },
  { key: 'content.images', label: 'Hero slideshow images', type: 'images', show: has('hero'), help: 'Add two or more to crossfade automatically (overrides the single image). Order = display order.' },
  { key: 'content.slideSeconds', label: 'Seconds per image', type: 'number', half: true, min: 3, max: 15, show: has('hero') },
  { key: 'content.video', label: 'Hero video URL (optional, mp4)', show: has('hero'), help: 'If set, the video is used instead of images.' },
  { key: 'content.ctaLabel', label: 'Main button text', half: true, show: has('hero', 'story') }, { key: 'content.ctaHref', label: 'Main button link', half: true, show: has('hero', 'story'), placeholder: '/book' },
  { key: 'content.secondaryLabel', label: 'Second button text', half: true, show: has('hero') }, { key: 'content.secondaryHref', label: 'Second button link', half: true, show: has('hero') },
  { key: 'content.showWhatsapp', label: 'WhatsApp button', type: 'bool', help: 'Show a WhatsApp button in the hero', show: has('hero') },
  { key: 'content.items', label: 'Items', type: 'lines', show: has('list') },
];

function SectionsManager({ page }: { page: 'home' | 'about' }) {
  const toast = useToast();
  const [n, setN] = useState(0);
  const restore = async () => {
    try { const r = await api.post('/admin/sections/restore-defaults', { page }); toast(r.added ? `Added ${r.added} missing section(s) at the bottom. Drag them into place.` : 'Nothing missing: all default sections already exist.'); setN((x) => x + 1); } catch (e) { toast(errorMessage(e), 'err'); }
  };
  return (<>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 bg-nude/50 p-3 text-sm"><span>Page looks empty or missing parts? Add back any default sections you don't have yet. Your existing sections are never changed.</span><button className="btn btn-outline btn-sm" onClick={restore}>Restore missing default sections</button></div>
    <ResourceManager key={page + n} title={page === 'home' ? 'Home section' : 'About section'} sub="Drag rows to reorder. Hidden sections stay saved." endpoint={`/admin/sections?page=${page}`} reorderable wide
    blank={{ page, type: page === 'home' ? 'text' : 'image_text', name: '', visible: true, content: {} }} fields={sectionFields}
    columns={[{ label: 'Section', render: (r) => <span><strong>{r.name || r.type}</strong><span className="block text-xs text-charcoal/50">{SECTION_TYPES.find(([k]) => k === r.type)?.[1]} · {r.content?.heading}</span></span> }, { label: 'Visible', render: (r) => <Bool v={r.visible} /> }]} />
  </>);
}

function Faqs() {
  const toast = useToast();
  const { data, reload } = useLoad<Record<string, any>>('/admin/settings');
  const [faqs, setFaqs] = useState<{ q: string; a: string }[] | null>(null);
  useEffect(() => { if (data) setFaqs(data.faqs || []); }, [data]);
  if (!faqs) return <PageLoader />;
  const save = async () => { try { await api.put('/admin/settings/faqs', { value: faqs.filter((f) => f.q.trim() && f.a.trim()) }); toast('FAQs saved'); reload(); } catch (e) { toast(errorMessage(e), 'err'); } };
  return (
    <div className="admin-card p-5"><h2 className="mb-4 text-2xl">FAQs</h2>
      <div className="space-y-4">{faqs.map((f, i) => (<div key={i} className="space-y-2 border-b border-charcoal/10 pb-4"><div className="flex gap-2"><input className="input" aria-label="Question" placeholder="Question" value={f.q} onChange={(e) => setFaqs(faqs.map((x, n) => (n === i ? { ...x, q: e.target.value } : x)))} />
        <button className="px-2 text-charcoal/40 hover:text-gold disabled:opacity-30" disabled={i === 0} aria-label="Move up" onClick={() => { const n = [...faqs]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setFaqs(n); }}>↑</button>
        <button className="px-2 text-rose" aria-label="Remove" onClick={() => setFaqs(faqs.filter((_, n) => n !== i))}>✕</button></div>
        <textarea className="input" rows={2} aria-label="Answer" placeholder="Answer" value={f.a} onChange={(e) => setFaqs(faqs.map((x, n) => (n === i ? { ...x, a: e.target.value } : x)))} /></div>))}</div>
      <div className="mt-4 flex justify-between"><button className="btn btn-outline btn-sm" onClick={() => setFaqs([...faqs, { q: '', a: '' }])}>+ Add FAQ</button><button className="btn btn-solid btn-sm" onClick={save}>Save FAQs</button></div></div>
  );
}

export function ContentAdmin() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'home' | 'about' | 'nav' | 'brand' | 'faq' | 'policies' | 'social'>('home');
  return (
    <div><PageHeader title="Website content" sub="Edit text, images, sections and navigation. Changes go live immediately." />
      <Tabs value={tab} onChange={setTab} tabs={[['home', 'Home page'], ['about', 'About page'], ['nav', 'Navigation'], ['brand', 'Brand & footer'], ['faq', 'FAQs'], ['policies', 'Policies'], ['social', 'Embeds']]} />
      {tab === 'home' && <SectionsManager page="home" />}{tab === 'about' && <SectionsManager page="about" />}
      {tab === 'nav' && <ResourceManager title="Menu link" endpoint="/admin/navigation" reorderable blank={{ label: '', href: '/', area: 'header', visible: true }}
        fields={[{ key: 'label', label: 'Label', half: true, required: true }, { key: 'href', label: 'Link', half: true, required: true, placeholder: '/services' }, { key: 'area', label: 'Menu', type: 'select', half: true, options: [['header', 'Header'], ['footer', 'Footer']] }, { key: 'visible', label: 'Visibility', type: 'bool', half: true, help: 'Visible' }]}
        columns={[{ label: 'Label', render: (r) => r.label }, { label: 'Link', render: (r) => <code className="text-xs">{r.href}</code> }, { label: 'Menu', render: (r) => r.area }, { label: 'Visible', render: (r) => <Bool v={r.visible} /> }]} />}
      {tab === 'brand' && (<><SettingsForm group="brand" title="Brand" fields={[{ key: 'name', label: 'Brand name', half: true }, { key: 'artistName', label: 'Artist name', half: true }, { key: 'artistTitle', label: 'Professional title', half: true }, { key: 'tagline', label: 'Tagline', half: true }, { key: 'logo', label: 'Logo (leave empty to use the name)', type: 'image' }, { key: 'favicon', label: 'Favicon', type: 'image' }]} />
        <SettingsForm group="footer" title="Footer" fields={[{ key: 'blurb', label: 'Footer text', type: 'textarea' }, { key: 'copyright', label: 'Copyright line' }]} /></>)}
      {tab === 'faq' && <Faqs />}
      {tab === 'policies' && <SettingsForm group="policies" title="Policies" sub="Shown at /policy/privacy, /policy/terms and /policy/cancellation and in the booking flow." fields={[{ key: 'privacy', label: 'Privacy policy', type: 'textarea' }, { key: 'terms', label: 'Terms & conditions', type: 'textarea' }, { key: 'cancellation', label: 'Cancellation policy', type: 'textarea' }]} />}
      {tab === 'social' && <SettingsForm group="instagram" title="Instagram & video embeds" sub="The homepage shows your featured gallery in the Instagram section. YouTube links are embedded." fields={[{ key: 'handle', label: 'Instagram handle', placeholder: '@yourhandle' }, { key: 'youtubeUrls', label: 'YouTube video URLs', type: 'lines' }]} />}
      {!can('content') && <ErrorNote message="You do not have permission to edit content." />}
    </div>
  );
}

/* ============================== simple resources ============================== */
export const TestimonialsAdmin = () => (
  <ResourceManager title="Testimonial" sub="Only approved testimonials appear on the website. Demo reviews are labelled until you replace them." endpoint="/admin/testimonials" reorderable
    blank={{ customer_name: '', review: '', rating: 5, service_category: '', image_url: null, review_date: null, approved: true, featured: false }}
    fields={[{ key: 'customer_name', label: 'Customer name', required: true, half: true }, { key: 'service_category', label: 'Service category', half: true }, { key: 'review', label: 'Review', type: 'textarea', required: true },
      { key: 'rating', label: 'Rating (1-5)', type: 'number', half: true, min: 1, max: 5 }, { key: 'review_date', label: 'Date', type: 'date', half: true }, { key: 'image_url', label: 'Customer photo', type: 'image' },
      { key: 'approved', label: 'Approval', type: 'bool', half: true, help: 'Approved (visible)' }, { key: 'featured', label: 'Featured', type: 'bool', half: true, help: 'Show first' }, { key: 'is_demo', label: 'Demo content', type: 'bool', help: 'Labelled "Demo" on the website. Untick once this is a real review.' }]}
    columns={[{ label: 'Customer', render: (r) => <span>{r.customer_name} {r.is_demo && <span className="badge ml-1">Demo</span>}</span> }, { label: 'Rating', render: (r) => '★'.repeat(r.rating) }, { label: 'Review', render: (r) => <span className="line-clamp-1 max-w-xs">{r.review}</span> }, { label: 'Approved', render: (r) => <Bool v={r.approved} /> }, { label: 'Featured', render: (r) => <Bool v={r.featured} /> }]} />
);

export const PromotionsAdmin = () => (
  <ResourceManager title="Promotion" endpoint="/admin/promotions" reorderable wide
    blank={{ title: '', description: '', banner_url: null, start_date: null, end_date: null, discount_type: 'percent', discount_value: 10, promo_code: '', terms: '', cta_label: 'Book now', cta_href: '/book', visible: true }}
    fields={[{ key: 'title', label: 'Title', required: true }, { key: 'description', label: 'Description', type: 'textarea' }, { key: 'banner_url', label: 'Banner image', type: 'image' },
      { key: 'start_date', label: 'Starts', type: 'date', half: true }, { key: 'end_date', label: 'Ends', type: 'date', half: true },
      { key: 'discount_type', label: 'Discount type', type: 'select', half: true, options: [['percent', 'Percent'], ['fixed', 'Fixed amount'], ['none', 'No discount (offer only)']] },
      { key: 'discount_value', label: 'Discount value', type: 'number', half: true, help: 'Percent (e.g. 10) or minor currency units for fixed (1000 = 10.00)', show: (v) => v.discount_type !== 'none' },
      { key: 'promo_code', label: 'Promo code', half: true, help: 'Customers enter this when booking' }, { key: 'cta_label', label: 'Button text', half: true }, { key: 'cta_href', label: 'Button link', half: true },
      { key: 'terms', label: 'Terms & conditions', type: 'textarea' }, { key: 'visible', label: 'Visibility', type: 'bool', half: true, help: 'Visible (within dates)' }, { key: 'is_demo', label: 'Demo content', type: 'bool', half: true, help: 'Demo' }]}
    columns={[{ label: 'Promotion', render: (r) => <span>{r.title} {r.is_demo && <span className="badge ml-1">Demo</span>}</span> }, { label: 'Code', render: (r) => r.promo_code ? <code className="text-xs">{r.promo_code}</code> : '-' }, { label: 'Dates', render: (r) => `${r.start_date || '…'} → ${r.end_date || '…'}` }, { label: 'Visible', render: (r) => <Bool v={r.visible} /> }]} />
);

export const SocialAdmin = () => (
  <ResourceManager title="Social link" sub="Shown in the header, footer and Instagram section. Add as many as you like." endpoint="/admin/social-links" reorderable
    blank={{ platform: 'Instagram', url: 'https://', username: '', icon: 'instagram', visible: true }}
    fields={[{ key: 'platform', label: 'Platform name', required: true, half: true, placeholder: 'Instagram, TikTok, Threads…' }, { key: 'icon', label: 'Icon', type: 'select', half: true, options: ['instagram', 'facebook', 'tiktok', 'youtube', 'pinterest', 'threads', 'linkedin', 'snapchat', 'link'].map((x) => [x, x] as [string, string]) },
      { key: 'url', label: 'URL', required: true }, { key: 'username', label: 'Username', half: true }, { key: 'visible', label: 'Display', type: 'bool', half: true, help: 'Show on website' }]}
    columns={[{ label: 'Platform', render: (r) => r.platform }, { label: 'URL', render: (r) => <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-gold underline">{r.url}</a> }, { label: 'Handle', render: (r) => r.username }, { label: 'Visible', render: (r) => <Bool v={r.visible} /> }]} />
);

/* ============================== inquiries ============================== */
export function InquiriesAdmin() {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad<any[]>('/admin/inquiries');
  const [open, setOpen] = useState<any | null>(null);
  const save = async () => { try { await api.put(`/admin/inquiries/${open.id}`, { status: open.status, internal_notes: open.internal_notes }); toast('Saved'); setOpen(null); reload(); } catch (e) { toast(errorMessage(e), 'err'); } };
  return (
    <div><PageHeader title="Inquiries" /><ErrorNote message={error} />
      {loading ? <PageLoader /> : !data?.length ? <div className="admin-card p-10 text-center text-charcoal/60">No inquiries yet.</div> : (
        <div className="admin-card overflow-x-auto"><table className="w-full min-w-[560px]"><thead><tr><th className="admin-th">From</th><th className="admin-th">Interested in</th><th className="admin-th">Message</th><th className="admin-th">Received</th><th className="admin-th">Status</th></tr></thead>
          <tbody>{data.map((i) => <tr key={i.id} className="cursor-pointer hover:bg-nude/40" onClick={() => setOpen({ ...i })}><td className="admin-td font-medium">{i.name}<span className="block text-xs font-normal text-charcoal/50">{i.email || i.phone}</span></td><td className="admin-td">{i.service_interest}</td><td className="admin-td"><span className="line-clamp-1 max-w-xs">{i.message}</span></td><td className="admin-td whitespace-nowrap">{new Date(i.created_at).toLocaleDateString()}</td><td className="admin-td"><span className={`badge ${i.status === 'new' ? '!bg-gold/25' : ''}`}>{i.status}</span></td></tr>)}</tbody></table></div>)}
      <Modal open={!!open} onClose={() => setOpen(null)} title="Inquiry">{open && (<div className="space-y-4 text-sm">
        <div><p className="font-medium">{open.name}</p><p>{open.email} {open.phone}</p>{open.event_date && <p>Event date: {open.event_date}</p>}{open.service_interest && <p>Service: {open.service_interest}</p>}</div>
        <p className="whitespace-pre-line bg-nude/50 p-3">{open.message}</p>
        {open.attachments?.length > 0 && <div className="flex gap-2">{open.attachments.map((u: string) => <a key={u} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt="Attachment" className="h-20 w-20 object-cover" /></a>)}</div>}
        <div className="flex flex-wrap gap-2">{open.email && <a className="btn btn-outline btn-sm" href={`mailto:${open.email}`}>Reply by email</a>}{open.phone && <a className="btn btn-outline btn-sm" href={`tel:${open.phone}`}>Call</a>}{open.phone && <a className="btn btn-outline btn-sm" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${open.phone.replace(/[^\d]/g, '')}`}>WhatsApp</a>}</div>
        <div><label className="label">Status</label><select className="input" value={open.status} onChange={(e) => setOpen({ ...open, status: e.target.value })}>{['new', 'replied', 'closed', 'spam'].map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><label className="label">Internal notes</label><textarea className="input" rows={3} value={open.internal_notes} onChange={(e) => setOpen({ ...open, internal_notes: e.target.value })} /></div>
        <div className="flex justify-end"><button className="btn btn-solid btn-sm" onClick={save}>Save</button></div></div>)}</Modal></div>
  );
}

/* ============================== customers ============================== */
export function CustomersAdmin() {
  const toast = useToast();
  const { money } = useSite();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const { data, loading, error, reload } = useLoad<any[]>(`/admin/customers?q=${encodeURIComponent(dq)}`);
  const [open, setOpen] = useState<number | null>(null);
  const detail = useLoad<any>(open ? `/admin/customers/${open}` : null);
  const [note, setNote] = useState('');
  const [form, setForm] = useState<any>(null);
  useEffect(() => { if (detail.data) setForm({ ...detail.data }); }, [detail.data]);
  const save = async () => { try { await api.put(`/admin/customers/${open}`, { name: form.name, email: form.email || '', phone: form.phone, whatsapp: form.whatsapp, tags: form.tags }); toast('Saved'); reload(); detail.reload(); } catch (e) { toast(errorMessage(e), 'err'); } };
  const addNote = async () => { if (!note.trim()) return; try { await api.post(`/admin/customers/${open}/notes`, { note }); setNote(''); detail.reload(); } catch (e) { toast(errorMessage(e), 'err'); } };
  return (
    <div><PageHeader title="Customers" /><input type="search" aria-label="Search customers" placeholder="Search name, email, phone" className="input mb-4 !w-72" value={q} onChange={(e) => setQ(e.target.value)} /><ErrorNote message={error} />
      {loading ? <PageLoader /> : !data?.length ? <div className="admin-card p-10 text-center text-charcoal/60">No customers yet. They are created automatically from bookings.</div> : (
        <div className="admin-card overflow-x-auto"><table className="w-full min-w-[560px]"><thead><tr><th className="admin-th">Name</th><th className="admin-th">Contact</th><th className="admin-th">Bookings</th><th className="admin-th">Last appointment</th><th className="admin-th">Tags</th></tr></thead>
          <tbody>{data.map((c) => <tr key={c.id} className="cursor-pointer hover:bg-nude/40" onClick={() => setOpen(c.id)}><td className="admin-td font-medium">{c.name}</td><td className="admin-td">{c.email}<span className="block text-xs text-charcoal/50">{c.phone}</span></td><td className="admin-td">{c.booking_count}</td><td className="admin-td">{c.last_appointment || '-'}</td><td className="admin-td">{c.tags?.map((t: string) => <span key={t} className="badge mr-1">{t}</span>)}</td></tr>)}</tbody></table></div>)}
      <Modal open={open !== null} onClose={() => setOpen(null)} title="Customer" wide>{!form || detail.loading ? <PageLoader /> : (<div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3"><Fields value={form} onChange={setForm} fields={[{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email', half: true }, { key: 'phone', label: 'Phone', half: true }, { key: 'whatsapp', label: 'WhatsApp' }, { key: 'tags', label: 'Tags', type: 'tags' }]} /><button className="btn btn-solid btn-sm" onClick={save}>Save customer</button>
          <div className="pt-4"><p className="label">Notes</p><div className="flex gap-2"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a private note" onKeyDown={(e) => e.key === 'Enter' && addNote()} /><button className="btn btn-outline btn-sm" onClick={addNote}>Add</button></div>
            <ul className="mt-3 space-y-2 text-sm">{detail.data?.notes.map((n: any) => <li key={n.id} className="bg-nude/50 p-2">{n.note}<span className="block text-[11px] text-charcoal/45">{n.author} · {new Date(n.created_at).toLocaleDateString()}</span></li>)}</ul></div></div>
        <div><p className="label">Booking history</p>{!detail.data?.bookings.length ? <p className="text-sm text-charcoal/55">None yet.</p> : <ul className="divide-y divide-charcoal/10 text-sm">{detail.data.bookings.map((b: any) => <li key={b.id} className="py-2"><span className="font-medium">{b.booking_date} {mins(b.start_min)}</span> <span className="badge ml-1">{b.status}</span><span className="block text-charcoal/60">{b.service_names} · {money(b.total_cents)}</span></li>)}</ul>}</div></div>)}</Modal></div>
  );
}

/* ============================== users ============================== */
export function UsersAdmin() {
  const toast = useToast();
  const { user } = useAuth();
  const users = useLoad<any[]>('/admin/users');
  const roles = useLoad<any[]>('/admin/roles');
  const audit = useLoad<any[]>('/admin/audit');
  const [edit, setEdit] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const roleOpts = (roles.data || []).map((r) => [r.name, r.label] as [string, string]);
  const save = async () => {
    setErr(null);
    try { if (edit.id) await api.put(`/admin/users/${edit.id}`, { name: edit.name, role: edit.role, active: edit.active, ...(edit.password && { password: edit.password }) }); else await api.post('/admin/users', edit); toast('Saved'); setEdit(null); users.reload(); audit.reload(); } catch (e) { setErr(errorMessage(e)); }
  };
  return (
    <div><PageHeader title="Users & roles" sub="Roles: Administrator (everything), Editor (content, services, gallery), Booking manager (bookings, customers, inquiries), Gallery manager." actions={<button className="btn btn-solid btn-sm" onClick={() => setEdit({ name: '', email: '', password: '', role: 'editor', active: true })}>+ Add user</button>} />
      <ErrorNote message={users.error} />
      {users.loading ? <PageLoader /> : <div className="admin-card overflow-x-auto"><table className="w-full min-w-[520px]"><thead><tr><th className="admin-th">Name</th><th className="admin-th">Email</th><th className="admin-th">Role</th><th className="admin-th">Last sign-in</th><th className="admin-th">Active</th><th className="admin-th" /></tr></thead>
        <tbody>{users.data!.map((u) => <tr key={u.id}><td className="admin-td font-medium">{u.name}{u.id === user?.id && <span className="badge ml-2">You</span>}</td><td className="admin-td">{u.email}</td><td className="admin-td">{u.role_label}</td><td className="admin-td">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}</td><td className="admin-td"><Bool v={u.active} /></td><td className="admin-td text-right"><button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...u, password: '' })}>Edit</button></td></tr>)}</tbody></table></div>}
      <h2 className="mb-3 mt-10 text-2xl">Audit log</h2>
      <div className="admin-card max-h-96 overflow-auto"><table className="w-full min-w-[520px]"><thead><tr><th className="admin-th">When</th><th className="admin-th">User</th><th className="admin-th">Action</th><th className="admin-th">Entity</th></tr></thead>
        <tbody>{audit.data?.map((a) => <tr key={a.id}><td className="admin-td whitespace-nowrap text-xs">{new Date(a.created_at).toLocaleString()}</td><td className="admin-td text-xs">{a.user_email || '-'}</td><td className="admin-td text-xs">{a.action}</td><td className="admin-td text-xs">{a.entity} {a.entity_id}</td></tr>)}</tbody></table></div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit user' : 'New user'}>{edit && (<div className="space-y-4">
        <Fields value={edit} onChange={setEdit} fields={[{ key: 'name', label: 'Name' }, ...(edit.id ? [] : [{ key: 'email', label: 'Email' }]), { key: 'role', label: 'Role', type: 'select', options: roleOpts }, { key: 'password', label: edit.id ? 'Set new password (optional)' : 'Password', help: 'At least 10 characters with letters and numbers' }, ...(edit.id ? [{ key: 'active', label: 'Account', type: 'bool' as const, help: 'Active (can sign in)' }] : [])]} />
        <ErrorNote message={err} /><div className="flex justify-end gap-2"><button className="btn btn-outline btn-sm" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-solid btn-sm" onClick={save}>Save</button></div></div>)}</Modal></div>
  );
}

/* ============================== analytics ============================== */
export function AnalyticsAdmin() {
  const [days, setDays] = useState(30);
  const { data, loading, error } = useLoad<any>(`/admin/analytics?days=${days}`);
  const Stat = ({ l, v }: { l: string; v: string | number }) => <div className="admin-card p-4"><p className="text-[11px] uppercase tracking-[0.14em] text-charcoal/50">{l}</p><p className="mt-1 font-heading text-4xl">{v}</p></div>;
  return (
    <div><PageHeader title="Analytics" sub="First-party, privacy-friendly counts. Connect Google Analytics 4 in Settings for deeper reporting." actions={<select className="input !w-auto !py-2" aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>} />
      <ErrorNote message={error} />
      {loading ? <PageLoader /> : (<><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat l="Visitors" v={data.visitors} /><Stat l="Page views" v={data.pageViews} /><Stat l="Booking clicks" v={data.bookingClicks} /><Stat l="Bookings made" v={data.bookings} />
        <Stat l="WhatsApp clicks" v={data.whatsappClicks} /><Stat l="Call clicks" v={data.callClicks} /><Stat l="Form submissions" v={data.formSubmissions} /><Stat l="Conversion rate" v={`${data.conversionRate}%`} /></div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2"><section className="admin-card p-5"><h2 className="mb-3 text-2xl">Popular pages</h2>{!data.topPages.length ? <p className="text-sm text-charcoal/55">No data yet.</p> : <ul className="space-y-2 text-sm">{data.topPages.map((p: any) => <li key={p.path} className="flex justify-between"><code>{p.path || '/'}</code><span>{p.views}</span></li>)}</ul>}</section>
          <section className="admin-card p-5"><h2 className="mb-3 text-2xl">Gallery engagement</h2>{!data.topGallery.length ? <p className="text-sm text-charcoal/55">No data yet.</p> : <ul className="space-y-2 text-sm">{data.topGallery.map((g: any) => <li key={g.id} className="flex items-center gap-3"><img src={g.thumb_url} alt="" className="h-9 w-9 object-cover" /><span className="flex-1 truncate">{g.title}</span><span>{g.views}</span></li>)}</ul>}</section></div></>)}</div>
  );
}

/* ============================== settings ============================== */
const HEADING_FONTS = ['Cormorant Garamond', 'Playfair Display', 'DM Serif Display', 'Cinzel', 'Bodoni Moda', 'Libre Baskerville', 'Marcellus'];
const BODY_FONTS = ['Jost', 'Inter', 'DM Sans', 'Lato', 'Montserrat', 'Nunito Sans', 'Work Sans'];
const opts = (l: string[]) => l.map((x) => [x, x] as [string, string]);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function HoursEditor() {
  const toast = useToast();
  const { data, reload } = useLoad<any[]>('/admin/hours');
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { if (data) setRows(data); }, [data]);
  if (!rows) return <PageLoader />;
  const upd = (i: number, p: object) => setRows(rows.map((r, n) => (n === i ? { ...r, ...p } : r)));
  const save = async () => { try { await api.put('/admin/hours', rows); toast('Working hours saved'); reload(); } catch (e) { toast(errorMessage(e), 'err'); } };
  return (
    <section className="admin-card mb-6 p-5"><h2 className="text-2xl">Working hours</h2><p className="mb-3 text-sm text-charcoal/60">Online booking slots are only offered within these hours.</p>
      <ul className="space-y-2">{rows.map((r, i) => <li key={r.weekday} className="flex flex-wrap items-center gap-3 text-sm"><span className="w-24">{DAYS[r.weekday]}</span><label className="flex items-center gap-1.5"><input type="checkbox" checked={!r.closed} onChange={(e) => upd(i, { closed: !e.target.checked })} />Open</label>
        {!r.closed && <><input type="time" aria-label={`${DAYS[r.weekday]} opening`} className="input !w-auto !py-1.5" value={mins(r.open_min)} onChange={(e) => upd(i, { open_min: toMins(e.target.value) })} />–<input type="time" aria-label={`${DAYS[r.weekday]} closing`} className="input !w-auto !py-1.5" value={mins(r.close_min === 1440 ? 1439 : r.close_min)} onChange={(e) => upd(i, { close_min: toMins(e.target.value) })} /></>}</li>)}</ul>
      <div className="mt-4 flex justify-end"><button className="btn btn-solid btn-sm" onClick={save}>Save hours</button></div></section>
  );
}

function TemplatesEditor() {
  const toast = useToast();
  const { data, reload } = useLoad<any[]>('/admin/templates');
  const logs = useLoad<any[]>('/admin/templates/logs/recent');
  const [open, setOpen] = useState<any | null>(null);
  const save = async () => { try { await api.put(`/admin/templates/${open.key}`, { subject: open.subject, body: open.body, enabled: open.enabled }); toast('Template saved'); setOpen(null); reload(); } catch (e) { toast(errorMessage(e), 'err'); } };
  if (!data) return <PageLoader />;
  return (
    <section className="admin-card mb-6 p-5"><h2 className="text-2xl">Email templates</h2><p className="mb-3 text-sm text-charcoal/60">Variables: {'{{name}} {{reference}} {{services}} {{date}} {{time}} {{venue}} {{total}} {{brand}} {{link}}'}. Emails are sent with your brand colours. Configure SMTP in the server environment.</p>
      <ul className="divide-y divide-charcoal/10">{data.map((t) => <li key={t.key} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span><strong>{t.subject}</strong><span className="block text-xs text-charcoal/50">{t.audience} · {t.key}</span></span><span className="flex items-center gap-2"><Bool v={t.enabled} yes="On" no="Off" /><button className="btn btn-ghost btn-sm" onClick={() => setOpen({ ...t })}>Edit</button></span></li>)}</ul>
      <h3 className="mt-6 text-xl">Recent delivery log</h3>
      {!logs.data?.length ? <p className="mt-1 text-sm text-charcoal/55">Nothing sent yet.</p> : <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs">{logs.data.map((l) => <li key={l.id} className="flex gap-2"><span className="w-28 shrink-0 text-charcoal/45">{new Date(l.created_at).toLocaleString()}</span><span className={`w-14 ${l.status === 'failed' ? 'text-rose' : ''}`}>{l.status}</span><span>{l.channel} · {l.template_key || ''} {l.recipient} {l.detail}</span></li>)}</ul>}
      <Modal open={!!open} onClose={() => setOpen(null)} title="Edit template">{open && <div className="space-y-4"><Fields value={open} onChange={setOpen} fields={[{ key: 'subject', label: 'Subject' }, { key: 'body', label: 'Body', type: 'textarea' }, { key: 'enabled', label: 'Sending', type: 'bool', help: 'Enabled' }]} /><div className="flex justify-end"><button className="btn btn-solid btn-sm" onClick={save}>Save</button></div></div>}</Modal></section>
  );
}

function SeoPages() {
  const toast = useToast();
  const { data, reload } = useLoad<any[]>('/admin/pages');
  const [open, setOpen] = useState<any | null>(null);
  const save = async () => {
    const { id, slug, updated_at, ...rest } = open; void slug; void updated_at;
    try { await api.put(`/admin/pages/${id}`, rest); toast('SEO saved'); setOpen(null); reload(); } catch (e) { toast(errorMessage(e), 'err'); }
  };
  if (!data) return <PageLoader />;
  return (
    <section className="admin-card mb-6 p-5"><h2 className="text-2xl">Page SEO</h2><p className="mb-3 text-sm text-charcoal/60">Title, description, social sharing and indexing for every page. Sitemap and robots.txt update automatically.</p>
      <ul className="divide-y divide-charcoal/10">{data.map((p) => <li key={p.id} className="flex items-center justify-between py-2.5 text-sm"><span><strong>{p.title}</strong> <code className="text-xs text-charcoal/50">/{p.slug === 'home' ? '' : p.slug}</code><span className="block text-xs text-charcoal/55">{p.seo_title}</span></span><button className="btn btn-ghost btn-sm" onClick={() => setOpen({ ...p })}>Edit</button></li>)}</ul>
      <Modal open={!!open} onClose={() => setOpen(null)} title={`SEO: ${open?.title}`} wide>{open && <div className="space-y-4"><Fields value={open} onChange={setOpen} fields={[{ key: 'seo_title', label: 'SEO title' }, { key: 'seo_description', label: 'Meta description', type: 'textarea' }, { key: 'seo_keywords', label: 'Keywords' }, { key: 'og_title', label: 'Social sharing title', half: true }, { key: 'og_description', label: 'Social sharing description', half: true }, { key: 'og_image', label: 'Open Graph image', type: 'image' }, { key: 'canonical_url', label: 'Canonical URL (optional)' }, { key: 'robots', label: 'Robots', type: 'select', options: ['index,follow', 'noindex,follow', 'index,nofollow', 'noindex,nofollow'].map((x) => [x, x] as [string, string]) }, { key: 'visible', label: 'Page', type: 'bool', help: 'Included in the sitemap' }]} /><div className="flex justify-end"><button className="btn btn-solid btn-sm" onClick={save}>Save</button></div></div>}</Modal></section>
  );
}

function BlockedDates() {
  return <div className="mb-6"><ResourceManager title="Blocked date" sub="Holidays and days off. No online bookings can be made on these dates." endpoint="/admin/blocked-dates" blank={{ date: '', end_date: null, reason: '', is_holiday: false }}
    fields={[{ key: 'date', label: 'From', type: 'date', half: true, required: true }, { key: 'end_date', label: 'Until (optional)', type: 'date', half: true }, { key: 'reason', label: 'Reason' }, { key: 'is_holiday', label: 'Type', type: 'bool', help: 'Public holiday' }]}
    columns={[{ label: 'From', render: (r) => r.date }, { label: 'Until', render: (r) => r.end_date || '-' }, { label: 'Reason', render: (r) => r.reason }]} /></div>;
}

function AppearanceTab() {
  const { reload } = useSite();
  const [w, setW] = useState<'100%' | '768px' | '390px'>('100%');
  const [rev, setRev] = useState(0);
  const colors: FieldDef[] = [['blush', 'Blush pink'], ['nude', 'Nude beige'], ['gold', 'Champagne gold'], ['ivory', 'Warm ivory'], ['rose', 'Muted rose'], ['charcoal', 'Charcoal (text)'], ['white', 'White']].map(([k, l]) => ({ key: `colors.${k}`, label: l, type: 'color' as const, half: true }));
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <div><SettingsForm group="theme" title="Theme" sub="Colours, fonts and layout apply to the whole site instantly." onPreview={applyTheme} onSaved={() => { reload(); setRev((x) => x + 1); }}
        fields={[...colors, { key: 'fonts.heading', label: 'Heading font', type: 'select', options: opts(HEADING_FONTS), half: true }, { key: 'fonts.body', label: 'Body font', type: 'select', options: opts(BODY_FONTS), half: true }, { key: 'radius', label: 'Corner radius (px)', type: 'number', half: true, min: 0, max: 40 }, { key: 'sectionSpacing', label: 'Section spacing (px)', type: 'number', half: true, min: 24, max: 240 }, { key: 'buttonStyle', label: 'Button style', type: 'select', half: true, options: [['solid', 'Solid'], ['outline', 'Outline'], ['pill', 'Pill']] }]} /></div>
      <div><div className="sticky top-4"><div className="mb-2 flex items-center justify-between"><p className="label !mb-0">Live preview</p><div className="inline-flex border border-charcoal/15 bg-paper">{([['100%', 'Desktop'], ['768px', 'Tablet'], ['390px', 'Mobile']] as const).map(([x, l]) => <button key={x} onClick={() => setW(x)} aria-pressed={w === x} className={`px-3 py-1.5 text-[11px] uppercase tracking-widest ${w === x ? 'bg-charcoal text-paper' : ''}`}>{l}</button>)}</div></div>
        <div className="flex justify-center overflow-hidden border border-charcoal/10 bg-nude/40"><iframe key={rev} title="Site preview" src="/" style={{ width: w, maxWidth: '100%', height: '70vh' }} className="border-0 bg-ivory" /></div></div></div>
    </div>
  );
}

export function SettingsAdmin() {
  const [tab, setTab] = useState<'general' | 'appearance' | 'booking' | 'whatsapp' | 'notifications' | 'seo'>('general');
  return (
    <div><PageHeader title="Settings" />
      <Tabs value={tab} onChange={setTab} tabs={[['general', 'General & contact'], ['appearance', 'Appearance'], ['booking', 'Booking & hours'], ['whatsapp', 'WhatsApp'], ['notifications', 'Notifications'], ['seo', 'SEO & analytics']]} />
      {tab === 'general' && (<><SettingsForm group="contact" title="Contact details" sub="Used across the website, footer, WhatsApp and click-to-call." fields={[{ key: 'phone', label: 'Phone number', half: true, placeholder: '+1 555 010 0199' }, { key: 'whatsapp', label: 'WhatsApp number (digits only, with country code)', half: true, placeholder: '15550100199' }, { key: 'email', label: 'Email', half: true }, { key: 'address', label: 'Business address', half: true }, { key: 'mapLink', label: 'Google Maps link', half: true }, { key: 'mapEmbed', label: 'Google Maps embed URL', half: true, help: 'Starts with https://www.google.com/maps/embed' }]} />
        <SettingsForm group="general" title="Regional" fields={[{ key: 'currency', label: 'Currency (ISO code)', half: true, placeholder: 'USD' }, { key: 'timezone', label: 'Timezone', half: true, placeholder: 'America/New_York', help: 'IANA name. Controls booking times and lead time.' }, { key: 'locale', label: 'Number format locale', half: true, placeholder: 'en-US' }]} /></>)}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'booking' && (<><SettingsForm group="booking" title="Booking rules" fields={[{ key: 'slotIntervalMin', label: 'Time slot interval (min)', type: 'number', half: true }, { key: 'bufferMin', label: 'Buffer between appointments (min)', type: 'number', half: true }, { key: 'travelBufferMin', label: 'Extra travel time for on-location (min)', type: 'number', half: true }, { key: 'leadTimeHours', label: 'Minimum notice (hours)', type: 'number', half: true }, { key: 'maxAdvanceDays', label: 'Book up to (days ahead)', type: 'number', half: true }, { key: 'depositPercent', label: 'Deposit %', type: 'number', half: true }, { key: 'autoConfirm', label: 'Confirmation', type: 'bool', help: 'Auto-confirm new bookings' }]} />
        <HoursEditor /><BlockedDates /></>)}
      {tab === 'whatsapp' && <SettingsForm group="whatsapp" title="WhatsApp button & messages" sub="WhatsApp number itself is under General. Click-to-chat works with no API. Server-side API alerts are configured via environment variables." fields={[{ key: 'visible', label: 'Floating button', type: 'bool', help: 'Show on every page' }, { key: 'position', label: 'Position', type: 'select', half: true, options: [['right', 'Bottom right'], ['left', 'Bottom left']] }, { key: 'color', label: 'Button colour', type: 'color', half: true }, { key: 'greeting', label: 'Default greeting', type: 'textarea' }, { key: 'serviceTemplate', label: 'Service enquiry message', type: 'textarea', help: 'Variables: {{service}} {{price}} {{date}} {{url}}' }]} />}
      {tab === 'notifications' && (<><SettingsForm group="notifications" title="Admin notifications" fields={[{ key: 'adminEmail', label: 'Send admin emails to', help: 'Falls back to the contact email' }, { key: 'reminderHoursBefore', label: 'Client reminder timing (hours before)', type: 'number', half: true }]} /><TemplatesEditor /></>)}
      {tab === 'seo' && (<><SettingsForm group="seo" title="Search defaults & structured data" fields={[{ key: 'siteName', label: 'Site name', half: true }, { key: 'businessType', label: 'Schema.org type', half: true, type: 'select', options: [['MakeupArtist', 'MakeupArtist'], ['BeautySalon', 'BeautySalon'], ['HealthAndBeautyBusiness', 'HealthAndBeautyBusiness']] }, { key: 'defaultDescription', label: 'Default meta description', type: 'textarea' }, { key: 'priceRange', label: 'Price range', half: true, placeholder: '$$' }, { key: 'areaServed', label: 'Area served', half: true }]} />
        <SettingsForm group="analytics" title="Google Analytics 4" fields={[{ key: 'ga4Id', label: 'Measurement ID', placeholder: 'G-XXXXXXXXXX', help: 'Leave empty to disable.' }]} /><SeoPages /></>)}
    </div>
  );
}

void Spinner;

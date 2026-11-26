import { Reorder } from 'framer-motion';
import { useState } from 'react';
import { api, errorMessage, slugify } from '../lib/api';
import { fmtDuration, priceLabel, useSite } from '../lib/site';
import { ErrorNote, Modal, PageLoader, Spinner } from '../components/ui';
import { Bool, Confirm, Fields, PageHeader, ResourceManager, useLoad, useToast, type FieldDef } from './kit';

const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Service name', required: true },
  { key: 'category_id', label: 'Category', type: 'select', half: true, options: [] },
  { key: 'price_type', label: 'Price type', type: 'select', half: true, options: [['fixed', 'Fixed price'], ['starting_from', 'Starting from'], ['custom', 'Custom quotation']] },
  { key: 'price_cents', label: 'Price', type: 'money', half: true, show: (v) => v.price_type !== 'custom', help: 'In your site currency.' },
  { key: 'duration_min', label: 'Duration (minutes)', type: 'number', half: true, min: 0, help: 'Use 0 to hide the time on the website. The calendar still reserves 60 minutes.' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'included', label: 'Included items', type: 'lines' },
  { key: 'image_url', label: 'Service image', type: 'image' },
  { key: 'available', label: 'Availability', type: 'bool', half: true, help: 'Visible and available on the website' },
  { key: 'bookable', label: 'Booking eligibility', type: 'bool', half: true, help: 'Can be booked online' },
  { key: 'featured', label: 'Featured', type: 'bool', half: true, help: 'Show on the homepage' },
];

const blank = { name: '', category_id: null, description: '', price_cents: 0, price_type: 'fixed', duration_min: 60, included: [], image_url: null, gallery: [], available: true, bookable: true, featured: false, addons: [] };

function ServiceForm({ initial, categories, onDone }: { initial: any; categories: any[]; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<any>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fields = FIELDS.map((f) => (f.key === 'category_id' ? { ...f, options: [['', 'Uncategorised'], ...categories.map((c) => [String(c.id), c.name] as [string, string])] as [string, string][] } : f));
  const val = { ...v, category_id: v.category_id == null ? '' : String(v.category_id) };
  const set = (n: any) => setV({ ...n, category_id: n.category_id === '' || n.category_id == null ? null : Number(n.category_id) });

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const payload = { ...v, addons: (v.addons || []).map((a: any) => ({ name: a.name, price_cents: a.price_cents, duration_min: a.duration_min })) };
      if (v.id) await api.put(`/admin/services/${v.id}`, payload); else await api.post('/admin/services', { ...payload, slug: slugify(v.name) || undefined });
      toast('Service saved'); onDone();
    } catch (e) { setErr(errorMessage(e)); } finally { setSaving(false); }
  };
  const updAddon = (i: number, patch: object) => setV({ ...v, addons: v.addons.map((a: any, n: number) => (n === i ? { ...a, ...patch } : a)) });
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-5">
      <Fields fields={fields} value={val} onChange={set} />
      <div><p className="label">Optional add-ons</p>
        <div className="space-y-2">{(v.addons || []).map((a: any, i: number) => (
          <div key={i} className="flex flex-wrap items-center gap-2"><input className="input !w-48 flex-1" placeholder="Name" value={a.name} onChange={(e) => updAddon(i, { name: e.target.value })} aria-label="Add-on name" />
            <input className="input !w-24" type="number" step="0.01" min={0} value={a.price_cents / 100} onChange={(e) => updAddon(i, { price_cents: Math.round(Number(e.target.value) * 100) })} aria-label="Add-on price" />
            <input className="input !w-20" type="number" min={0} value={a.duration_min} onChange={(e) => updAddon(i, { duration_min: Number(e.target.value) })} aria-label="Add-on minutes" /><span className="text-xs text-charcoal/50">min</span>
            <button type="button" className="text-rose" aria-label="Remove add-on" onClick={() => setV({ ...v, addons: v.addons.filter((_: any, n: number) => n !== i) })}>✕</button></div>))}</div>
        <button type="button" className="btn btn-outline btn-sm mt-2" onClick={() => setV({ ...v, addons: [...(v.addons || []), { name: '', price_cents: 0, duration_min: 0 }] })}>+ Add add-on</button></div>
      <ErrorNote message={err} />
      <div className="flex justify-end gap-2 border-t border-charcoal/10 pt-4"><button type="button" className="btn btn-outline btn-sm" onClick={onDone}>Cancel</button><button className="btn btn-solid btn-sm" disabled={saving}>{saving ? <Spinner /> : 'Save service'}</button></div>
    </form>
  );
}

function ServiceList() {
  const toast = useToast();
  const { money } = useSite();
  const { data, setData, error, reload, loading } = useLoad<any[]>('/admin/services');
  const cats = useLoad<any[]>('/admin/service-categories');
  const [edit, setEdit] = useState<any | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const run = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast(ok); reload(); } catch (e) { toast(errorMessage(e), 'err'); } };
  return (
    <div>
      <div className="mb-4 flex justify-end"><button className="btn btn-solid btn-sm" onClick={() => setEdit(structuredClone(blank))}>+ Add service</button></div>
      <ErrorNote message={error} />
      {loading || !cats.data ? <PageLoader /> : !data?.length ? <div className="admin-card p-10 text-center text-charcoal/60">No services yet.</div> : (
        <Reorder.Group axis="y" values={data} onReorder={setData} className="space-y-2">
          {data.map((s) => (
            <Reorder.Item key={s.id} value={s} onDragEnd={() => api.post('/admin/services/reorder', { ids: data.map((x) => x.id) }).catch((e) => toast(errorMessage(e), 'err'))} className={`admin-card flex flex-wrap items-center gap-3 p-3 ${s.available ? '' : 'opacity-55'}`}>
              <span className="cursor-grab px-1 text-charcoal/35" aria-label="Drag to reorder">⋮⋮</span>
              {s.image_url ? <img src={s.image_url} alt="" className="h-12 w-12 object-cover" /> : <span className="h-12 w-12 bg-nude" />}
              <div className="min-w-40 flex-1"><p className="font-medium">{s.name} {s.is_demo && <span className="badge ml-1">Demo</span>}</p><p className="text-xs text-charcoal/55">{[s.category_name || 'Uncategorised', fmtDuration(s.duration_min), priceLabel(s, money)].filter(Boolean).join(' · ')}</p></div>
              <div className="flex gap-1.5 text-xs">{s.featured && <Bool v yes="Featured" />}{!s.available && <span className="badge">Hidden</span>}{!s.bookable && <span className="badge">Not bookable</span>}</div>
              <div className="flex gap-1">
                <button className="btn btn-ghost btn-sm !px-2" onClick={() => run(() => api.put(`/admin/services/${s.id}`, { available: !s.available }), s.available ? 'Hidden from website' : 'Visible on website')}>{s.available ? 'Hide' : 'Show'}</button>
                <button className="btn btn-ghost btn-sm !px-2" onClick={() => run(() => api.post(`/admin/services/${s.id}/duplicate`), 'Duplicated (hidden until you publish it)')}>Duplicate</button>
                <button className="btn btn-ghost btn-sm !px-2" onClick={() => setEdit(structuredClone(s))}>Edit</button>
                <button className="btn btn-ghost btn-sm !px-2 hover:!text-rose" onClick={() => setDel(s)}>Delete</button></div>
            </Reorder.Item>))}
        </Reorder.Group>)}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit service' : 'New service'} wide>{edit && <ServiceForm initial={edit} categories={cats.data || []} onDone={() => { setEdit(null); reload(); }} />}</Modal>
      <Confirm open={!!del} message={`Delete "${del?.name}"? Existing bookings keep their records.`} onNo={() => setDel(null)} onYes={() => { const d = del; setDel(null); run(() => api.del(`/admin/services/${d.id}`), 'Deleted'); }} />
    </div>
  );
}

export default function ServicesAdmin() {
  const [tab, setTab] = useState<'services' | 'categories'>('services');
  return (
    <div>
      <PageHeader title="Services" sub="Everything here appears on the website and in the booking flow immediately." />
      <div className="mb-5 flex gap-1 border-b border-charcoal/10">{(['services', 'categories'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-4 py-2 text-xs uppercase tracking-widest ${tab === t ? 'border-gold text-charcoal' : 'border-transparent text-charcoal/50'}`}>{t}</button>)}</div>
      {tab === 'services' ? <ServiceList /> : (
        <ResourceManager title="Service category" endpoint="/admin/service-categories" reorderable blank={{ name: '', slug: '', description: '', visible: true }}
          fields={[{ key: 'name', label: 'Name', required: true, half: true }, { key: 'slug', label: 'URL slug', half: true, help: 'lowercase-with-hyphens' }, { key: 'description', label: 'Description', type: 'textarea' }, { key: 'visible', label: 'Visibility', type: 'bool', help: 'Shown on website' }]}
          columns={[{ label: 'Name', render: (r) => r.name }, { label: 'Slug', render: (r) => <code className="text-xs">{r.slug}</code> }, { label: 'Visible', render: (r) => <Bool v={r.visible} /> }]} />)}
    </div>
  );
}

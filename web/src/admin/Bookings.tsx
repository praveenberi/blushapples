import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage, mins } from '../lib/api';
import { useSite, fmtDuration } from '../lib/site';
import { ErrorNote, Modal, PageLoader, Spinner } from '../components/ui';
import { Confirm, PageHeader, useLoad, useToast } from './kit';

const STATUSES = ['new', 'pending_confirmation', 'confirmed', 'deposit_requested', 'deposit_paid', 'in_progress', 'completed', 'cancelled', 'rejected'];
const COLORS: Record<string, string> = {
  new: 'bg-blush text-charcoal', pending_confirmation: 'bg-amber-100 text-amber-900', confirmed: 'bg-emerald-100 text-emerald-900', deposit_requested: 'bg-sky-100 text-sky-900',
  deposit_paid: 'bg-teal-100 text-teal-900', in_progress: 'bg-violet-100 text-violet-900', completed: 'bg-charcoal text-paper', cancelled: 'bg-gray-200 text-gray-600', rejected: 'bg-rose/20 text-rose',
};
const label = (s: string) => (s === 'completed' ? 'Closed' : s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));
const received = (b: any) => b.deposit_cents + b.balance_paid_cents;
const pendingOf = (b: any) => Math.max(0, b.total_cents - received(b));

/** What happened when the customer was told about a change, with a one-tap WhatsApp fallback. */
function CustomerNotice({ m, onClose }: { m: any; onClose: () => void }) {
  const email: Record<string, string> = { sent: 'Email sent.', skipped: 'Email not sent: email (SMTP) is not set up on the server.', failed: 'Email failed to send. Check Settings > notification log.', off: 'Email not sent: no email address, or this template is switched off.' };
  const wa: Record<string, string> = { sent: 'WhatsApp sent.', manual: 'WhatsApp is ready: tap the button, then press send.', failed: 'Automatic WhatsApp failed. Send it with the button.', no_number: 'No phone number for WhatsApp.' };
  return (
    <div role="status" className="border border-gold/50 bg-gold/10 p-3 text-sm">
      <div className="flex items-start justify-between gap-3"><p className="font-medium">{m.kind === 'feedback' ? 'Feedback request' : m.kind === 'rescheduled' ? 'New time: customer message' : 'Customer message'}</p><button type="button" aria-label="Dismiss" onClick={onClose}>✕</button></div>
      <p className="mt-1">{email[m.email]}</p><p>{wa[m.whatsapp]}</p>
      {m.whatsappUrl && m.whatsapp !== 'sent' && <a className="btn btn-gold btn-sm mt-2" href={m.whatsappUrl} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>}
    </div>
  );
}
export const StatusBadge = ({ s }: { s: string }) => <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] ${COLORS[s] || 'bg-nude'}`}>{label(s)}</span>;

const DEAD = ['cancelled', 'rejected'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function BookingDetail({ id, initialNotice, onClose, onChanged }: { id: number; initialNotice?: any; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { money } = useSite();
  const { data: b, reload, error } = useLoad<any>(`/admin/bookings/${id}`);
  const [notes, setNotes] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<string | null>(null);
  const [pay, setPay] = useState({ total: '', deposit: '', balance: '' });
  const [tell, setTell] = useState(true);
  const [notice, setNotice] = useState<any | null>(initialNotice || null);
  const [rs, setRs] = useState({ date: '', time: '' });
  const [slots, setSlots] = useState<{ start: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [services, setServices] = useState<any[]>([]);
  const [editItems, setEditItems] = useState<{ s: number[]; a: number[] } | null>(null);

  useEffect(() => { if (b) { setNotes(b.internal_notes); setAssigned(b.assigned_to); setPay({ total: String(b.total_cents / 100), deposit: String(b.deposit_cents / 100), balance: String(b.balance_paid_cents / 100) }); setRs({ date: b.booking_date, time: '' }); } }, [b?.id, b?.updated_at]); // eslint-disable-line
  useEffect(() => {
    if (!b || !rs.date) return;
    api.get(`/admin/bookings/slots?date=${rs.date}&duration=${b.end_min - b.start_min}&location=${b.location_type}&exclude=${b.id}`).then(setSlots).catch(() => setSlots([]));
  }, [rs.date, b?.id]); // eslint-disable-line
  useEffect(() => { api.get('/admin/services').then(setServices).catch(() => {}); }, []);

  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try { const r = await fn(); if (r?.messages) setNotice(r.messages); toast(ok); reload(); onChanged(); } catch (e) { toast(errorMessage(e), 'err'); } finally { setBusy(false); }
  };
  if (error) return <ErrorNote message={error} />;
  if (!b) return <PageLoader />;
  const wa = (b.customer_whatsapp || b.customer_phone || '').replace(/[^\d]/g, '');
  const cents = (v: string) => Math.max(0, Math.round(Number(v || 0) * 100));
  const draft = { total_cents: cents(pay.total), deposit_cents: cents(pay.deposit), balance_paid_cents: cents(pay.balance) };
  const over = received(draft) > draft.total_cents;
  const setStatus = (status: string) => act(() => api.put(`/admin/bookings/${b.id}`, { status, notify: tell }), 'Status updated');
  const selected = editItems || { s: b.services.map((x: any) => x.service_id), a: b.addons.map((x: any) => x.addon_id) };
  const addonOptions = services.filter((s) => selected.s.includes(s.id)).flatMap((s) => s.addons);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-heading text-3xl tracking-wider">{b.reference}</p><p className="text-sm text-charcoal/55">{b.source === 'admin' ? 'Created by admin' : 'Website booking'} · {new Date(b.created_at).toLocaleString()}</p></div><StatusBadge s={b.status} /></div>

      <div className="grid gap-4 sm:grid-cols-2 text-sm">
        <div><p className="label">Customer</p><p className="font-medium">{b.customer_name}</p><p>{b.customer_email}</p><p>{b.customer_phone}</p>
          <div className="mt-2 flex flex-wrap gap-2">{b.customer_phone && <a className="btn btn-outline btn-sm" href={`tel:${b.customer_phone}`}>Call</a>}{wa && <a className="btn btn-outline btn-sm" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${wa}`}>WhatsApp</a>}{b.customer_email && <a className="btn btn-outline btn-sm" href={`mailto:${b.customer_email}`}>Email</a>}</div></div>
        <div><p className="label">When & where</p><p className="font-medium">{b.booking_date} · {mins(b.start_min)} - {mins(b.end_min)}</p><p>{label(b.location_type)}{b.venue && `: ${b.venue}`}</p><p>{b.people_count} {b.people_count === 1 ? 'person' : 'people'}</p></div>
      </div>

      <div><p className="label">Services</p>
        <ul className="divide-y divide-charcoal/10 text-sm">{b.services.map((s: any) => <li key={s.id} className="flex justify-between py-1.5"><span>{s.name}</span><span>{money(s.price_cents)}</span></li>)}{b.addons.map((s: any) => <li key={`a${s.id}`} className="flex justify-between py-1.5 text-charcoal/65"><span>+ {s.name}</span><span>{money(s.price_cents)}</span></li>)}</ul>
        <p className="mt-2 flex justify-between border-t border-charcoal/15 pt-2 font-heading text-xl"><span>Total{b.promo_code && ` (promo ${b.promo_code})`}</span><span>{money(b.total_cents)}</span></p>
        <button className="mt-2 text-xs text-gold underline" onClick={() => setEditItems(editItems ? null : { s: selected.s, a: selected.a })}>{editItems ? 'Cancel editing services' : 'Change services / add-ons'}</button>
        {editItems && (<div className="mt-3 space-y-2 bg-nude/50 p-3 text-sm"><p className="label">Services</p>
          <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">{services.filter((s) => !s.deleted_at).map((s) => <label key={s.id} className="flex items-center gap-2"><input type="checkbox" checked={editItems.s.includes(s.id)} onChange={() => setEditItems({ ...editItems, s: editItems.s.includes(s.id) ? editItems.s.filter((x) => x !== s.id) : [...editItems.s, s.id] })} />{s.name}</label>)}</div>
          {addonOptions.length > 0 && <><p className="label mt-2">Add-ons</p>{addonOptions.map((a: any) => <label key={a.id} className="flex items-center gap-2"><input type="checkbox" checked={editItems.a.includes(a.id)} onChange={() => setEditItems({ ...editItems, a: editItems.a.includes(a.id) ? editItems.a.filter((x) => x !== a.id) : [...editItems.a, a.id] })} />{a.name}</label>)}</>}
          <button className="btn btn-solid btn-sm mt-2" disabled={busy || !editItems.s.length} onClick={() => act(async () => { await api.put(`/admin/bookings/${b.id}/items`, { serviceIds: editItems.s, addonIds: editItems.a.filter((x) => addonOptions.some((a: any) => a.id === x)) }); setEditItems(null); }, 'Services updated')}>Save services</button></div>)}
      </div>

      {(b.special_requests || b.hairstyling || b.notes) && <div className="text-sm">{b.hairstyling && <p><span className="text-charcoal/55">Hair:</span> {b.hairstyling}</p>}{b.special_requests && <p><span className="text-charcoal/55">Requests:</span> {b.special_requests}</p>}{b.notes && <p><span className="text-charcoal/55">Notes:</span> {b.notes}</p>}</div>}
      {b.reference_images?.length > 0 && <div><p className="label">Reference images</p><div className="flex flex-wrap gap-2">{b.reference_images.map((u: string) => <a key={u} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt="Reference" className="h-20 w-20 object-cover" /></a>)}</div></div>}

      {notice && <CustomerNotice m={notice} onClose={() => setNotice(null)} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="bs">Status</label>
          <select id="bs" className="input" value={b.status} disabled={busy} onChange={(e) => e.target.value === 'cancelled' ? setConfirmCancel(true) : setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
          <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} />Message the customer when the status changes</label></div>
        <div><label className="label" htmlFor="ba">Assigned artist / staff</label><input id="ba" className="input" value={assigned ?? ''} onChange={(e) => setAssigned(e.target.value)} /></div>
      </div>

      <fieldset className="border border-charcoal/10 p-3"><legend className="label !mb-0 px-1">Payments</legend>
        <div className="grid gap-3 sm:grid-cols-4">
          {([['total', 'Total amount'], ['deposit', 'Deposit received'], ['balance', 'Balance received']] as const).map(([k, text]) => (
            <div key={k}><label className="label" htmlFor={`pay-${k}`}>{text}</label><input id={`pay-${k}`} type="number" min={0} step="0.01" inputMode="decimal" className="input" value={pay[k]} onFocus={(e) => e.target.select()} onChange={(e) => setPay({ ...pay, [k]: e.target.value })} /></div>))}
          <div><p className="label">Pending amount</p><p className={`py-2 font-heading text-2xl ${pendingOf(draft) > 0 ? 'text-rose' : ''}`}>{money(pendingOf(draft))}</p></div>
        </div>
        <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm"><span>Total received: <strong>{money(received(draft))}</strong> of {money(draft.total_cents)}</span>
          {draft.total_cents > 0 && pendingOf(draft) > 0 && <button type="button" className="text-xs text-gold underline" onClick={() => setPay({ ...pay, balance: String((draft.total_cents - draft.deposit_cents) / 100) })}>Mark fully paid</button>}</p>
        {over && <p role="alert" className="mt-1 text-xs text-rose">Payments received are more than the total amount.</p>}
        <p className="mt-1 text-xs text-charcoal/50">Click Save details to keep these amounts. Save them before changing the status, so the customer's message shows the latest figures.</p>
      </fieldset>
      <div><label className="label" htmlFor="bn">Internal notes (never shown to client)</label><textarea id="bn" rows={3} className="input" value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} /></div>
      <button className="btn btn-solid btn-sm" disabled={busy || over} onClick={() => act(() => api.put(`/admin/bookings/${b.id}`, { internal_notes: notes ?? '', assigned_to: assigned ?? '', ...draft }), 'Saved')}>Save details</button>

      <div className="border-t border-charcoal/10 pt-4"><p className="label">Reschedule</p>
        <div className="flex flex-wrap items-end gap-3"><input type="date" className="input !w-auto" value={rs.date} onChange={(e) => setRs({ date: e.target.value, time: '' })} aria-label="New date" />
          <select className="input !w-auto" value={rs.time} onChange={(e) => setRs({ ...rs, time: e.target.value })} aria-label="New time"><option value="">Select time</option>{slots.map((s) => <option key={s.start}>{s.start}</option>)}</select>
          <button className="btn btn-outline btn-sm" disabled={busy || !rs.time} onClick={() => act(() => api.post(`/admin/bookings/${b.id}/reschedule`, rs), 'Rescheduled')}>Reschedule</button></div>
        <p className="mt-1 text-xs text-charcoal/50">Duration {fmtDuration(b.end_min - b.start_min)}. Only free times are listed.</p></div>
      <Confirm open={confirmCancel} confirmLabel="Cancel booking" message={`Cancel this booking? The time slot is freed${tell ? ' and the customer is messaged' : ''}.`} onNo={() => setConfirmCancel(false)} onYes={() => { setConfirmCancel(false); setStatus('cancelled'); }} />
      <button className="hidden" onClick={onClose} />
    </div>
  );
}

function ManualBooking({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const { data: services } = useLoad<any[]>('/admin/services');
  const [f, setF] = useState({ serviceId: 0, date: iso(new Date()), time: '', name: '', phone: '', email: '', locationType: 'studio', venue: '', notify: false });
  const [slots, setSlots] = useState<{ start: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const svc = services?.find((s) => s.id === f.serviceId);
  useEffect(() => { if (svc && f.date) api.get(`/admin/bookings/slots?date=${f.date}&duration=${svc.duration_min || 60}&location=${f.locationType}`).then(setSlots).catch(() => setSlots([])); }, [svc?.id, f.date, f.locationType]); // eslint-disable-line
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post('/admin/bookings', { serviceIds: [f.serviceId], addonIds: [], date: f.date, time: f.time, customer: { name: f.name, phone: f.phone, email: f.email, whatsapp: '' }, event: { locationType: f.locationType, venue: f.venue, people: 1 }, sendNotifications: f.notify });
      toast('Booking created'); onCreated(); onClose();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div><label className="label">Service</label><select className="input" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: Number(e.target.value), time: '' })}><option value={0}>Select…</option>{services?.filter((s) => s.available && s.bookable).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><label className="label">Date</label><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value, time: '' })} /></div>
        <div><label className="label">Time</label><select className="input" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })}><option value="">Select…</option>{slots.map((s) => <option key={s.start}>{s.start}</option>)}</select></div>
        <div><label className="label">Client name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="label">Phone</label><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="label">Email</label><input type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><label className="label">Location</label><select className="input" value={f.locationType} onChange={(e) => setF({ ...f, locationType: e.target.value, time: '' })}>{['studio', 'client_home', 'hotel', 'event_venue', 'other'].map((l) => <option key={l} value={l}>{label(l)}</option>)}</select></div>
        <div><label className="label">Venue</label><input className="input" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} /></div></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} />Email the client a confirmation</label>
      <ErrorNote message={err} /><div className="flex justify-end"><button className="btn btn-solid btn-sm" disabled={busy || !f.serviceId || !f.time || !f.name || !f.phone || !f.email} onClick={submit}>{busy ? <Spinner /> : 'Create booking'}</button></div>
    </div>
  );
}

export default function Bookings() {
  const [view, setView] = useState<'list' | 'month' | 'week' | 'day'>('list');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(() => new Date());
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragNotice, setDragNotice] = useState<any | null>(null);
  const toast = useToast();
  const { money } = useSite();

  const range = useMemo(() => {
    if (view === 'list') return { from: '', to: '' };
    const c = new Date(cursor);
    if (view === 'month') return { from: iso(new Date(c.getFullYear(), c.getMonth(), 1)), to: iso(new Date(c.getFullYear(), c.getMonth() + 1, 0)) };
    if (view === 'week') { const s = new Date(c); s.setDate(c.getDate() - c.getDay()); const e = new Date(s); e.setDate(s.getDate() + 6); return { from: iso(s), to: iso(e) }; }
    return { from: iso(c), to: iso(c) };
  }, [view, cursor]);
  const [dq, setDq] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams({ ...(status && { status }), ...(dq && { q: dq }), ...(range.from && { from: range.from, to: range.to }) }).toString();
  const { data, loading, error, reload } = useLoad<any[]>(`/admin/bookings?${qs}`);

  const step = (d: number) => { const c = new Date(cursor); if (view === 'month') c.setMonth(c.getMonth() + d); else c.setDate(c.getDate() + d * (view === 'week' ? 7 : 1)); setCursor(c); };
  const byDate = useMemo(() => { const m: Record<string, any[]> = {}; (data || []).forEach((b) => (m[b.booking_date] ||= []).push(b)); Object.values(m).forEach((l) => l.sort((a, b) => a.start_min - b.start_min)); return m; }, [data]);

  /** Drag a booking chip onto another day to move it (same time; server rechecks availability). */
  const drop = async (id: number, date: string) => {
    const b = data?.find((x) => x.id === id);
    if (!b || b.booking_date === date) return;
    try { const r = await api.post(`/admin/bookings/${id}/reschedule`, { date, time: mins(b.start_min) }); toast(`Moved to ${date}`); reload(); setDragNotice(r.messages); setOpen(id); } catch (e) { toast(errorMessage(e), 'err'); }
  };
  const chip = (b: any) => (
    <button key={b.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(b.id))} onClick={() => setOpen(b.id)} title={`${b.customer_name} · ${b.service_names}`}
      className={`mb-1 block w-full truncate rounded px-1.5 py-1 text-left text-[11px] ${COLORS[b.status] || 'bg-nude'}`}>{mins(b.start_min)} {b.customer_name}</button>
  );

  const days = useMemo(() => {
    if (view === 'month') { const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1); const n = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate(); return [...Array(first.getDay()).fill(null), ...Array.from({ length: n }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1))]; }
    if (view === 'week') { const s = new Date(cursor); s.setDate(cursor.getDate() - cursor.getDay()); return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; }); }
    return [new Date(cursor)];
  }, [view, cursor]);

  return (
    <div>
      <PageHeader title="Bookings" actions={<button className="btn btn-solid btn-sm" onClick={() => setCreating(true)}>+ New booking</button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex border border-charcoal/15 bg-paper" role="tablist">{(['list', 'month', 'week', 'day'] as const).map((v) => <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`px-3.5 py-2 text-xs uppercase tracking-widest ${view === v ? 'bg-charcoal text-paper' : ''}`}>{v}</button>)}</div>
        {view !== 'list' && <div className="flex items-center gap-1"><button className="btn btn-ghost btn-sm" onClick={() => step(-1)} aria-label="Previous">‹</button><span className="min-w-36 text-center font-heading text-xl">{view === 'month' ? cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : view === 'week' ? `${range.from} → ${range.to}` : range.from}</span><button className="btn btn-ghost btn-sm" onClick={() => step(1)} aria-label="Next">›</button><button className="btn btn-ghost btn-sm" onClick={() => setCursor(new Date())}>Today</button></div>}
        <input type="search" placeholder="Search name, email, phone, reference" aria-label="Search bookings" className="input !w-64 !py-2" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-auto !py-2" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      </div>
      <ErrorNote message={error} />
      {!!data?.length && (
        <dl className="mb-4 grid gap-3 sm:grid-cols-3">{([['Total amount', (b: any) => b.total_cents], ['Received', received], ['Pending', pendingOf]] as const).map(([name, value]) => (
          <div key={name} className="admin-card p-3"><dt className="label !mb-0">{name}</dt><dd className="font-heading text-2xl">{money(data.filter((b) => !DEAD.includes(b.status)).reduce((n, b) => n + value(b), 0))}</dd></div>))}
          <p className="text-xs text-charcoal/45 sm:col-span-3">For the bookings shown, not counting cancelled or rejected ones.</p></dl>
      )}
      {loading ? <PageLoader /> : view === 'list' ? (
        !data?.length ? <div className="admin-card p-10 text-center text-charcoal/60">No bookings match.</div> :
          <div className="admin-card overflow-x-auto"><table className="w-full min-w-[900px]"><thead><tr><th className="admin-th">Ref</th><th className="admin-th">Client</th><th className="admin-th">Services</th><th className="admin-th">When</th><th className="admin-th">Total</th><th className="admin-th">Received</th><th className="admin-th">Pending</th><th className="admin-th">Status</th></tr></thead>
            <tbody>{data.map((b) => <tr key={b.id} className="cursor-pointer hover:bg-nude/40" onClick={() => setOpen(b.id)}><td className="admin-td font-mono text-xs">{b.reference}</td><td className="admin-td">{b.customer_name}<span className="block text-xs text-charcoal/50">{b.customer_phone}</span></td><td className="admin-td max-w-[220px] truncate">{b.service_names}</td><td className="admin-td whitespace-nowrap">{b.booking_date} {mins(b.start_min)}</td><td className="admin-td whitespace-nowrap">{money(b.total_cents)}</td><td className="admin-td whitespace-nowrap">{money(received(b))}</td><td className={`admin-td whitespace-nowrap ${pendingOf(b) > 0 && !DEAD.includes(b.status) ? 'text-rose' : ''}`}>{DEAD.includes(b.status) ? '-' : money(pendingOf(b))}</td><td className="admin-td"><StatusBadge s={b.status} /></td></tr>)}</tbody></table></div>
      ) : (
        <div className={`grid gap-px bg-charcoal/10 ${view === 'day' ? 'grid-cols-1' : 'grid-cols-7'}`}>
          {view !== 'day' && ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="bg-paper py-1.5 text-center text-[11px] uppercase tracking-widest text-charcoal/50">{d}</div>)}
          {days.map((d, i) => { if (!d) return <div key={i} className="bg-ivory" />; const key = iso(d); const list = byDate[key] || [];
            return <div key={key} onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(Number(e.dataTransfer.getData('text/plain')), key)} className={`bg-paper p-1.5 ${view === 'month' ? 'min-h-24' : 'min-h-40'} ${key === iso(new Date()) ? 'ring-1 ring-inset ring-gold' : ''}`}>
              <p className="mb-1 text-xs text-charcoal/50">{d.getDate()}</p>{list.map(chip)}</div>; })}
        </div>)}
      <p className="mt-3 text-xs text-charcoal/45">Tip: in the calendar views, drag a booking onto another day to reschedule it at the same time.</p>
      <Modal open={open !== null} onClose={() => { setOpen(null); setDragNotice(null); }} title="Booking" wide>{open !== null && <BookingDetail id={open} initialNotice={dragNotice} onClose={() => setOpen(null)} onChanged={reload} />}</Modal>
      <Modal open={creating} onClose={() => setCreating(false)} title="New booking">{creating && <ManualBooking onClose={() => setCreating(false)} onCreated={reload} />}</Modal>
    </div>
  );
}

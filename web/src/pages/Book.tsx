import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { fmtDuration, priceLabel, track, useSite, whatsappUrl } from '../lib/site';
import { useSeo } from '../lib/seo';
import { useUploadEditor } from '../components/UploadEditor';
import { ErrorNote, Icon, Img, PageLoader, Spinner } from '../components/ui';

const STEPS = ['Service', 'Add-ons', 'Date & time', 'Your details', 'Event', 'Review'];
const LOCATIONS = [['studio', 'Studio'], ['client_home', 'Client home'], ['hotel', 'Hotel'], ['event_venue', 'Event venue'], ['other', 'Other']] as const;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function Calendar({ month, setMonth, available, value, onPick, loading }: { month: Date; setMonth: (d: Date) => void; available: Set<string>; value: string; onPick: (d: string) => void; loading: boolean }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" className="btn btn-ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
        <p className="font-heading text-2xl">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}{loading && <Spinner className="ml-2 align-middle" />}</p>
        <button type="button" className="btn btn-ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-widest text-charcoal/50">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const date = iso(new Date(month.getFullYear(), month.getMonth(), d));
          const ok = available.has(date), sel = value === date;
          return <button key={i} type="button" disabled={!ok} onClick={() => onPick(date)} aria-pressed={sel} aria-label={`${date}${ok ? '' : ' unavailable'}`}
            className={`aspect-square text-sm transition-colors ${sel ? 'bg-charcoal text-paper' : ok ? 'bg-paper hover:bg-blush' : 'text-charcoal/25'}`}>{d}</button>;
        })}
      </div>
    </div>
  );
}

export default function Book() {
  useSeo('book');
  const { site, money } = useSite();
  const [params] = useSearchParams();
  const [services, setServices] = useState<any[] | null>(null);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [sel, setSel] = useState<number[]>([]);
  const [addons, setAddons] = useState<number[]>([]);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [avail, setAvail] = useState<Set<string>>(new Set());
  const [availLoading, setAvailLoading] = useState(false);
  const [slots, setSlots] = useState<{ start: string; end: string }[] | null>(null);
  const [customer, setCustomer] = useState({ name: '', phone: '', whatsapp: '', email: '' });
  const [event, setEvent] = useState({ locationType: 'studio', venue: '', people: 1, hairstyling: '', specialRequests: '', notes: '' });
  const [refs, setRefs] = useState<string[]>([]);
  const [promo, setPromo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<any | null>(null);
  const { edit, editor } = useUploadEditor();

  useEffect(() => { api.get('/public/services').then((s) => { const b = s.filter((x: any) => x.bookable); setServices(b); const pre = Number(params.get('service')); if (pre && b.some((x: any) => x.id === pre)) setSel([pre]); }).catch(() => setServices([])); }, []); // eslint-disable-line

  const chosen = useMemo(() => (services || []).filter((s) => sel.includes(s.id)), [services, sel]);
  const availableAddons = chosen.flatMap((s) => s.addons.map((a: any) => ({ ...a, service: s.name })));
  const chosenAddons = availableAddons.filter((a) => addons.includes(a.id));
  const duration = [...chosen, ...chosenAddons].reduce((n, x) => n + x.duration_min, 0);
  const subtotal = [...chosen, ...chosenAddons].reduce((n, x) => n + x.price_cents, 0);
  const hasCustom = chosen.some((s) => s.price_type === 'custom');
  // A total is only shown when every chosen service publishes a duration, otherwise it would be misleading.
  const showDuration = chosen.every((s) => s.duration_min > 0);
  const key = `${sel.join(',')}|${addons.join(',')}|${event.locationType}`;

  useEffect(() => { setDate(''); setTime(''); setSlots(null); }, [key]);
  useEffect(() => {
    if (step !== 2 || !sel.length) return;
    setAvailLoading(true);
    api.get(`/public/availability/month?month=${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}&serviceIds=${sel.join(',')}&location=${event.locationType}`)
      .then((r) => setAvail(new Set(r.available))).catch(() => setAvail(new Set())).finally(() => setAvailLoading(false));
  }, [step, month, key]); // eslint-disable-line
  useEffect(() => {
    if (!date) return;
    setSlots(null); setTime('');
    api.get(`/public/availability?date=${date}&serviceIds=${sel.join(',')}&addonIds=${addons.join(',')}&location=${event.locationType}`).then((r) => setSlots(r.slots)).catch((e) => { setSlots([]); setErr(errorMessage(e)); });
  }, [date]); // eslint-disable-line

  const go = (n: number) => { setDir(n > step ? 1 : -1); setErr(null); setStep(n); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const valid = [sel.length > 0, true, !!date && !!time, customer.name.trim().length > 1 && /^[+\d][\d\s().-]{5,}$/.test(customer.phone) && /\S+@\S+\.\S+/.test(customer.email), event.people >= 1 && (event.locationType === 'studio' || event.venue.trim().length > 2), true][step];

  const uploadRef = async (picked: File[]) => {
    const chosen = await edit(picked.slice(0, 6 - refs.length));
    if (!chosen.length) return;
    setErr(null);
    try { for (const f of chosen) { const r = await api.upload('/public/upload', [f], {}, undefined, 'file'); setRefs((x) => [...x, r.url]); } } catch (e) { setErr(errorMessage(e)); }
  };

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/public/bookings', { serviceIds: sel, addonIds: addons, date, time, customer, event: { ...event, referenceImages: refs }, promoCode: promo || undefined, website: '' });
      track('booking_complete'); setDone(r);
    } catch (e: any) {
      setErr(errorMessage(e));
      if (e?.status === 409) { go(2); setDate(''); }
    } finally { setBusy(false); }
  };

  if (!services) return <div className="pt-32"><PageLoader /></div>;

  if (done) return (
    <div className="container-x pt-36 pb-24"><motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-xl bg-paper p-8 text-center sm:p-12">
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.2 }} className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-gold/15 text-3xl text-gold">✓</motion.div>
      <p className="eyebrow mb-2">Booking request received</p><h1 className="text-4xl">Thank you, {customer.name.split(' ')[0]}</h1>
      <p className="mt-4 text-charcoal/70">We have received your request for <strong>{done.services?.join(', ')}</strong> on <strong>{done.date}</strong> at <strong>{done.time}</strong>. {done.status === 'confirmed' ? 'Your booking is confirmed.' : 'We will confirm it shortly by email.'}</p>
      <p className="mt-5 text-sm text-charcoal/55">Reference</p><p className="font-heading text-3xl tracking-widest">{done.reference}</p>
      {done.discount_cents > 0 && <p className="mt-2 text-sm text-gold">Promo applied: -{money(done.discount_cents)}</p>}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {site?.settings.contact?.whatsapp && <a className="btn btn-gold" target="_blank" rel="noopener noreferrer" onClick={() => track('whatsapp_click')} href={whatsappUrl(site, `Hi, I just submitted booking ${done.reference} for ${done.date} ${done.time}.`)}><Icon name="whatsapp" className="h-4 w-4" />Message on WhatsApp</a>}
        <Link to="/" className="btn btn-outline">Back home</Link>
      </div>
    </motion.div></div>
  );

  return (
    <div className="pt-28 sm:pt-36"><div className="container-x pb-32">
      <div className="mx-auto max-w-4xl">
        <p className="eyebrow mb-2 text-center">Book an appointment</p>
        <ol className="mb-10 flex justify-between gap-1" aria-label="Progress">{STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 flex-col items-center gap-1.5" aria-current={i === step ? 'step' : undefined}>
            <span className={`h-1 w-full transition-colors duration-500 ${i <= step ? 'bg-gold' : 'bg-charcoal/15'}`} />
            <span className={`hidden text-[10px] uppercase tracking-widest sm:block ${i === step ? 'text-charcoal' : 'text-charcoal/40'}`}>{s}</span>
          </li>))}</ol>

        <div className="grid gap-8 md:grid-cols-3">
          <div className="md:col-span-2">
            <AnimatePresence mode="wait" custom={dir}>
              <motion.div key={step} custom={dir} initial={{ opacity: 0, x: 30 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 * dir }} transition={{ duration: 0.25 }}>
                {step === 0 && (<div><h1 className="mb-6 text-4xl">Choose your service</h1>
                  <div className="space-y-3">{services.map((s) => (
                    <label key={s.id} className={`flex cursor-pointer gap-4 border bg-paper p-3 transition-colors ${sel.includes(s.id) ? 'border-gold' : 'border-transparent hover:border-charcoal/20'}`}>
                      <input type="checkbox" className="sr-only" checked={sel.includes(s.id)} onChange={() => setSel((x) => (x.includes(s.id) ? x.filter((i) => i !== s.id) : [...x, s.id]))} />
                      <Img src={s.image_url} alt="" className="h-20 w-20 shrink-0" />
                      <span className="flex-1"><span className="block font-heading text-xl">{s.name}</span><span className="block text-xs text-charcoal/55">{[s.category_name, fmtDuration(s.duration_min)].filter(Boolean).join(' · ')}</span><span className="mt-1 block text-sm">{priceLabel(s, money)}</span></span>
                      <span aria-hidden className={`mt-1 grid h-5 w-5 shrink-0 place-items-center border text-xs ${sel.includes(s.id) ? 'border-gold bg-gold text-paper' : 'border-charcoal/30'}`}>{sel.includes(s.id) && '✓'}</span>
                    </label>))}</div></div>)}

                {step === 1 && (<div><h1 className="mb-6 text-4xl">Add-ons</h1>
                  {!availableAddons.length ? <p className="text-charcoal/60">No add-ons for your selection. Continue to choose a date.</p> : <div className="space-y-3">{availableAddons.map((a) => (
                    <label key={a.id} className={`flex cursor-pointer items-center justify-between gap-4 border bg-paper p-4 ${addons.includes(a.id) ? 'border-gold' : 'border-transparent'}`}>
                      <span><span className="block">{a.name}</span><span className="text-xs text-charcoal/55">{a.service}{a.duration_min > 0 && ` · +${fmtDuration(a.duration_min)}`}</span></span>
                      <span className="flex items-center gap-3">{a.price_cents > 0 && <span>{money(a.price_cents)}</span>}<input type="checkbox" checked={addons.includes(a.id)} onChange={() => setAddons((x) => (x.includes(a.id) ? x.filter((i) => i !== a.id) : [...x, a.id]))} className="h-4 w-4 accent-[rgb(var(--c-gold))]" /></span>
                    </label>))}</div>}</div>)}

                {step === 2 && (<div><h1 className="mb-6 text-4xl">Pick a date & time</h1>
                  <div className="bg-paper p-4"><Calendar month={month} setMonth={setMonth} available={avail} value={date} onPick={setDate} loading={availLoading} /></div>
                  {date && (<div className="mt-6"><p className="label">Available times on {date}</p>
                    {!slots ? <Spinner /> : !slots.length ? <p className="text-sm text-charcoal/60">No times left on this day. Choose another date.</p> :
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{slots.map((s) => <button key={s.start} type="button" onClick={() => setTime(s.start)} aria-pressed={time === s.start} className={`border py-2.5 text-sm transition-colors ${time === s.start ? 'border-charcoal bg-charcoal text-paper' : 'border-charcoal/20 bg-paper hover:border-gold'}`}>{s.start}</button>)}</div>}</div>)}
                  {!availLoading && avail.size === 0 && <p className="mt-4 text-sm text-charcoal/60">No availability this month. Try the next month, or message us on WhatsApp.</p>}</div>)}

                {step === 3 && (<div><h1 className="mb-6 text-4xl">Your details</h1><div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2"><label className="label" htmlFor="b-name">Full name *</label><input id="b-name" className="input" autoComplete="name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></div>
                  <div><label className="label" htmlFor="b-phone">Phone *</label><input id="b-phone" type="tel" className="input" autoComplete="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></div>
                  <div><label className="label" htmlFor="b-wa">WhatsApp</label><input id="b-wa" type="tel" className="input" placeholder="If different" value={customer.whatsapp} onChange={(e) => setCustomer({ ...customer, whatsapp: e.target.value })} /></div>
                  <div className="sm:col-span-2"><label className="label" htmlFor="b-email">Email *</label><input id="b-email" type="email" className="input" autoComplete="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} /></div></div></div>)}

                {step === 4 && (<div><h1 className="mb-6 text-4xl">Event details</h1><div className="space-y-4">
                  <div><p className="label">Location</p><div className="flex flex-wrap gap-2">{LOCATIONS.map(([v, l]) => <button key={v} type="button" aria-pressed={event.locationType === v} onClick={() => setEvent({ ...event, locationType: v })} className={`border px-4 py-2 text-xs uppercase tracking-widest ${event.locationType === v ? 'border-charcoal bg-charcoal text-paper' : 'border-charcoal/20 bg-paper'}`}>{l}</button>)}</div>
                    {event.locationType !== 'studio' && <p className="mt-2 text-xs text-charcoal/55">Travel time is allowed for in the schedule. Availability updates when you change location.</p>}</div>
                  {event.locationType !== 'studio' && <div><label className="label" htmlFor="b-venue">Venue / address *</label><input id="b-venue" className="input" value={event.venue} onChange={(e) => setEvent({ ...event, venue: e.target.value })} /></div>}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><label className="label" htmlFor="b-people">Number of people</label><input id="b-people" type="number" min={1} max={50} className="input" value={event.people} onChange={(e) => setEvent({ ...event, people: Math.max(1, Number(e.target.value) || 1) })} /></div>
                    <div><label className="label" htmlFor="b-hair">Hairstyling requirements</label><input id="b-hair" className="input" value={event.hairstyling} onChange={(e) => setEvent({ ...event, hairstyling: e.target.value })} /></div></div>
                  <div><label className="label" htmlFor="b-req">Special requests</label><textarea id="b-req" rows={3} className="input" value={event.specialRequests} onChange={(e) => setEvent({ ...event, specialRequests: e.target.value })} /></div>
                  <div><label className="label" htmlFor="b-notes">Additional notes</label><textarea id="b-notes" rows={2} className="input" value={event.notes} onChange={(e) => setEvent({ ...event, notes: e.target.value })} /></div>
                  <div><label className="label" htmlFor="b-ref">Reference images</label><input id="b-ref" type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e) => { uploadRef(Array.from(e.target.files || [])); e.target.value = ''; }} className="text-sm" />
                    {editor}
                    <div className="mt-2 flex gap-2">{refs.map((u) => <img key={u} src={u} alt="Reference" className="h-14 w-14 object-cover" />)}</div></div></div></div>)}

                {step === 5 && (<div><h1 className="mb-6 text-4xl">Review & confirm</h1>
                  <dl className="divide-y divide-charcoal/10 bg-paper p-5 text-sm">
                    {[['Services', chosen.map((s) => s.name).join(', ')], ['Add-ons', chosenAddons.map((a) => a.name).join(', ') || 'None'], ['When', `${date} at ${time}${showDuration ? ` (${fmtDuration(duration)})` : ''}`], ['Where', LOCATIONS.find(([v]) => v === event.locationType)![1] + (event.venue ? `: ${event.venue}` : '')], ['Name', customer.name], ['Contact', `${customer.phone} · ${customer.email}`], ['People', String(event.people)]].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-charcoal/55">{k}</dt><dd className="text-right">{v}</dd></div>))}</dl>
                  <div className="mt-4"><label className="label" htmlFor="b-promo">Promo code</label><input id="b-promo" className="input uppercase" value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="Optional" /></div>
                  <p className="mt-4 text-xs text-charcoal/55">{site?.settings.policies?.cancellation} <Link className="underline" to="/policy/cancellation" target="_blank">Full policy</Link></p></div>)}
              </motion.div>
            </AnimatePresence>
            <div className="mt-6"><ErrorNote message={err} /></div>
            <div className="mt-8 flex justify-between">
              <button className="btn btn-ghost" onClick={() => go(step - 1)} disabled={step === 0}>← Back</button>
              {step < 5 ? <button className="btn btn-solid" disabled={!valid} onClick={() => go(step + 1)}>Continue</button>
                : <button className="btn btn-gold" disabled={busy} onClick={submit}>{busy ? <Spinner /> : 'Submit booking'}</button>}
            </div>
          </div>
          <aside className="h-fit bg-paper p-5 md:sticky md:top-28" aria-label="Summary">
            <p className="eyebrow mb-3">Your booking</p>
            {!chosen.length ? <p className="text-sm text-charcoal/50">Select a service to begin.</p> : (<ul className="space-y-2 text-sm">{[...chosen, ...chosenAddons].map((x: any, i) => <li key={i} className="flex justify-between gap-3"><span>{x.name}</span><span>{x.price_type === 'custom' ? 'Quote' : x.price_cents > 0 ? money(x.price_cents) : ''}</span></li>)}</ul>)}
            {chosen.length > 0 && (showDuration || hasCustom || subtotal > 0) && <div className="mt-4 border-t border-charcoal/10 pt-3 text-sm">
              {showDuration && <div className="flex justify-between"><span className="text-charcoal/60">Duration</span><span>{fmtDuration(duration)}</span></div>}
              {(hasCustom || subtotal > 0) && <div className="mt-1 flex justify-between font-heading text-xl"><span>Total</span><span>{hasCustom ? 'To be quoted' : money(subtotal)}</span></div>}</div>}
            {date && time && <p className="mt-3 text-sm text-gold">{date} · {time}</p>}
          </aside>
        </div>
      </div>
    </div></div>
  );
}

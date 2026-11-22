import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { Icon, ErrorNote, Reveal, Spinner } from '../components/ui';
import { track, useSite, whatsappUrl } from '../lib/site';
import { useSeo } from '../lib/seo';

export function ContactForm({ compact }: { compact?: boolean }) {
  const { site } = useSite();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const services = site?.featuredServices || [];

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true); setErr(null);
    try {
      const urls: string[] = [];
      for (const f of Array.from(list).slice(0, 3)) urls.push((await api.upload('/public/upload', [f], {}, undefined, 'file')).url);
      setFiles((x) => [...x, ...urls].slice(0, 5));
    } catch (e) { setErr(errorMessage(e)); } finally { setUploading(false); }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setErr(null);
    try {
      await api.post('/public/inquiries', {
        name: f.get('name'), phone: f.get('phone'), email: f.get('email'), service_interest: f.get('service'), event_date: f.get('date') || undefined,
        message: f.get('message'), attachments: files, website: f.get('website'),
      });
      track('form_submit'); setDone(true);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  if (done) return <div role="status" className="py-8 text-center"><p className="font-heading text-3xl">Thank you</p><p className="mt-2 text-charcoal/65">Your enquiry has been received. We will reply as soon as possible.</p></div>;
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="c-name">Name *</label><input id="c-name" name="name" required minLength={2} autoComplete="name" className="input" /></div>
        <div><label className="label" htmlFor="c-phone">Phone</label><input id="c-phone" name="phone" type="tel" autoComplete="tel" className="input" /></div>
        <div><label className="label" htmlFor="c-email">Email</label><input id="c-email" name="email" type="email" autoComplete="email" className="input" /></div>
        <div><label className="label" htmlFor="c-date">Event date</label><input id="c-date" name="date" type="date" className="input" /></div>
      </div>
      <div><label className="label" htmlFor="c-service">Service interested in</label>
        <select id="c-service" name="service" className="input" defaultValue=""><option value="">Select a service</option>{services.map((s) => <option key={s.id}>{s.name}</option>)}<option>Other</option></select></div>
      <div><label className="label" htmlFor="c-msg">Message *</label><textarea id="c-msg" name="message" required minLength={5} rows={compact ? 4 : 6} className="input" /></div>
      <div>
        <label className="label" htmlFor="c-file">Reference photos (optional)</label>
        <input id="c-file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple onChange={(e) => upload(e.target.files)} className="text-sm" />
        {uploading && <Spinner className="ml-2 align-middle" />}
        {files.length > 0 && <div className="mt-2 flex gap-2">{files.map((u) => <img key={u} src={u} alt="Reference" className="h-14 w-14 object-cover" />)}</div>}
      </div>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />
      <ErrorNote message={err} />
      <button className="btn btn-solid w-full sm:w-auto" disabled={busy || uploading}>{busy ? <Spinner /> : 'Send enquiry'}</button>
    </form>
  );
}

export default function ContactPage() {
  useSeo('contact');
  const { site } = useSite();
  const c = site?.settings.contact || {};
  const faqs: { q: string; a: string }[] = site?.settings.faqs || [];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const t = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return (
    <div className="pt-28 sm:pt-36">
      <div className="container-x">
        <Reveal className="mb-12 max-w-2xl"><p className="eyebrow mb-3">Contact</p><h1 className="text-5xl sm:text-6xl">Let us plan your look</h1></Reveal>
        <div className="grid gap-12 lg:grid-cols-5">
          <div className="space-y-8 lg:col-span-2">
            <div className="flex flex-wrap gap-3">
              {c.whatsapp && <a href={whatsappUrl(site)} target="_blank" rel="noopener noreferrer" onClick={() => track('whatsapp_click')} className="btn btn-gold"><Icon name="whatsapp" className="h-4 w-4" />WhatsApp</a>}
              {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} onClick={() => track('call_click')} className="btn btn-outline"><Icon name="phone" className="h-4 w-4" />{c.phone}</a>}
              {c.email && <a href={`mailto:${c.email}`} onClick={() => track('email_click')} className="btn btn-outline"><Icon name="mail" className="h-4 w-4" />Email</a>}
            </div>
            {c.address && <div><p className="eyebrow mb-2">Studio</p><p className="text-charcoal/70">{c.address}</p>{c.mapLink && <a className="mt-1 inline-block text-sm text-gold underline" href={c.mapLink} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>}</div>}
            <div><p className="eyebrow mb-2">Hours</p>
              <ul className="space-y-1 text-sm text-charcoal/70">{site?.hours.map((h) => <li key={h.weekday} className="flex justify-between"><span>{dayNames[h.weekday]}</span><span>{h.closed ? 'Closed' : `${t(h.open_min)} - ${t(h.close_min)}`}</span></li>)}</ul></div>
            {c.mapEmbed && /^https:\/\/www\.google\.com\/maps\/embed/.test(c.mapEmbed) && <iframe title="Map" src={c.mapEmbed} loading="lazy" className="h-64 w-full border-0" referrerPolicy="no-referrer-when-downgrade" />}
          </div>
          <div className="bg-paper p-6 sm:p-8 lg:col-span-3"><ContactForm /></div>
        </div>
        {faqs.length > 0 && (
          <div className="mx-auto mt-24 max-w-3xl pb-24"><h2 className="mb-6 text-center text-4xl">Frequently asked questions</h2>
            <div className="divide-y divide-charcoal/10 border-y border-charcoal/10">{faqs.map((f, i) => (
              <details key={i} className="group py-4"><summary className="flex cursor-pointer list-none items-center justify-between font-heading text-xl">{f.q}<span className="text-gold transition-transform group-open:rotate-45">+</span></summary><p className="mt-3 text-charcoal/70">{f.a}</p></details>))}</div></div>
        )}
      </div>
    </div>
  );
}

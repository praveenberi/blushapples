import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useSite } from '../lib/site';
import { useLoad, useToast } from './kit';

const message = (brand: string, name: string, url: string) =>
  `Hi${name ? ` ${name}` : ''},\nThank you for choosing ${brand}. We would love your feedback, it takes about a minute:\n${url}`;

/** Make a private feedback link and share it. Answers arrive in the list below, waiting for approval. */
export function FeedbackLinks() {
  const toast = useToast();
  const { site } = useSite();
  const brand = site?.settings.brand?.name || 'us';
  const { data, reload } = useLoad<any[]>('/admin/feedback-links');
  const [name, setName] = useState('');
  const [service, setService] = useState('');
  const [made, setMade] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try { setMade(await api.post('/admin/feedback-links', { customer_name: name.trim(), service_category: service.trim() })); setName(''); setService(''); reload(); }
    catch (e) { toast(errorMessage(e), 'err'); } finally { setBusy(false); }
  };
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { window.prompt('Copy this link', url); }
  };
  const share = (f: any) => {
    const body = message(brand, f.customer_name, f.url);
    return (<>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => copy(f.url)}>Copy link</button>
      <a className="btn btn-outline btn-sm" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(body)}`}>WhatsApp</a>
      <a className="btn btn-outline btn-sm" href={`mailto:?subject=${encodeURIComponent(`Your feedback for ${brand}`)}&body=${encodeURIComponent(body)}`}>Email</a>
    </>);
  };
  const state = (f: any) => (f.used_at ? 'Answered' : new Date(f.expires_at).getTime() < Date.now() ? 'Expired' : 'Waiting');

  return (
    <section className="admin-card mb-6 p-5">
      <h2 className="text-2xl">Ask a customer for feedback</h2>
      <p className="mt-1 text-sm text-charcoal/60">Each link works once and lasts 90 days. New reviews stay hidden until you approve them.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-44 flex-1"><label className="label" htmlFor="fl-name">Customer name (optional)</label><input id="fl-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></div>
        <div className="min-w-44 flex-1"><label className="label" htmlFor="fl-svc">Service (optional)</label><input id="fl-svc" className="input" value={service} maxLength={120} onChange={(e) => setService(e.target.value)} /></div>
        <button type="button" className="btn btn-solid btn-sm" disabled={busy} onClick={generate}>Generate link</button>
      </div>
      {made && (
        <div className="mt-4 bg-nude/50 p-3">
          <input readOnly className="input !py-2 text-sm" value={made.url} aria-label="Feedback link" onFocus={(e) => e.target.select()} />
          <div className="mt-2 flex flex-wrap gap-2">{share(made)}</div>
        </div>
      )}
      {!!data?.length && (
        <details className="mt-4"><summary className="cursor-pointer text-sm text-gold">Recent links ({data.length})</summary>
          <ul className="mt-2 max-h-64 divide-y divide-charcoal/10 overflow-y-auto text-sm">{data.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{f.customer_name || 'Anyone with the link'}{f.reference && <span className="text-charcoal/50"> · {f.reference}</span>} <span className="badge ml-1">{state(f)}</span></span>
              {state(f) === 'Waiting' && <span className="flex flex-wrap gap-1.5">{share(f)}</span>}
            </li>))}</ul>
        </details>
      )}
    </section>
  );
}

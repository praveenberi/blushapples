import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, mins } from '../lib/api';
import { useToast } from './kit';

interface Alert { id: number; reference: string; booking_date: string; start_min: number; customer_name: string; service_names: string; whatsappUrl?: string | null }
interface Alerts { hours: number; newRequests: Alert[]; upcoming: Alert[] }

const SEEN_KEY = 'ba_alerted';
const POLL_MS = 60_000;
const when = (a: Alert) => `${a.booking_date} ${mins(a.start_min)}`;
// the date is part of the key, so a rescheduled appointment alerts again
const keys = (d: Alerts) => [...d.newRequests.map((a) => ({ key: `new:${a.id}`, title: 'New booking request', a })), ...d.upcoming.map((a) => ({ key: `soon:${a.id}:${when(a)}`, title: 'Appointment coming up', a }))];

const remembered = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; } };
const remember = (k: string[]) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(k.slice(-300))); } catch { /* storage unavailable: alerts may repeat after a reload */ } };

function chime() {
  try {
    const ctx = new AudioContext(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = 880; gain.gain.setValueAtTime(0.08, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.5); osc.onended = () => ctx.close();
  } catch { /* sound is a bonus */ }
}

/** Bell in the corner of the admin: new website requests and appointments starting soon. Checks every minute. */
export function AlertCenter() {
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [data, setData] = useState<Alerts | null>(null);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const alerted = useRef(new Set(remembered()));

  const check = useCallback(() => {
    api.get<Alerts>('/admin/bookings/alerts').then((d) => {
      setData(d);
      const fresh = keys(d).filter((x) => !alerted.current.has(x.key));
      if (!fresh.length) return;
      fresh.forEach((x) => alerted.current.add(x.key));
      remember([...alerted.current]);
      const first = fresh[0];
      const text = fresh.length === 1 ? `${first.title}: ${first.a.customer_name}, ${when(first.a)}` : `${fresh.length} booking alerts. Open the bell to see them.`;
      toast(text);
      chime();
      // some mobile browsers do not allow this; the bell and message above still work there
      try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Blush & Apples', { body: text, tag: first.key }); } catch { /* unsupported */ }
    }).catch(() => { /* try again on the next check */ });
  }, [toast]);

  useEffect(() => {
    check();
    const t = setInterval(check, POLL_MS);
    return () => clearInterval(t);
  }, [check]);
  // opening a booking marks it as seen, so refresh shortly after moving around
  useEffect(() => { setOpen(false); const t = setTimeout(check, 1500); return () => clearTimeout(t); }, [pathname, search, check]);

  const count = (data?.newRequests.length || 0) + (data?.upcoming.length || 0);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = count ? `(${count}) ${base}` : base;
    return () => { document.title = base; };
  }, [count, pathname]);

  const show = (id: number) => { setOpen(false); navigate(`/admin/bookings?open=${id}`); };
  const row = (a: Alert, soon: boolean) => (
    <li key={a.id} className="flex items-start justify-between gap-2 py-2">
      <button type="button" onClick={() => show(a.id)} className="min-w-0 text-left text-sm hover:text-gold">
        <strong>{a.customer_name}</strong> · {when(a)}<span className="block truncate text-xs text-charcoal/55">{a.service_names} · {a.reference}</span>
      </button>
      {soon && a.whatsappUrl && <a className="btn btn-outline btn-sm shrink-0 !px-2" href={a.whatsappUrl} target="_blank" rel="noopener noreferrer">Remind</a>}
    </li>
  );

  return (
    <div className="fixed right-3 top-2 z-50 lg:right-6 lg:top-4">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Alerts${count ? `: ${count}` : ''}`} className="relative grid h-10 w-10 place-items-center rounded-full border border-charcoal/10 bg-paper shadow">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden><path d="M12 22a2.5 2.5 0 002.4-2h-4.8a2.5 2.5 0 002.4 2zm7-6V11a7 7 0 00-5-6.7V3.5a2 2 0 10-4 0v.8A7 7 0 005 11v5l-2 2v1h18v-1l-2-2z" /></svg>
        {count > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose px-1 text-[11px] font-semibold text-white">{count}</span>}
      </button>
      {open && (
        <div role="region" aria-label="Alerts" className="absolute right-0 mt-2 max-h-[75vh] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto border border-charcoal/10 bg-paper p-4 shadow-2xl">
          <div className="flex items-center justify-between gap-2"><h2 className="text-xl">New requests ({data?.newRequests.length || 0})</h2>
            {!!data?.newRequests.length && <button type="button" className="text-xs text-gold underline" onClick={() => api.post('/admin/bookings/alerts/seen').then(check)}>Mark all seen</button>}</div>
          {data?.newRequests.length ? <ul className="divide-y divide-charcoal/10">{data.newRequests.map((a) => row(a, false))}</ul> : <p className="py-2 text-sm text-charcoal/55">Nothing new.</p>}
          <h2 className="mt-3 border-t border-charcoal/10 pt-3 text-xl">Next {data?.hours || 24} hours ({data?.upcoming.length || 0})</h2>
          {data?.upcoming.length ? <ul className="divide-y divide-charcoal/10">{data.upcoming.map((a) => row(a, true))}</ul> : <p className="py-2 text-sm text-charcoal/55">No appointments soon.</p>}
          {permission === 'default' && <button type="button" className="btn btn-solid btn-sm mt-3 w-full" onClick={() => Notification.requestPermission().then(setPermission)}>Turn on pop-up notifications</button>}
          <p className="mt-3 text-[11px] text-charcoal/45">Checked every minute while this admin page is open.{permission === 'denied' && ' Pop-ups are blocked in your browser settings.'}</p>
        </div>
      )}
    </div>
  );
}

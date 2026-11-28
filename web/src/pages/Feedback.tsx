import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useSite } from '../lib/site';
import { Empty, ErrorNote, PageLoader, Spinner } from '../components/ui';

/** Reached only through a private link sent to a customer. Reviews wait for approval before appearing. */
export default function Feedback() {
  const { token } = useParams();
  const { site } = useSite();
  const brand = site?.settings.brand?.name || 'us';
  const [info, setInfo] = useState<{ customerName: string; service: string } | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = 'Share your feedback';
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.appendChild(robots); }
    robots.content = 'noindex,nofollow';
    api.get(`/public/feedback/${token}`).then((d: any) => { setInfo(d); setName(d.customerName || ''); }).catch((e) => setGone(errorMessage(e)));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!rating) return setErr('Please choose a star rating.');
    if (name.trim().length < 2) return setErr('Please enter your name.');
    if (review.trim().length < 5) return setErr('Please write a few words about your experience.');
    setBusy(true); setErr(null);
    try { await api.post(`/public/feedback/${token}`, { name, rating, review }); setDone(true); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  };

  return (
    <div className="pt-28 sm:pt-36"><div className="container-x max-w-xl pb-24">
      {gone ? <Empty title="Feedback link" body={gone} action={<Link to="/" className="btn btn-outline">Back home</Link>} />
        : !info ? <PageLoader />
        : done ? <div role="status" className="bg-paper p-10 text-center"><p className="font-heading text-4xl">Thank you!</p><p className="mt-3 text-charcoal/70">Your feedback means a lot to us.</p><Link to="/" className="btn btn-outline mt-6">Visit our website</Link></div>
        : (
          <form onSubmit={submit} noValidate className="space-y-5 bg-paper p-6 sm:p-10">
            <div><p className="eyebrow mb-2">Your feedback</p><h1 className="text-4xl">How was your experience with {brand}?</h1>{info.service && <p className="mt-2 text-sm text-charcoal/60">{info.service}</p>}</div>
            <fieldset><legend className="label">Your rating *</legend>
              <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="cursor-pointer">
                  <input type="radio" name="rating" className="peer sr-only" checked={rating === n} onChange={() => setRating(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} />
                  <span aria-hidden className={`block px-1 text-4xl leading-none peer-focus-visible:outline peer-focus-visible:outline-2 ${n <= rating ? 'text-gold' : 'text-charcoal/20'}`}>★</span>
                </label>))}</div></fieldset>
            <div><label className="label" htmlFor="fb-name">Your name (shown with your review) *</label><input id="fb-name" className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label className="label" htmlFor="fb-review">Your review *</label><textarea id="fb-review" rows={5} maxLength={2000} className="input" value={review} onChange={(e) => setReview(e.target.value)} /></div>
            <p className="text-xs text-charcoal/55">By sending, you agree that your name and review may be shown on this website.</p>
            <ErrorNote message={err} />
            <button className="btn btn-solid w-full" disabled={busy}>{busy ? <Spinner /> : 'Send feedback'}</button>
          </form>
        )}
    </div></div>
  );
}

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { galleryHref, matchGalleryCat, useGalleryCats } from '../lib/galleryLink';
import { track, useSite } from '../lib/site';
import { useSeo } from '../lib/seo';
import { Empty, Item, Lightbox, PageLoader, Reveal, SectionHeading, Stagger } from '../components/ui';
import { PromoCard, SectionRenderer, ServiceCard } from './sections';

export function Home() {
  useSeo('home');
  const { site } = useSite();
  // Hero sections always render first, even if one was added later and so sits lower in the admin list.
  const all = site?.sections.filter((s) => s.page === 'home') || [];
  // If several hero sections exist (e.g. one added only to hold images), merge them into ONE hero:
  // text and buttons from the first hero that has a heading, images gathered from all of them.
  const heroes = all.filter((s) => s.type === 'hero');
  let hero = heroes[0];
  if (heroes.length > 1) {
    const base = heroes.find((h) => h.content.heading) || heroes[0];
    const images = [...new Set(heroes.flatMap((h) => [...(Array.isArray(h.content.images) ? h.content.images : []), h.content.image]).filter(Boolean))] as string[];
    hero = { ...base, content: { ...base.content, ...(images.length ? { images, image: '' } : {}) } };
  }
  const secs = [...(hero ? [hero] : []), ...all.filter((s) => s.type !== 'hero')];
  if (!secs.length) return <Empty title="Welcome" body="Add sections to the home page from the admin dashboard." />;
  return <>{secs.map((s) => <SectionRenderer key={s.id} s={s} />)}</>;
}

export function About() {
  useSeo('about');
  const { site } = useSite();
  const secs = site?.sections.filter((s) => s.page === 'about') || [];
  return (
    <div className="pt-20 sm:pt-24">
      {secs.length ? secs.map((s, i) => (s.type === 'image_text' ? <SectionRenderer key={s.id} s={{ ...s, content: { ...s.content, _i: i } }} /> : <SectionRenderer key={s.id} s={s} />)) : <Empty title="About" body="Content coming soon." />}
      <div className="pb-20 text-center"><Link to="/book" className="btn btn-solid">Book an appointment</Link></div>
    </div>
  );
}

export function Services() {
  const { site } = useSite();
  const [services, setServices] = useState<any[] | null>(null);
  const [cat, setCat] = useState('all');
  useEffect(() => { api.get('/public/services').then(setServices).catch(() => setServices([])); }, []);
  const cats = useMemo(() => (site?.categories || []).filter((c) => services?.some((s) => s.category_id === c.id)), [site, services]);
  const list = (services || []).filter((s) => cat === 'all' || s.category_slug === cat);
  const galleryCat = matchGalleryCat([cats.find((c) => c.slug === cat)?.name], useGalleryCats());
  const jsonLd = services ? { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: services.slice(0, 20).map((s, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Service', name: s.name, description: s.description, offers: s.price_type !== 'custom' ? { '@type': 'Offer', price: (s.price_cents / 100).toFixed(2), priceCurrency: site?.settings.general?.currency || 'USD' } : undefined } })) } : undefined;
  useSeo('services', { jsonLd });
  return (
    <div className="pt-28 sm:pt-36"><div className="container-x pb-24">
      <SectionHeading eyebrow="Services" heading="Services & pricing" body="Choose a service to book online, or message on WhatsApp for a custom quote." />
      <div className="mb-10 flex flex-wrap justify-center gap-2" role="tablist" aria-label="Service categories">
        {[{ slug: 'all', name: 'All' }, ...cats].map((c) => (
          <button key={c.slug} role="tab" aria-selected={cat === c.slug} onClick={() => setCat(c.slug)} className={`relative px-4 py-2 text-[12px] uppercase tracking-[0.14em] ${cat === c.slug ? 'text-paper' : 'text-charcoal/70 hover:text-gold'}`}>
            {cat === c.slug && <motion.span layoutId="svc-pill" className="absolute inset-0 -z-0 bg-charcoal" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
            <span className="relative">{c.name}</span>
          </button>))}
      </div>
      {!services ? <PageLoader /> : !list.length ? <Empty title="No services here yet" body="Try another category." /> : (
        <motion.div layout className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">{list.map((s) => <motion.div layout key={s.id} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}><Stagger><ServiceCard s={s} /></Stagger></motion.div>)}</AnimatePresence>
        </motion.div>)}
      <div className="mt-12 text-center"><Link to={galleryHref(galleryCat)} className="btn btn-outline">{galleryCat ? `Explore ${galleryCat.name} gallery` : 'Explore gallery'}</Link></div>
    </div></div>
  );
}

export function Portfolio() {
  useSeo('portfolio');
  const [data, setData] = useState<any | null>(null);
  // The category lives in the URL, so "Explore gallery" buttons can link straight to it.
  const [params, setParams] = useSearchParams();
  const cat = params.get('category') || '';
  const setCat = (slug: string) => setParams(slug ? { category: slug } : {}, { replace: true });
  const [album, setAlbum] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('custom');
  const [idx, setIdx] = useState<number | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams();
    if (cat) p.set('category', cat); if (album) p.set('album', album); if (q) p.set('q', q); if (sort !== 'custom') p.set('sort', sort);
    const t = setTimeout(() => api.get(`/public/gallery?${p}`).then((d) => { setData(d); setErr(false); }).catch(() => setErr(true)), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [cat, album, q, sort]);
  const items = data?.items || [];
  return (
    <div className="pt-28 sm:pt-36"><div className="container-x pb-24">
      <SectionHeading eyebrow="Portfolio" heading="Selected work" body="Bridal, editorial and everything in between." />
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {[{ slug: '', name: 'All' }, ...(data?.categories || [])].map((c: any) => (
            <button key={c.slug} onClick={() => setCat(c.slug)} aria-pressed={cat === c.slug} className={`border px-3.5 py-1.5 text-[11px] uppercase tracking-[0.14em] transition-colors ${cat === c.slug ? 'border-charcoal bg-charcoal text-paper' : 'border-charcoal/20 hover:border-gold hover:text-gold'}`}>{c.name}</button>))}
        </div>
        <div className="flex gap-2">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search looks" aria-label="Search gallery" className="input !py-2 sm:w-44" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" className="input !w-auto !py-2"><option value="custom">Curated</option><option value="newest">Newest</option><option value="featured">Featured</option></select>
          {data?.albums?.length > 0 && <select value={album} onChange={(e) => setAlbum(e.target.value)} aria-label="Album" className="input !w-auto !py-2"><option value="">All albums</option>{data.albums.map((a: any) => <option key={a.id} value={a.slug}>{a.title}</option>)}</select>}
        </div>
      </div>
      {err ? <Empty title="Could not load the gallery" body="Please try again shortly." /> : !data ? <PageLoader /> : !items.length ? <Empty title="Nothing matches" body="Try a different category or search." /> : (
        <motion.div layout className="columns-2 gap-3 md:columns-3 lg:columns-4 lg:gap-4">
          <AnimatePresence>{items.map((g: any, i: number) => (
            <motion.button layout key={g.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, delay: Math.min(i, 8) * 0.03 }}
              onClick={() => setIdx(i)} aria-label={`View ${g.title}`} className="group relative mb-3 block w-full break-inside-avoid overflow-hidden lg:mb-4">
              <img src={g.thumb_url} alt={g.alt_text || g.title} loading="lazy" decoding="async" width={g.width} height={g.height} className="w-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-charcoal/70 to-transparent p-3 text-left text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">{g.title}{g.before_url && ' · Before/After'}</span>
            </motion.button>))}</AnimatePresence>
        </motion.div>)}
      <Lightbox items={items} index={idx} onClose={() => setIdx(null)} onIndex={setIdx} onView={(id) => track('gallery_view', String(id))} />
    </div></div>
  );
}

export function Promotions() {
  useSeo('promotions');
  const { site } = useSite();
  return (
    <div className="pt-28 sm:pt-36"><div className="container-x pb-24">
      <SectionHeading eyebrow="Offers" heading="Current offers" body="Use the promo code when you book online." />
      {site?.promotions.length ? <Stagger className="grid gap-6 lg:grid-cols-2">{site.promotions.map((p) => <PromoCard key={p.id} p={p} />)}</Stagger> : <Empty title="No offers right now" body="Check back soon." action={<Link className="btn btn-outline" to="/services">Browse services</Link>} />}
    </div></div>
  );
}

export function Policy() {
  const { key } = useParams();
  const { site } = useSite();
  const titles: Record<string, string> = { privacy: 'Privacy policy', terms: 'Terms & conditions', cancellation: 'Cancellation policy' };
  useSeo('home', { title: titles[key || ''] || 'Policy' });
  const body = site?.settings.policies?.[key || ''];
  return (
    <div className="pt-28 sm:pt-36"><div className="container-x max-w-3xl pb-24"><Reveal><h1 className="text-5xl">{titles[key || ''] || 'Policy'}</h1></Reveal>
      <div className="mt-8 whitespace-pre-line leading-relaxed text-charcoal/75">{body || 'Not published yet.'}</div></div></div>
  );
}

export const NotFound = () => <div className="pt-40"><Empty title="Page not found" action={<Link to="/" className="btn btn-outline">Back home</Link>} /></div>;
export { Item };

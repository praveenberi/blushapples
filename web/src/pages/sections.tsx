import { AnimatePresence, motion, useScroll, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDuration, priceLabel, track, useSite, whatsappServiceUrl, whatsappUrl } from '../lib/site';
import { BeforeAfter, Icon, Img, Item, Lightbox, Reveal, SectionHeading, Stagger, type LightboxItem } from '../components/ui';
import { ContactForm } from './Contact';

type Sec = { id: number; type: string; content: Record<string, any> };

export function ServiceCard({ s }: { s: any }) {
  const { site, money } = useSite();
  return (
    <Item className="group flex flex-col bg-paper">
      <Img src={s.image_url} alt={s.name} ratio="4/3" className="transition-transform duration-700 group-hover:scale-[1.02]" />
      <div className="flex flex-1 flex-col p-6">
        {s.category_name && <p className="eyebrow mb-2">{s.category_name}</p>}
        <h3 className="text-2xl">{s.name}</h3>
        <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-charcoal/65">{s.description}</p>
        <div className="mt-5 flex items-baseline justify-between border-t border-charcoal/10 pt-4">
          <span className="font-heading text-xl">{priceLabel(s, money)}</span><span className="text-xs text-charcoal/55">{fmtDuration(s.duration_min)}</span>
        </div>
        <div className="mt-4 flex gap-2">
          {s.bookable && <Link to={`/book?service=${s.id}`} onClick={() => track('booking_click', String(s.id))} className="btn btn-solid btn-sm flex-1">Book</Link>}
          <a href={whatsappServiceUrl(site, s, money)} target="_blank" rel="noopener noreferrer" onClick={() => track('whatsapp_click', String(s.id))} className="btn btn-outline btn-sm" aria-label={`Enquire about ${s.name} on WhatsApp`}><Icon name="whatsapp" className="h-4 w-4" />WhatsApp</a>
        </div>
      </div>
    </Item>
  );
}

function Hero({ c }: { c: Record<string, any> }) {
  const { site } = useSite();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], ['0%', '14%']);
  const slides: string[] = (Array.isArray(c.images) ? c.images.filter(Boolean) : []).length ? c.images.filter(Boolean) : [c.image || site?.featuredGallery[0]?.display_url].filter(Boolean);
  const img = slides[0];
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const seconds = Math.min(15, Math.max(3, Number(c.slideSeconds) || 6));
  useEffect(() => {
    if (c.video || slides.length < 2 || paused) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % slides.length), seconds * 1000);
    return () => clearInterval(t);
  }, [slides.length, paused, seconds, c.video]);
  const cur = slides[slide % Math.max(1, slides.length)];
  return (
    <section ref={ref} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} className="relative isolate flex min-h-[92vh] items-end overflow-hidden bg-blush pb-16 pt-32 sm:items-center sm:pb-0">
      <motion.div style={{ y }} className="absolute inset-0 -z-10 scale-110">
        {c.video ? <video className="h-full w-full object-cover" src={c.video} autoPlay muted loop playsInline poster={img} />
          : cur ? (
            <AnimatePresence initial={false}>
              <motion.img key={cur} src={cur} alt="" className="absolute inset-0 h-full w-full object-cover" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.4, ease: 'easeInOut' }} />
            </AnimatePresence>
          ) : <div className="h-full w-full bg-gradient-to-br from-blush via-nude to-ivory" />}
        <div className="absolute inset-0 bg-gradient-to-t from-charcoal/55 via-charcoal/15 to-transparent sm:bg-gradient-to-r sm:from-charcoal/50 sm:via-charcoal/10 sm:to-transparent" />
      </motion.div>
      {!c.video && slides.length > 1 && (
        <div className="absolute bottom-24 right-5 z-10 flex gap-2 sm:bottom-8 sm:right-8" role="tablist" aria-label="Hero images">
          {slides.map((_, n) => <button key={n} role="tab" aria-selected={n === slide % slides.length} aria-label={`Show image ${n + 1}`} onClick={() => setSlide(n)} className={`h-1.5 rounded-full transition-all duration-500 ${n === slide % slides.length ? 'w-8 bg-white' : 'w-3 bg-white/45 hover:bg-white/70'}`} />)}
        </div>
      )}
      <div className="container-x">
        <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.14, delayChildren: 0.2 } } }} className="max-w-2xl text-white">
          {c.eyebrow && <motion.p variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }} className="eyebrow !text-white/85">{c.eyebrow}</motion.p>}
          <motion.h1 variants={{ hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0, transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] } } }} className="mt-4 text-[44px] leading-[1.02] sm:text-7xl">{c.heading}</motion.h1>
          {c.body && <motion.p variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }} className="mt-5 max-w-lg text-lg leading-relaxed text-white/85">{c.body}</motion.p>}
          <motion.div variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }} className="mt-8 flex flex-wrap gap-3">
            {c.ctaLabel && <Link to={c.ctaHref || '/book'} onClick={() => track('booking_click')} className="btn btn-gold">{c.ctaLabel}</Link>}
            {c.showWhatsapp && site?.settings.contact?.whatsapp && <a href={whatsappUrl(site)} target="_blank" rel="noopener noreferrer" onClick={() => track('whatsapp_click')} className="btn border border-white/70 text-white hover:bg-white hover:text-charcoal"><Icon name="whatsapp" className="h-4 w-4" />WhatsApp</a>}
            {c.secondaryLabel && <Link to={c.secondaryHref || '/portfolio'} className="btn btn-ghost !text-white hover:!text-gold">{c.secondaryLabel} →</Link>}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function FeaturedGallery({ c }: { c: Record<string, any> }) {
  const { site } = useSite();
  const [idx, setIdx] = useState<number | null>(null);
  const items: LightboxItem[] = (site?.featuredGallery || []).map((g) => ({ ...g, description: '', alt_text: g.alt_text }));
  if (!items.length) return null;
  return (
    <section className="section-y"><div className="container-x">
      <SectionHeading {...c as any} />
      <Stagger className="columns-2 gap-3 md:columns-3 lg:gap-5">
        {items.map((g, i) => (
          <Item key={g.id} className="mb-3 break-inside-avoid lg:mb-5">
            <button className="group block w-full overflow-hidden" onClick={() => setIdx(i)} aria-label={`View ${g.title}`}>
              <img src={(g as any).thumb_url} alt={g.alt_text || g.title} loading="lazy" decoding="async" width={(g as any).width} height={(g as any).height} className="w-full object-cover transition-transform duration-700 group-hover:scale-105" />
            </button>
          </Item>
        ))}
      </Stagger>
      <div className="mt-10 text-center"><Link to="/portfolio" className="btn btn-outline">View full portfolio</Link></div>
      <Lightbox items={items} index={idx} onClose={() => setIdx(null)} onIndex={setIdx} onView={(id) => track('gallery_view', String(id))} />
    </div></section>
  );
}

function ServicesSection({ c }: { c: Record<string, any> }) {
  const { site } = useSite();
  const list = site?.featuredServices || [];
  if (!list.length) return null;
  return (
    <section className="section-y bg-nude/40"><div className="container-x">
      <SectionHeading {...c as any} />
      <Stagger className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{list.slice(0, 6).map((s) => <ServiceCard key={s.id} s={s} />)}</Stagger>
      <div className="mt-10 text-center"><Link to="/services" className="btn btn-outline">All services & pricing</Link></div>
    </div></section>
  );
}

function BeforeAfterSection({ c }: { c: Record<string, any> }) {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => { api.get('/public/gallery').then((r) => setItems(r.items.filter((i: any) => i.before_url).slice(0, 3))).catch(() => {}); }, []);
  if (!items.length) return null;
  return (
    <section className="section-y"><div className="container-x">
      <SectionHeading {...c as any} />
      <Stagger className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">{items.map((i) => <Item key={i.id}><BeforeAfter before={i.before_url} after={i.display_url} alt={i.alt_text || i.title} /></Item>)}</Stagger>
    </div></section>
  );
}

function Story({ c }: { c: Record<string, any> }) {
  const { site } = useSite();
  const img = c.image || site?.featuredGallery[1]?.display_url;
  return (
    <section className="section-y"><div className="container-x grid items-center gap-12 md:grid-cols-2">
      <Reveal><Img src={img} alt={c.heading || 'The artist'} ratio="4/5" /></Reveal>
      <Reveal delay={0.1}>
        {c.eyebrow && <p className="eyebrow mb-3">{c.eyebrow}</p>}
        <h2 className="text-4xl leading-[1.1] sm:text-5xl">{c.heading}</h2>
        <p className="mt-5 whitespace-pre-line leading-relaxed text-charcoal/70">{c.body}</p>
        {c.ctaLabel && <Link to={c.ctaHref || '/about'} className="btn btn-outline mt-8">{c.ctaLabel}</Link>}
      </Reveal>
    </div></section>
  );
}

function Testimonials({ c }: { c: Record<string, any> }) {
  const { site } = useSite();
  const list = site?.testimonials || [];
  const [i, setI] = useState(0);
  useEffect(() => {
    if (list.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % list.length), 7000);
    return () => clearInterval(t);
  }, [list.length]);
  if (!list.length) return null;
  const t = list[i % list.length];
  return (
    <section className="section-y bg-blush/40"><div className="container-x">
      <SectionHeading {...c as any} />
      <div className="mx-auto max-w-3xl text-center">
        <motion.figure key={t.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="min-h-[220px]">
          <div className="text-gold" aria-label={`${t.rating} out of 5 stars`}>{'★'.repeat(t.rating)}{'☆'.repeat(5 - t.rating)}</div>
          <blockquote className="mt-5 font-heading text-2xl leading-snug sm:text-3xl">“{t.review}”</blockquote>
          <figcaption className="mt-6 flex items-center justify-center gap-3 text-sm">
            {t.image_url && <img src={t.image_url} alt="" className="h-10 w-10 rounded-full object-cover" />}
            <span><strong className="font-medium">{t.customer_name}</strong>{t.service_category && <span className="text-charcoal/55"> · {t.service_category}</span>}{t.is_demo && <span className="ml-2 rounded bg-charcoal/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">Demo</span>}</span>
          </figcaption>
        </motion.figure>
        {list.length > 1 && <div className="mt-6 flex justify-center gap-2" role="tablist">{list.map((x, n) => <button key={x.id} role="tab" aria-selected={n === i} aria-label={`Review ${n + 1}`} onClick={() => setI(n)} className={`h-2 rounded-full transition-all ${n === i ? 'w-6 bg-gold' : 'w-2 bg-charcoal/25'}`} />)}</div>}
      </div>
    </div></section>
  );
}

export function PromoCard({ p }: { p: any }) {
  return (
    <Item className="flex flex-col overflow-hidden bg-paper sm:flex-row">
      {p.banner_url && <Img src={p.banner_url} alt={p.title} className="sm:w-2/5" ratio="4/3" />}
      <div className="flex flex-1 flex-col justify-center p-6">
        {p.discount_type === 'percent' && <span className="eyebrow mb-2">{p.discount_value}% off</span>}
        <h3 className="text-2xl">{p.title}</h3>
        <p className="mt-2 text-sm text-charcoal/65">{p.description}</p>
        {p.promo_code && <p className="mt-3 text-sm">Code <code className="rounded bg-nude px-2 py-0.5 tracking-widest">{p.promo_code}</code></p>}
        {p.end_date && <p className="mt-1 text-xs text-charcoal/50">Ends {p.end_date}</p>}
        <Link to={p.cta_href || '/book'} className="btn btn-solid btn-sm mt-5 self-start">{p.cta_label || 'Book now'}</Link>
        {p.terms && <p className="mt-3 text-[11px] text-charcoal/45">{p.terms}</p>}
      </div>
    </Item>
  );
}

function Promotions({ c }: { c: Record<string, any> }) {
  const { site } = useSite();
  if (!site?.promotions.length) return null;
  return (
    <section className="section-y"><div className="container-x"><SectionHeading {...c as any} />
      <Stagger className="grid gap-6 lg:grid-cols-2">{site.promotions.slice(0, 2).map((p) => <PromoCard key={p.id} p={p} />)}</Stagger></div></section>
  );
}

function Instagram({ c }: { c: Record<string, any> }) {
  const { site } = useSite();
  const ig = site?.settings.instagram || {};
  const link = site?.social.find((s) => /instagram/i.test(s.platform));
  const items = site?.featuredGallery.slice(0, 6) || [];
  return (
    <section className="section-y bg-nude/40"><div className="container-x">
      <SectionHeading {...c as any} body={link ? `Follow ${link.username || ig.handle} for daily inspiration.` : c.body} />
      {items.length > 0 && <Stagger className="grid grid-cols-3 gap-1.5 sm:gap-3 lg:grid-cols-6">{items.map((g) => <Item key={g.id}><a href={link?.url || '/portfolio'} target={link ? '_blank' : undefined} rel="noopener noreferrer" aria-label="Open Instagram"><Img src={g.thumb_url} alt={g.alt_text || g.title} ratio="1/1" className="transition-opacity hover:opacity-80" /></a></Item>)}</Stagger>}
      {(ig.youtubeUrls?.length > 0) && <div className="mt-10 grid gap-4 md:grid-cols-2">{ig.youtubeUrls.slice(0, 2).map((u: string) => { const id = u.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/)?.[1]; return id ? <iframe key={u} className="aspect-video w-full" src={`https://www.youtube.com/embed/${id}`} title="YouTube video" loading="lazy" allowFullScreen /> : null; })}</div>}
      {link && <div className="mt-8 text-center"><a href={link.url} target="_blank" rel="noopener noreferrer" className="btn btn-outline"><Icon name="instagram" className="h-4 w-4" />Follow on Instagram</a></div>}
    </div></section>
  );
}

function ContactSection({ c }: { c: Record<string, any> }) {
  const { site } = useSite();
  const contact = site?.settings.contact || {};
  return (
    <section className="section-y"><div className="container-x grid gap-12 md:grid-cols-2">
      <Reveal>
        {c.eyebrow && <p className="eyebrow mb-3">{c.eyebrow}</p>}
        <h2 className="text-4xl sm:text-5xl">{c.heading}</h2>
        <p className="mt-4 text-charcoal/70">{c.body}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          {contact.whatsapp && <a href={whatsappUrl(site)} target="_blank" rel="noopener noreferrer" onClick={() => track('whatsapp_click')} className="btn btn-gold"><Icon name="whatsapp" className="h-4 w-4" />WhatsApp</a>}
          {contact.phone && <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} onClick={() => track('call_click')} className="btn btn-outline"><Icon name="phone" className="h-4 w-4" />Call</a>}
        </div>
      </Reveal>
      <Reveal delay={0.1}><div className="bg-paper p-6 sm:p-8"><ContactForm compact /></div></Reveal>
    </div></section>
  );
}

export function TextSection({ c }: { c: Record<string, any> }) {
  return <section className="section-y"><div className="container-x max-w-3xl"><SectionHeading eyebrow={c.eyebrow} heading={c.heading} body={c.body} align="left" /></div></section>;
}
export function ImageText({ c, flip }: { c: Record<string, any>; flip?: boolean }) {
  return (
    <section className="section-y"><div className="container-x grid items-center gap-12 md:grid-cols-2">
      <Reveal className={flip ? 'md:order-2' : ''}><Img src={c.image} alt={c.heading || ''} ratio="4/5" /></Reveal>
      <Reveal delay={0.1}>{c.eyebrow && <p className="eyebrow mb-3">{c.eyebrow}</p>}<h2 className="text-4xl sm:text-5xl">{c.heading}</h2><p className="mt-5 whitespace-pre-line leading-relaxed text-charcoal/70">{c.body}</p></Reveal>
    </div></section>
  );
}
export function ListSection({ c }: { c: Record<string, any> }) {
  return (
    <section className="py-12 sm:py-16"><div className="container-x max-w-3xl">
      <Reveal><h3 className="text-3xl">{c.heading}</h3></Reveal>
      <Stagger className="mt-6 divide-y divide-charcoal/10 border-y border-charcoal/10">{(c.items || []).map((it: string, i: number) => <Item key={i} className="py-3.5 text-charcoal/75">{it}</Item>)}</Stagger>
    </div></section>
  );
}

/** Maps admin-defined section types to components. Order and visibility come from the database. */
export function SectionRenderer({ s }: { s: Sec }) {
  const c = s.content;
  switch (s.type) {
    case 'hero': return <Hero c={c} />;
    case 'featured_gallery': return <FeaturedGallery c={c} />;
    case 'services': return <ServicesSection c={c} />;
    case 'before_after': return <BeforeAfterSection c={c} />;
    case 'story': return <Story c={c} />;
    case 'testimonials': return <Testimonials c={c} />;
    case 'promotions': return <Promotions c={c} />;
    case 'instagram': return <Instagram c={c} />;
    case 'contact': return <ContactSection c={c} />;
    case 'text': return <TextSection c={c} />;
    case 'image_text': return <ImageText c={c} />;
    case 'list': return <ListSection c={c} />;
    default: return null;
  }
}

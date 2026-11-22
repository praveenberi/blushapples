import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/* ---------- motion primitives (variants + stagger; reduced motion handled by <MotionConfig reducedMotion="user">) ---------- */
export const fadeUp: Variants = { hidden: { opacity: 0, y: 22 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } } };
export const stagger = (gap = 0.09): Variants => ({ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: 0.05 } } });

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }} transition={{ delay }}>
      {children}
    </motion.div>
  );
}

export function Stagger({ children, className, gap }: { children: ReactNode; className?: string; gap?: number }) {
  return <motion.div className={className} variants={stagger(gap)} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-60px' }}>{children}</motion.div>;
}
export const Item = ({ children, className }: { children: ReactNode; className?: string }) => <motion.div className={className} variants={fadeUp}>{children}</motion.div>;

export function SectionHeading({ eyebrow, heading, body, align = 'center' }: { eyebrow?: string; heading?: string; body?: string; align?: 'center' | 'left' }) {
  if (!eyebrow && !heading && !body) return null;
  return (
    <Reveal className={`mb-12 max-w-2xl ${align === 'center' ? 'mx-auto text-center' : ''}`}>
      {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
      {heading && <h2 className="text-4xl sm:text-5xl leading-[1.08]">{heading}</h2>}
      {body && <p className="mt-4 text-charcoal/70 leading-relaxed whitespace-pre-line">{body}</p>}
    </Reveal>
  );
}

/** Lazy, async-decoded image with a soft placeholder to avoid layout shift. */
export function Img({ src, alt, className = '', ratio, eager }: { src?: string | null; alt: string; className?: string; ratio?: string; eager?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <div className={`relative overflow-hidden bg-nude ${className}`} style={ratio ? { aspectRatio: ratio } : undefined}>
      {src ? (
        <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" onLoad={() => setOk(true)}
          className={`h-full w-full object-cover transition-opacity duration-700 ${ok ? 'opacity-100' : 'opacity-0'}`} />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-blush to-nude" aria-hidden />
      )}
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-gold/30 border-t-gold ${className}`} />;
}
export const PageLoader = () => <div className="grid min-h-[50vh] place-items-center"><Spinner className="h-8 w-8" /></div>;

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="font-heading text-2xl">{title}</p>
      {body && <p className="mt-2 text-sm text-charcoal/60">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message?: string | null }) {
  return message ? <p role="alert" className="rounded-theme border border-rose/40 bg-rose/10 px-4 py-3 text-sm text-rose">{message}</p> : null;
}

/* ---------- modal ---------- */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-charcoal/50 backdrop-blur-[2px]" onClick={onClose} />
          <motion.div role="dialog" aria-modal="true" aria-label={title}
            initial={{ y: 40, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className={`relative max-h-[92vh] w-full overflow-y-auto bg-ivory shadow-2xl sm:rounded-theme ${wide ? 'sm:max-w-4xl' : 'sm:max-w-xl'}`}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-charcoal/10 bg-ivory px-5 py-4">
              <h3 className="font-heading text-2xl">{title}</h3>
              <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-nude">✕</button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- before/after slider ---------- */
export function BeforeAfter({ before, after, alt, ratio = '4/5', fit = 'cover' }: { before: string; after: string; alt: string; ratio?: string; fit?: 'cover' | 'contain' }) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const move = useCallback((x: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos(Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100)));
  }, []);
  return (
    <div ref={ref} className="relative select-none overflow-hidden touch-pan-y" style={{ aspectRatio: ratio }}
      onPointerDown={(e) => { drag.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); move(e.clientX); }}
      onPointerMove={(e) => drag.current && move(e.clientX)} onPointerUp={() => (drag.current = false)}>
      <img src={after} alt={`${alt} after`} className={`absolute inset-0 h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`} draggable={false} loading="lazy" />
      <img src={before} alt={`${alt} before`} className="absolute inset-0 h-full w-full object-cover" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} draggable={false} loading="lazy" />
      <span className="absolute left-3 top-3 bg-charcoal/70 px-2 py-1 text-[10px] uppercase tracking-widest text-white">Before</span>
      <span className="absolute right-3 top-3 bg-charcoal/70 px-2 py-1 text-[10px] uppercase tracking-widest text-white">After</span>
      <div className="pointer-events-none absolute inset-y-0 w-px bg-white shadow" style={{ left: `${pos}%` }}>
        <div className="absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-xs text-charcoal shadow-lg">⇄</div>
      </div>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Before and after comparison"
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0" />
    </div>
  );
}

/* ---------- lightbox with swipe ---------- */
export interface LightboxItem { id: number; display_url: string; original_url?: string; title: string; description?: string; alt_text?: string; allow_download?: boolean; before_url?: string | null }

export function Lightbox({ items, index, onClose, onIndex, onView }: { items: LightboxItem[]; index: number | null; onClose: () => void; onIndex: (i: number) => void; onView?: (id: number) => void }) {
  const open = index !== null;
  const item = open ? items[index!] : null;
  const dir = useRef(1);
  const go = useCallback((d: number) => { dir.current = d; onIndex((index! + d + items.length) % items.length); }, [index, items.length, onIndex]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
    document.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [open, go, onClose]);
  useEffect(() => { if (item) onView?.(item.id); }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    if (!item) return;
    const url = location.origin + item.display_url;
    try {
      if (navigator.share) await navigator.share({ title: item.title, url });
      else { await navigator.clipboard.writeText(url); alert('Image link copied'); }
    } catch { /* user cancelled */ }
  };

  return (
    <AnimatePresence>
      {open && item && (
        <motion.div className="fixed inset-0 z-[90] flex flex-col bg-charcoal/95" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label={item.title}>
          <div className="flex items-center justify-between px-4 py-3 text-white/90">
            <span className="text-xs tracking-widest">{index! + 1} / {items.length}</span>
            <div className="flex items-center gap-1">
              <button className="px-3 py-2 text-xs uppercase tracking-widest hover:text-gold" onClick={share}>Share</button>
              {item.allow_download && <a className="px-3 py-2 text-xs uppercase tracking-widest hover:text-gold" href={item.original_url || item.display_url} download>Download</a>}
              <button className="grid h-10 w-10 place-items-center text-xl hover:text-gold" onClick={onClose} aria-label="Close">✕</button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
            <button onClick={() => go(-1)} aria-label="Previous" className="absolute left-2 z-10 hidden h-12 w-12 place-items-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20 sm:grid">‹</button>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={item.id} className="flex max-h-full w-full max-w-4xl flex-col items-center"
                initial={{ opacity: 0, x: 40 * dir.current }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 * dir.current }} transition={{ duration: 0.25 }}
                drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.25}
                onDragEnd={(_, i) => { if (i.offset.x < -70) go(1); else if (i.offset.x > 70) go(-1); }}>
                {item.before_url
                  ? <div className="w-full max-w-md"><BeforeAfter before={item.before_url} after={item.display_url} alt={item.alt_text || item.title} /></div>
                  : <img src={item.display_url} alt={item.alt_text || item.title} className="max-h-[72vh] max-w-full object-contain" draggable={false} />}
              </motion.div>
            </AnimatePresence>
            <button onClick={() => go(1)} aria-label="Next" className="absolute right-2 z-10 hidden h-12 w-12 place-items-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20 sm:grid">›</button>
          </div>
          <div className="px-6 pb-6 pt-3 text-center text-white">
            <p className="font-heading text-xl">{item.title}</p>
            {item.description && <p className="mx-auto mt-1 max-w-xl text-sm text-white/70">{item.description}</p>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- icons ---------- */
const P: Record<string, string> = {
  instagram: 'M7 2h10a5 5 0 015 5v10a5 5 0 01-5 5H7a5 5 0 01-5-5V7a5 5 0 015-5zm0 2a3 3 0 00-3 3v10a3 3 0 003 3h10a3 3 0 003-3V7a3 3 0 00-3-3H7zm5 3.5a4.5 4.5 0 110 9 4.5 4.5 0 010-9zm0 2a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM17.5 6a1 1 0 110 2 1 1 0 010-2z',
  facebook: 'M13.5 22v-8h2.7l.5-3.2h-3.2V8.7c0-.9.4-1.7 1.8-1.7h1.5V4.2S15.1 4 13.9 4c-2.5 0-4.1 1.5-4.1 4.2v2.6H7V14h2.8v8h3.7z',
  youtube: 'M21.6 7.2a2.5 2.5 0 00-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 002.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 001.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 001.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3-5.2 3z',
  tiktok: 'M16.5 3c.3 2.3 1.7 3.8 4 4v3a7 7 0 01-4-1.3v6.1a5.8 5.8 0 11-5.8-5.8c.3 0 .6 0 .9.1v3.1a2.8 2.8 0 102 2.6V3h2.9z',
  pinterest: 'M12 2a10 10 0 00-3.6 19.3c-.1-.8-.2-2 0-2.9l1.2-5s-.3-.6-.3-1.5c0-1.4.8-2.4 1.8-2.4.9 0 1.3.6 1.3 1.4 0 .9-.5 2.1-.8 3.3-.2 1 .5 1.8 1.5 1.8 1.8 0 3.2-1.9 3.2-4.7 0-2.4-1.8-4.1-4.3-4.1-2.9 0-4.6 2.200-4.6 4.400 0 .9.3 1.800.8 2.300l-.3 1.200c0 .2-.2.3-.4.2-1.300-.6-2.100-2.500-2.100-4 0-3.300 2.400-6.300 6.900-6.300 3.600 0 6.400 2.600 6.400 6 0 3.600-2.300 6.500-5.400 6.500-1.100 0-2.100-.6-2.400-1.200l-.7 2.500c-.2.900-.9 2-1.300 2.700A10 10 0 1012 2z',
  whatsapp: 'M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm5.2 14.2c-.2.6-1.300 1.200-1.800 1.200-.5.1-1 .2-3.300-.7-2.800-1.200-4.600-4-4.700-4.200-.1-.2-1.100-1.500-1.100-2.800s.7-2 1-2.300c.2-.3.500-.3.700-.3h.5c.2 0 .4 0 .6.500l.8 1.900c.1.200.1.400 0 .5l-.4.600-.4.400c-.1.200-.3.300-.1.600.2.300.8 1.300 1.700 2.100 1.200 1 2.100 1.300 2.400 1.500.3.100.5.100.6-.1l.9-1.100c.2-.3.400-.2.600-.1l1.800.9c.3.100.5.200.5.300.1.100.1.700-.1 1.300z',
  phone: 'M6.6 10.800c1.400 2.800 3.800 5.100 6.600 6.600l2.200-2.200c.3-.3.700-.4 1-.2 1.100.4 2.300.6 3.600.6.600 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.600 21 3 13.400 3 4c0-.6.400-1 1-1h3.500c.6 0 1 .4 1 1 0 1.300.2 2.500.6 3.600.1.300 0 .7-.2 1l-2.300 2.200z',
  mail: 'M3 5h18a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1zm9 7.500L4 7v10h16V7l-8 5.500z',
};
export function Icon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const d = P[name.toLowerCase()];
  if (!d) return <span className={`grid place-items-center rounded-full border border-current text-[10px] font-semibold uppercase ${className}`}>{name.slice(0, 2)}</span>;
  return <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden><path d={d} /></svg>;
}

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon } from './ui';
import { track, useSite, whatsappUrl } from '../lib/site';

function isOpenNow(hours: any[] | undefined, tz: string) {
  if (!hours) return true;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const m = Number(parts.hour) * 60 + Number(parts.minute);
  const h = hours.find((x) => x.weekday === wd);
  return !!h && !h.closed && m >= h.open_min && m < h.close_min;
}

function Header() {
  const { site } = useSite();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 24);
    f(); window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  const brand = site?.settings.brand || {};
  const nav = site?.nav.filter((n) => n.area === 'header') || [];
  const home = loc.pathname === '/';
  void scrolled; void open; void home;
  const solid = true; // always a solid ivory bar so the full-colour logo blends in on every page, including over the hero
  const light = !solid; // transparent header sits on the hero image: use light text

  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-colors duration-500 ${solid ? 'bg-ivory/95 shadow-[0_1px_0_rgb(var(--c-charcoal)/0.08)] backdrop-blur' : 'bg-transparent'}`}>
      <div className="container-x flex h-16 items-center justify-between sm:h-20">
        <Link to="/" className="flex items-center gap-3" aria-label={`${brand.name || 'Home'}`}>
          {(brand.logo || '/logo.png') ? <img src={brand.logo || '/logo.png'} alt={brand.name} className={`h-12 w-auto rounded-theme transition-colors sm:h-16 ${light ? 'brightness-0 invert drop-shadow-[0_1px_6px_rgba(0,0,0,0.25)]' : ''}`} /> : <span className={`font-heading text-2xl tracking-wide transition-colors sm:text-[28px] ${light ? 'text-white' : ''}`}>{brand.name || 'Blush & Apples'}</span>}
        </Link>
        <nav className="hidden items-center gap-8 lg:flex" aria-label="Main">
          {nav.map((n) => (
            <NavLink key={n.id} to={n.href} end={n.href === '/'} className={({ isActive }) => `group relative py-2 text-[12px] uppercase tracking-[0.18em] ${isActive ? 'text-gold' : light ? 'text-white/90 hover:text-gold' : 'text-charcoal/80 hover:text-gold'}`}>
              {({ isActive }) => (<>{n.label}{isActive && <motion.span layoutId="nav-underline" className="absolute inset-x-0 -bottom-0.5 h-px bg-gold" />}</>)}
            </NavLink>
          ))}
        </nav>
        <div className="hidden items-center gap-4 lg:flex">
          {site?.social.slice(0, 4).map((s) => <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={s.platform} className={`${light ? 'text-white/80' : 'text-charcoal/60'} hover:text-gold`}><Icon name={s.icon || s.platform} className="h-[18px] w-[18px]" /></a>)}
          <Link to="/book" onClick={() => track('booking_click')} className="btn btn-solid btn-sm">Book now</Link>
        </div>
        <button className="grid h-11 w-11 place-items-center lg:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="relative block h-3 w-6"><span className={`absolute left-0 h-px w-6 ${light ? 'bg-white' : 'bg-charcoal'} transition-all ${open ? 'top-1.5 rotate-45' : 'top-0'}`} /><span className={`absolute left-0 top-3 h-px w-6 ${light ? 'bg-white' : 'bg-charcoal'} transition-all ${open ? 'top-1.5 -rotate-45' : ''}`} /></span>
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden border-t border-charcoal/10 bg-ivory lg:hidden" aria-label="Mobile">
            <ul className="container-x py-4">
              {nav.map((n, i) => (
                <motion.li key={n.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>
                  <NavLink to={n.href} end={n.href === '/'} className={({ isActive }) => `block border-b border-charcoal/10 py-4 font-heading text-2xl ${isActive ? 'text-gold' : ''}`}>{n.label}</NavLink>
                </motion.li>
              ))}
              <li className="flex gap-4 pt-5">{site?.social.map((s) => <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={s.platform}><Icon name={s.icon || s.platform} className="h-6 w-6" /></a>)}</li>
            </ul>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

function Footer() {
  const { site } = useSite();
  if (!site) return null;
  const { brand = {}, contact = {}, footer = {} } = site.settings;
  const links = site.nav.filter((n) => n.area === 'footer');
  return (
    <footer className="bg-charcoal pb-28 pt-16 text-ivory/80 lg:pb-12">
      <div className="container-x grid gap-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="font-heading text-3xl text-ivory">{brand.name}</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ivory/60">{footer.blurb}</p>
          <div className="mt-5 flex gap-4">{site.social.map((s) => <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={s.platform} className="hover:text-gold"><Icon name={s.icon || s.platform} className="h-5 w-5" /></a>)}</div>
        </div>
        <div>
          <p className="eyebrow mb-4">Explore</p>
          <ul className="space-y-2.5 text-sm">{links.map((l) => <li key={l.id}><Link className="hover:text-gold" to={l.href}>{l.label}</Link></li>)}
            <li><Link className="hover:text-gold" to="/policy/privacy">Privacy policy</Link></li><li><Link className="hover:text-gold" to="/policy/terms">Terms</Link></li><li><Link className="hover:text-gold" to="/policy/cancellation">Cancellation policy</Link></li></ul>
        </div>
        <div>
          <p className="eyebrow mb-4">Contact</p>
          <ul className="space-y-2.5 text-sm">
            {contact.phone && <li><a className="hover:text-gold" href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} onClick={() => track('call_click')}>{contact.phone}</a></li>}
            {contact.email && <li><a className="hover:text-gold" href={`mailto:${contact.email}`} onClick={() => track('email_click')}>{contact.email}</a></li>}
            {contact.address && <li className="text-ivory/60">{contact.address}</li>}
          </ul>
        </div>
      </div>
      <div className="container-x mt-12 border-t border-ivory/10 pt-6 text-xs text-ivory/40">© {new Date().getFullYear()} {footer.copyright}</div>
    </footer>
  );
}

function WhatsAppFloat() {
  const { site } = useSite();
  const w = site?.settings.whatsapp;
  if (!site || !w?.visible || !site.settings.contact?.whatsapp) return null;
  const open = isOpenNow(site.hours, site.settings.general?.timezone || 'UTC');
  return (
    <motion.a href={whatsappUrl(site)} target="_blank" rel="noopener noreferrer" onClick={() => track('whatsapp_click')} aria-label="Chat on WhatsApp"
      initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 1.2 }} whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.94 }}
      style={{ backgroundColor: w.color || '#25D366' }}
      className={`fixed bottom-20 z-40 grid h-14 w-14 place-items-center rounded-full text-white shadow-xl lg:bottom-6 ${w.position === 'left' ? 'left-4 sm:left-6' : 'right-4 sm:right-6'}`}>
      <Icon name="whatsapp" className="h-7 w-7" />
      <span className={`absolute right-0.5 top-0.5 h-3 w-3 rounded-full border-2 border-white ${open ? 'bg-green-400' : 'bg-gray-300'}`} title={open ? 'Online now' : 'Currently offline'} />
    </motion.a>
  );
}

function StickyBookBar() {
  const { site } = useSite();
  const { pathname } = useLocation();
  if (pathname.startsWith('/book')) return null;
  const phone = site?.settings.contact?.phone;
  return (
    <div className="pb-safe fixed inset-x-0 bottom-0 z-40 flex gap-px border-t border-charcoal/10 bg-ivory lg:hidden">
      {phone && <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} onClick={() => track('call_click')} className="grid w-16 place-items-center border-r border-charcoal/10 text-charcoal" aria-label="Call"><Icon name="phone" /></a>}
      <Link to="/book" onClick={() => track('booking_click')} className="btn btn-solid m-2 flex-1 rounded-theme">Book an appointment</Link>
    </div>
  );
}

export function Layout() {
  const loc = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); track('pageview'); }, [loc.pathname]);
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:bg-paper focus:px-4 focus:py-2">Skip to content</a>
      <Header />
      {/* enter-only page transition: an exit phase with <Outlet/> can leave the new page stuck at opacity 0 */}
      <motion.main id="main" key={loc.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <Outlet />
      </motion.main>
      <Footer />
      <WhatsAppFloat />
      <StickyBookBar />
    </div>
  );
}

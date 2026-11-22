import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, money as fmt } from './api';

export interface SiteData {
  settings: Record<string, any>;
  nav: { id: number; label: string; href: string; area: string }[];
  social: { id: number; platform: string; url: string; username: string; icon: string }[];
  hours: { weekday: number; closed: boolean; open_min: number; close_min: number }[];
  categories: { id: number; name: string; slug: string; description: string }[];
  sections: { id: number; page: string; type: string; name: string; content: Record<string, any> }[];
  testimonials: any[]; promotions: any[]; featuredGallery: any[]; featuredServices: any[];
  pages: { slug: string; title: string; seo_title?: string; seo_description?: string; seo_keywords?: string; og_image?: string; og_title?: string; og_description?: string; canonical_url?: string; robots?: string }[];
}

interface Ctx { site: SiteData | null; error: string | null; reload: () => void; money: (c: number) => string }
const SiteContext = createContext<Ctx>({ site: null, error: null, reload: () => {}, money: (c) => String(c) });
export const useSite = () => useContext(SiteContext);

const hexToRgb = (h: string) => { const n = parseInt(h.slice(1), 16); return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`; };
const loaded = new Set<string>();

export function loadFont(family?: string) {
  if (!family || loaded.has(family)) return;
  loaded.add(family);
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap`;
  document.head.appendChild(l);
}

/** Applies admin-configured theme tokens as CSS variables so every page restyles instantly. */
export function applyTheme(theme: any) {
  if (!theme) return;
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries<string>(theme.colors || {})) if (/^#[0-9a-f]{6}$/i.test(v)) root.setProperty(`--c-${k}`, hexToRgb(v));
  if (theme.fonts?.heading) { loadFont(theme.fonts.heading); root.setProperty('--font-heading', `'${theme.fonts.heading}'`); }
  if (theme.fonts?.body) { loadFont(theme.fonts.body); root.setProperty('--font-body', `'${theme.fonts.body}'`); }
  if (theme.radius != null) root.setProperty('--radius', `${theme.radius}px`);
  if (theme.sectionSpacing) root.setProperty('--section-y', `${theme.sectionSpacing}px`);
}

export function SiteProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<SiteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);

  useEffect(() => {
    api.get<SiteData>('/public/site').then((s) => { setSite(s); applyTheme(s.settings.theme); }).catch((e) => setError(e.message));
  }, [n]);

  useEffect(() => {
    const id = site?.settings.analytics?.ga4Id;
    if (!id || !/^G-[A-Z0-9]+$/.test(id) || document.getElementById('ga4')) return;
    const s = document.createElement('script');
    s.id = 'ga4'; s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    document.head.appendChild(s);
    const w = window as any;
    w.dataLayer = w.dataLayer || [];
    w.gtag = function () { w.dataLayer.push(arguments); };
    w.gtag('js', new Date()); w.gtag('config', id);
  }, [site?.settings.analytics?.ga4Id]);

  const value = useMemo<Ctx>(() => {
    const g = site?.settings.general || {};
    return { site, error, reload: () => setN((x) => x + 1), money: (c: number) => fmt(c, g.currency || 'USD', g.locale || 'en-US') };
  }, [site, error]);
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export type TrackType = 'pageview' | 'booking_click' | 'whatsapp_click' | 'call_click' | 'email_click' | 'form_submit' | 'gallery_view' | 'booking_complete';
export function track(type: TrackType, ref?: string) {
  try {
    const body = JSON.stringify({ type, path: location.pathname, ref });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/public/track', new Blob([body], { type: 'application/json' }));
    else fetch('/api/public/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true });
    (window as any).gtag?.('event', type, { page_path: location.pathname });
  } catch { /* analytics must never break the page */ }
}

const digits = (s: string) => (s || '').replace(/[^\d]/g, '');

export function whatsappUrl(site: SiteData | null, message?: string) {
  const num = digits(site?.settings.contact?.whatsapp || '');
  const text = message ?? site?.settings.whatsapp?.greeting ?? '';
  return `https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** Pre-filled WhatsApp enquiry for a service (template editable in admin). */
export function whatsappServiceUrl(site: SiteData | null, svc: { name: string; price_cents: number; price_type: string }, money: (c: number) => string, date?: string) {
  const tpl: string = site?.settings.whatsapp?.serviceTemplate || 'Hi, I would like to enquire about {{service}}.';
  const price = svc.price_type === 'custom' ? 'Custom quotation' : `${svc.price_type === 'starting_from' ? 'From ' : ''}${money(svc.price_cents)}`;
  const text = tpl.replace(/\{\{service\}\}/g, svc.name).replace(/\{\{price\}\}/g, price).replace(/\{\{date\}\}/g, date || 'To be confirmed').replace(/\{\{url\}\}/g, location.origin);
  return whatsappUrl(site, text);
}

export const priceLabel = (s: { price_cents: number; price_type: string }, money: (c: number) => string) =>
  s.price_type === 'custom' ? 'Custom quote' : `${s.price_type === 'starting_from' ? 'From ' : ''}${money(s.price_cents)}`;

export const fmtDuration = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

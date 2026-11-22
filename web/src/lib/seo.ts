import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSite } from './site';

function setMeta(attr: 'name' | 'property', key: string, content?: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!content) { el?.remove(); return; }
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

/** Applies per-page SEO from the admin (title, description, OG, canonical, robots) plus JSON-LD structured data. */
export function useSeo(slug: string, extra?: { title?: string; jsonLd?: object }) {
  const { site } = useSite();
  const { pathname } = useLocation();
  useEffect(() => {
    if (!site) return;
    const p = site.pages.find((x) => x.slug === slug);
    const seo = site.settings.seo || {};
    const brand = site.settings.brand || {};
    const title = extra?.title ? `${extra.title} | ${brand.name}` : p?.seo_title || `${p?.title || slug} | ${brand.name}`;
    const desc = p?.seo_description || seo.defaultDescription || '';
    document.title = title;
    setMeta('name', 'description', desc);
    setMeta('name', 'keywords', p?.seo_keywords);
    setMeta('name', 'robots', p?.robots || 'index,follow');
    setMeta('property', 'og:title', p?.og_title || title);
    setMeta('property', 'og:description', p?.og_description || desc);
    setMeta('property', 'og:image', p?.og_image ? new URL(p.og_image, location.origin).href : undefined);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:url', location.origin + pathname);
    setMeta('name', 'twitter:card', p?.og_image ? 'summary_large_image' : 'summary');
    setMeta('name', 'twitter:title', p?.og_title || title);
    setMeta('name', 'twitter:description', p?.og_description || desc);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
    link.href = p?.canonical_url || location.origin + pathname;

    const contact = site.settings.contact || {};
    const ld: any[] = [{
      '@context': 'https://schema.org', '@type': ['LocalBusiness', seo.businessType || 'MakeupArtist'], name: brand.name, description: desc, url: location.origin,
      telephone: contact.phone, email: contact.email, priceRange: seo.priceRange, areaServed: seo.areaServed || undefined,
      address: contact.address ? { '@type': 'PostalAddress', streetAddress: contact.address } : undefined,
      sameAs: site.social.map((s) => s.url),
      image: site.featuredGallery[0]?.display_url ? new URL(site.featuredGallery[0].display_url, location.origin).href : undefined,
    }];
    if (slug !== 'home') ld.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: location.origin + '/' }, { '@type': 'ListItem', position: 2, name: p?.title || slug, item: location.origin + pathname }] });
    if (extra?.jsonLd) ld.push(extra.jsonLd);
    let script = document.getElementById('ld-json') as HTMLScriptElement | null;
    if (!script) { script = document.createElement('script'); script.id = 'ld-json'; script.type = 'application/ld+json'; document.head.appendChild(script); }
    script.textContent = JSON.stringify(ld);
    const fav = brand.favicon;
    if (fav) {
      let icon = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.appendChild(icon); }
      icon.href = fav;
    }
  }, [site, slug, pathname, extra?.title, extra?.jsonLd]);
}

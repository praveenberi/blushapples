import type { Db } from '../db';
import { config } from '../config';
import { esc } from './notify';

const ROUTES: Record<string, string> = { '/': 'home', '/about': 'about', '/services': 'services', '/portfolio': 'portfolio', '/book': 'book', '/contact': 'contact', '/promotions': 'promotions' };
const POLICIES: Record<string, string> = { privacy: 'Privacy policy', terms: 'Terms & conditions', cancellation: 'Cancellation policy' };

export interface RenderedPage { status: number; html: string }

/** Injects per-page SEO (title, description, OG, Twitter, canonical, robots, JSON-LD) and a crawlable text summary into the SPA shell. */
export async function renderPage(db: Db, template: string, rawPath: string): Promise<RenderedPage> {
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
  const base = config.publicUrl.replace(/\/$/, '');
  const settings = Object.fromEntries((await db.q<any>(`SELECT key,value FROM website_settings WHERE key IN ('brand','contact','seo','general')`)).map((r) => [r.key, r.value]));
  const brand = settings.brand || {}, contact = settings.contact || {}, seo = settings.seo || {};
  const policy = path.match(/^\/policy\/(\w+)$/)?.[1];
  const slug = ROUTES[path];
  const known = !!slug || !!(policy && POLICIES[policy]);
  const isAdmin = path === '/admin' || path.startsWith('/admin/');
  const [page] = slug ? await db.q<any>('SELECT * FROM pages WHERE slug=$1 AND visible', [slug]) : [];
  const title = page?.seo_title || (policy && POLICIES[policy] ? `${POLICIES[policy]} | ${brand.name}` : `${brand.name || 'Makeup Artist'}`);
  const desc = page?.seo_description || seo.defaultDescription || '';
  const robots = isAdmin || !known ? 'noindex,nofollow' : page?.robots || 'index,follow';
  const canonical = page?.canonical_url || base + (path === '/' ? '/' : path);
  const og = page?.og_image ? new URL(page.og_image, base).href : '';

  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    page?.seo_keywords ? `<meta name="keywords" content="${esc(page.seo_keywords)}" />` : '',
    `<meta name="robots" content="${esc(robots)}" />`,
    `<link rel="canonical" href="${esc(canonical)}" />`,
    `<meta property="og:type" content="website" />`, `<meta property="og:site_name" content="${esc(brand.name)}" />`,
    `<meta property="og:title" content="${esc(page?.og_title || title)}" />`, `<meta property="og:description" content="${esc(page?.og_description || desc)}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`, og ? `<meta property="og:image" content="${esc(og)}" />` : '',
    `<meta name="twitter:card" content="${og ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(page?.og_title || title)}" />`, `<meta name="twitter:description" content="${esc(page?.og_description || desc)}" />`,
  ];

  let body = '';
  if (known && !isAdmin) {
    const social = (await db.q<any>('SELECT url FROM social_links WHERE visible ORDER BY sort_order')).map((s) => s.url);
    const ld: any[] = [{
      '@context': 'https://schema.org', '@type': ['LocalBusiness', seo.businessType || 'MakeupArtist'], name: brand.name, description: seo.defaultDescription, url: base,
      telephone: contact.phone, email: contact.email, priceRange: seo.priceRange, areaServed: seo.areaServed || undefined,
      address: contact.address ? { '@type': 'PostalAddress', streetAddress: contact.address } : undefined, sameAs: social,
    }];
    const heading = page?.title || (policy && POLICIES[policy]) || brand.name;
    if (path !== '/') ld.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: base + '/' }, { '@type': 'ListItem', position: 2, name: heading, item: canonical }] });
    const items: string[] = [`<h1>${esc(heading)}</h1>`, desc ? `<p>${esc(desc)}</p>` : ''];
    if (slug === 'services') {
      const svcs = await db.q<any>('SELECT name,description,price_cents,price_type FROM services WHERE deleted_at IS NULL AND available ORDER BY sort_order LIMIT 30');
      const cur = settings.general?.currency || 'USD';
      ld.push({ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: svcs.map((s, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Service', name: s.name, description: s.description,
        offers: s.price_type !== 'custom' && s.price_cents > 0 ? { '@type': 'Offer', price: (s.price_cents / 100).toFixed(2), priceCurrency: cur } : undefined } })) });
      items.push('<ul>' + svcs.map((s) => `<li><strong>${esc(s.name)}</strong> ${esc(s.description)}</li>`).join('') + '</ul>');
    }
    if (slug === 'contact' && (contact.phone || contact.email)) items.push(`<p>${esc(contact.phone)} ${esc(contact.email)} ${esc(contact.address)}</p>`);
    tags.push(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
    body = `<div data-prerender>${items.join('')}</div>`; // crawlable fallback; React replaces it on load
  }
  const html = template
    .replace(/<title>[\s\S]*?<\/title>/i, '').replace(/<meta name="description"[^>]*>/i, '')
    .replace('</head>', `${tags.filter(Boolean).join('\n    ')}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  return { status: known || isAdmin ? 200 : 404, html };
}

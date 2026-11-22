import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { z } from 'zod';
import { config } from '../config';
import { ah, HttpError, parse } from '../lib/http';
import { loadServices } from './services';
import { fetchBuffer, upload } from './gallery';
import { storeImageVariants } from '../lib/images';
import { notify, whatsappAdmin } from '../lib/notify';
import { adminEmail } from './bookings';
import { localNow, setting } from '../lib/booking';

const limiter = (n: number) => rateLimit({ windowMs: 15 * 60_000, limit: config.isTest ? 10_000 : n, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please try again later.' } });

export function publicRouter() {
  const r = Router();

  /** Everything the shell needs on first paint, in one request. */
  r.get('/site', ah(async (req, res) => {
    const db = req.db;
    const settingsRows = await db.q<{ key: string; value: any }>(`SELECT key, value FROM website_settings WHERE key NOT LIKE 'private\\_%'`);
    const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
    const today = localNow(settings.general?.timezone || 'UTC').date;
    const [nav, social, hours, categories, sections, testimonials, promotions, featuredGallery, pages] = await Promise.all([
      db.q(`SELECT id,label,href,area FROM navigation_items WHERE visible ORDER BY sort_order,id`),
      db.q(`SELECT id,platform,url,username,icon FROM social_links WHERE visible ORDER BY sort_order,id`),
      db.q(`SELECT * FROM business_hours ORDER BY weekday`),
      db.q(`SELECT id,name,slug,description FROM service_categories WHERE visible ORDER BY sort_order,id`),
      db.q(`SELECT id,page,type,name,content FROM page_sections WHERE visible ORDER BY page,sort_order,id`),
      db.q(`SELECT id,customer_name,image_url,review,rating,service_category,review_date,featured,is_demo FROM testimonials WHERE approved ORDER BY featured DESC, sort_order, id`),
      db.q(`SELECT * FROM promotions WHERE visible AND (start_date IS NULL OR start_date<=$1) AND (end_date IS NULL OR end_date>=$1) ORDER BY sort_order,id`, [today]),
      db.q(`SELECT id,title,alt_text,thumb_url,display_url,before_url,width,height,category_id FROM gallery_images WHERE deleted_at IS NULL AND status='published' AND featured ORDER BY sort_order LIMIT 12`),
      db.q(`SELECT slug,title,seo_title,seo_description,seo_keywords,og_image,og_title,og_description,canonical_url,robots FROM pages WHERE visible`),
    ]);
    const featuredServices = await loadServices(db, 'AND s.available AND s.featured');
    res.json({ settings, nav, social, hours, categories, sections, testimonials, promotions, featuredGallery, pages, featuredServices });
  }));

  r.get('/services', ah(async (req, res) => {
    res.json(await loadServices(req.db, 'AND s.available'));
  }));

  r.get('/gallery', ah(async (req, res) => {
    const { category, album, q, sort } = req.query as Record<string, string | undefined>;
    const where = [`g.deleted_at IS NULL`, `g.status='published'`], p: any[] = [];
    if (category) { p.push(category); where.push(`c.slug=$${p.length}`); }
    if (album) { p.push(album); where.push(`a.slug=$${p.length}`); }
    if (q) { p.push(`%${q.toLowerCase().slice(0, 60)}%`); where.push(`(lower(g.title) LIKE $${p.length} OR lower(g.tags::text) LIKE $${p.length})`); }
    const order = sort === 'newest' ? 'g.created_at DESC' : sort === 'featured' ? 'g.featured DESC, g.sort_order' : 'g.sort_order, g.id DESC';
    const [items, categories, albums] = await Promise.all([
      req.db.q(`SELECT g.id,g.title,g.description,g.alt_text,g.tags,g.thumb_url,g.display_url,g.original_url,g.before_url,g.width,g.height,g.featured,g.allow_download,
        c.name AS category_name, c.slug AS category_slug, a.title AS album_title, a.slug AS album_slug
        FROM gallery_images g LEFT JOIN gallery_categories c ON c.id=g.category_id LEFT JOIN gallery_albums a ON a.id=g.album_id
        WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 300`, p),
      req.db.q(`SELECT id,name,slug FROM gallery_categories WHERE visible ORDER BY sort_order,id`),
      req.db.q(`SELECT id,title,slug,description,cover_url FROM gallery_albums WHERE visible ORDER BY sort_order,id`),
    ]);
    res.json({ items, categories, albums });
  }));

  r.post('/inquiries', limiter(8), ah(async (req, res) => {
    const d = parse(z.object({
      name: z.string().trim().min(2).max(120), phone: z.string().trim().max(30).optional().default(''),
      email: z.string().trim().email().max(200).or(z.literal('')).optional().default(''),
      service_interest: z.string().max(160).optional().default(''), event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
      message: z.string().trim().min(5).max(4000),
      attachments: z.array(z.string().max(2000).refine((u) => u.startsWith('/uploads/') || u.startsWith('https://'))).max(5).default([]),
      website: z.string().max(0).optional(),
    }), req.body);
    if (!d.phone && !d.email) throw new HttpError(400, 'Please provide a phone number or email so we can reply');
    if (d.website) return void res.status(201).json({ ok: true });
    const [row] = await req.db.q<any>(
      `INSERT INTO inquiries(name,phone,email,service_interest,event_date,message,attachments) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id`,
      [d.name, d.phone, d.email, d.service_interest, d.event_date || null, d.message, JSON.stringify(d.attachments)]);
    const vars = { name: d.name, message: d.message, service: d.service_interest, link: `${config.publicUrl}/admin/inquiries` };
    void notify(req.db, 'inquiry_received', d.email, vars);
    void notify(req.db, 'admin_new_inquiry', await adminEmail(req.db), vars);
    void whatsappAdmin(req.db, `New inquiry from ${d.name}: ${d.message.slice(0, 120)}`);
    res.status(201).json({ ok: true, id: row.id });
  }));

  /** Reference-photo upload for visitors: images only, tight rate limit, size-capped by multer. */
  r.post('/upload', limiter(20), upload.single('file'), ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Please upload a JPEG, PNG, WebP or AVIF image up to 15MB');
    const v = await storeImageVariants(req.file.buffer, 'reference', 'references');
    res.status(201).json({ url: v.displayUrl });
  }));

  r.post('/track', limiter(300), ah(async (req, res) => {
    const d = parse(z.object({
      type: z.enum(['pageview', 'booking_click', 'whatsapp_click', 'call_click', 'email_click', 'form_submit', 'gallery_view', 'booking_complete']),
      path: z.string().max(300).default(''), ref: z.string().max(80).optional(),
    }), req.body);
    // Anonymous visitor hash: salted by day so visitors can be counted without storing identifiers.
    const day = new Date().toISOString().slice(0, 10);
    const visitor = crypto.createHash('sha256').update(`${req.ip}|${req.headers['user-agent']}|${day}|${config.jwtSecret}`).digest('hex').slice(0, 16);
    await req.db.q('INSERT INTO analytics_events(type,path,ref_id,visitor) VALUES ($1,$2,$3,$4)', [d.type, d.path, d.ref ?? null, visitor]);
    if (d.type === 'gallery_view' && d.ref && /^\d+$/.test(d.ref)) await req.db.q('UPDATE gallery_images SET views=views+1 WHERE id=$1', [Number(d.ref)]);
    res.json({ ok: true });
  }));

  return r;
}

/** sitemap.xml and robots.txt, generated from live data. */
export function seoRouter() {
  const r = Router();
  r.get('/sitemap.xml', ah(async (req, res) => {
    const base = config.publicUrl.replace(/\/$/, '');
    const pages = await req.db.q<any>(`SELECT slug, updated_at FROM pages WHERE visible AND robots NOT LIKE '%noindex%'`);
    const urls = pages.map((p) => `<url><loc>${base}${p.slug === 'home' ? '/' : '/' + p.slug}</loc><lastmod>${new Date(p.updated_at).toISOString().slice(0, 10)}</lastmod></url>`);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  }));
  r.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nSitemap: ${config.publicUrl.replace(/\/$/, '')}/sitemap.xml\n`);
  });
  return r;
}

export { fetchBuffer };

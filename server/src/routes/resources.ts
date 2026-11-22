import { Router } from 'express';
import { z } from 'zod';
import { crudRouter } from '../lib/crud';

const url = z.string().max(2000).nullable().optional();
const str = (n = 500) => z.string().max(n);
const slug = z.string().min(1).max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, numbers and hyphens only');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const sort = z.number().int().optional();

/** Simple resources managed through the generic validated CRUD factory. */
export function resourceRouter() {
  const r = Router();

  r.use('/service-categories', crudRouter({
    table: 'service_categories', perm: 'services',
    cols: { name: 'text', slug: 'text', description: 'text', visible: 'bool', sort_order: 'int' },
    schema: z.object({ name: str(120).min(1), slug, description: str(1000).optional(), visible: z.boolean().optional(), sort_order: sort }),
  }));

  r.use('/gallery-categories', crudRouter({
    table: 'gallery_categories', perm: 'gallery',
    cols: { name: 'text', slug: 'text', visible: 'bool', sort_order: 'int' },
    schema: z.object({ name: str(120).min(1), slug, visible: z.boolean().optional(), sort_order: sort }),
  }));

  r.use('/albums', crudRouter({
    table: 'gallery_albums', perm: 'gallery',
    cols: { title: 'text', slug: 'text', description: 'text', cover_url: 'text', visible: 'bool', sort_order: 'int' },
    schema: z.object({ title: str(160).min(1), slug, description: str(2000).optional(), cover_url: url, visible: z.boolean().optional(), sort_order: sort }),
  }));

  r.use('/testimonials', crudRouter({
    table: 'testimonials', perm: 'testimonials',
    cols: { customer_name: 'text', image_url: 'text', review: 'text', rating: 'int', service_category: 'text', review_date: 'text', approved: 'bool', featured: 'bool', is_demo: 'bool', sort_order: 'int' },
    schema: z.object({
      customer_name: str(120).min(1), image_url: url, review: str(2000).min(1), rating: z.number().int().min(1).max(5),
      service_category: str(120).optional(), review_date: dateStr, approved: z.boolean().optional(), featured: z.boolean().optional(),
      is_demo: z.boolean().optional(), sort_order: sort,
    }),
  }));

  r.use('/promotions', crudRouter({
    table: 'promotions', perm: 'promotions',
    cols: { title: 'text', description: 'text', banner_url: 'text', start_date: 'text', end_date: 'text', discount_type: 'text', discount_value: 'int', promo_code: 'text', terms: 'text', cta_label: 'text', cta_href: 'text', visible: 'bool', is_demo: 'bool', sort_order: 'int' },
    schema: z.object({
      title: str(160).min(1), description: str(2000).optional(), banner_url: url, start_date: dateStr, end_date: dateStr,
      discount_type: z.enum(['percent', 'fixed', 'none']), discount_value: z.number().int().min(0).max(1_000_000),
      promo_code: str(40).nullable().optional(), terms: str(4000).optional(), cta_label: str(60).optional(), cta_href: str(300).optional(),
      visible: z.boolean().optional(), is_demo: z.boolean().optional(), sort_order: sort,
    }),
  }));

  r.use('/social-links', crudRouter({
    table: 'social_links', perm: 'social',
    cols: { platform: 'text', url: 'text', username: 'text', icon: 'text', visible: 'bool', sort_order: 'int' },
    schema: z.object({
      platform: str(60).min(1), url: str(500).regex(/^https?:\/\//, 'Must start with http:// or https://'),
      username: str(120).optional(), icon: str(60).optional(), visible: z.boolean().optional(), sort_order: sort,
    }),
  }));

  r.use('/navigation', crudRouter({
    table: 'navigation_items', perm: 'content',
    cols: { label: 'text', href: 'text', area: 'text', visible: 'bool', sort_order: 'int' },
    schema: z.object({ label: str(60).min(1), href: str(300).min(1), area: z.enum(['header', 'footer']), visible: z.boolean().optional(), sort_order: sort }),
  }));

  r.use('/sections', crudRouter({
    table: 'page_sections', perm: 'content', touch: true, filters: ['page'], order: 'page, sort_order, id',
    cols: { page: 'text', type: 'text', name: 'text', content: 'json', visible: 'bool', sort_order: 'int' },
    schema: z.object({
      page: z.enum(['home', 'about']), type: str(40).min(1), name: str(120).optional(),
      content: z.record(z.any()).optional(), visible: z.boolean().optional(), sort_order: sort,
    }),
  }));

  r.use('/blocked-dates', crudRouter({
    table: 'blocked_dates', perm: 'bookings', order: 'date',
    cols: { date: 'text', end_date: 'text', reason: 'text', is_holiday: 'bool' },
    schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end_date: dateStr, reason: str(200).optional(), is_holiday: z.boolean().optional() }),
  }));

  r.use('/inquiries', crudRouter({
    table: 'inquiries', perm: 'inquiries', order: 'created_at DESC',
    cols: { status: 'text', internal_notes: 'text' },
    schema: z.object({ status: z.enum(['new', 'replied', 'closed', 'spam']), internal_notes: str(4000) }),
  }));

  r.use('/templates', crudRouterTemplates());
  return r;
}

import { ah, audit, HttpError, parse } from '../lib/http';
import { requirePerm } from '../lib/auth';

/** notification_templates use a text primary key, so they get a small dedicated router. */
function crudRouterTemplates() {
  const r = Router();
  const g = requirePerm('settings');
  r.get('/', g, ah(async (req, res) => res.json(await req.db.q('SELECT * FROM notification_templates ORDER BY audience, key'))));
  r.put('/:key', g, ah(async (req, res) => {
    const d = parse(z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(6000), enabled: z.boolean() }), req.body);
    const rows = await req.db.q('UPDATE notification_templates SET subject=$1, body=$2, enabled=$3 WHERE key=$4 RETURNING key', [d.subject, d.body, d.enabled, req.params.key]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    await audit(req, 'update', 'notification_templates', req.params.key);
    res.json({ ok: true });
  }));
  r.get('/logs/recent', g, ah(async (req, res) => res.json(await req.db.q('SELECT * FROM notification_logs ORDER BY id DESC LIMIT 100'))));
  return r;
}

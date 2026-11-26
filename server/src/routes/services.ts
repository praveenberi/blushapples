import { Router } from 'express';
import { z } from 'zod';
import { ah, audit, HttpError, parse } from '../lib/http';
import { requirePerm } from '../lib/auth';
import type { Db, Q } from '../db';

const addon = z.object({ name: z.string().min(1).max(120), price_cents: z.number().int().min(0).max(10_000_000), duration_min: z.number().int().min(0).max(600) });
export const serviceSchema = z.object({
  category_id: z.number().int().nullable().optional(),
  name: z.string().min(1).max(160),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(160).optional(),
  description: z.string().max(5000).optional(),
  price_cents: z.number().int().min(0).max(100_000_000),
  price_type: z.enum(['fixed', 'starting_from', 'custom']),
  duration_min: z.number().int().min(0).max(1440), // 0 = not shown on the website
  included: z.array(z.string().max(200)).max(40).optional(),
  image_url: z.string().max(2000).nullable().optional(),
  gallery: z.array(z.string().max(2000)).max(30).optional(),
  available: z.boolean().optional(),
  bookable: z.boolean().optional(),
  featured: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  is_demo: z.boolean().optional(),
  addons: z.array(addon).max(30).optional(),
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'service';

async function uniqueSlug(q: Q, base: string, ignoreId?: number) {
  let s = base, i = 2;
  for (;;) {
    const rows = await q('SELECT id FROM services WHERE slug=$1 AND ($2::int IS NULL OR id<>$2)', [s, ignoreId ?? null]);
    if (!rows.length) return s;
    s = `${base}-${i++}`;
  }
}

export async function loadServices(db: Db, where = '', params: any[] = []) {
  const rows = await db.q<any>(
    `SELECT s.*, c.name AS category_name, c.slug AS category_slug FROM services s
     LEFT JOIN service_categories c ON c.id=s.category_id WHERE s.deleted_at IS NULL ${where} ORDER BY s.sort_order, s.id`, params);
  if (!rows.length) return rows;
  const addons = await db.q<any>('SELECT * FROM service_addons WHERE service_id = ANY($1::int[]) ORDER BY sort_order, id', [rows.map((r) => r.id)]);
  return rows.map((r) => ({ ...r, addons: addons.filter((a) => a.service_id === r.id) }));
}

async function saveAddons(q: Q, serviceId: number, addons: z.infer<typeof addon>[]) {
  await q('DELETE FROM service_addons WHERE service_id=$1', [serviceId]);
  for (let i = 0; i < addons.length; i++) {
    await q('INSERT INTO service_addons(service_id,name,price_cents,duration_min,sort_order) VALUES ($1,$2,$3,$4,$5)', [serviceId, addons[i].name, addons[i].price_cents, addons[i].duration_min, i + 1]);
  }
}

export function servicesRouter() {
  const r = Router();
  const g = requirePerm('services');

  r.get('/', g, ah(async (req, res) => res.json(await loadServices(req.db))));

  r.post('/', g, ah(async (req, res) => {
    const d = parse(serviceSchema, req.body);
    const id = await req.db.tx(async (q) => {
      const slug = await uniqueSlug(q, d.slug || slugify(d.name));
      const [{ n }] = await q<{ n: number }>('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM services');
      const [row] = await q<any>(
        `INSERT INTO services(category_id,name,slug,description,price_cents,price_type,duration_min,included,image_url,gallery,available,bookable,featured,sort_order,is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15) RETURNING id`,
        [d.category_id ?? null, d.name, slug, d.description ?? '', d.price_cents, d.price_type, d.duration_min, JSON.stringify(d.included ?? []), d.image_url ?? null,
          JSON.stringify(d.gallery ?? []), d.available ?? true, d.bookable ?? true, d.featured ?? false, d.sort_order ?? n, d.is_demo ?? false]);
      await saveAddons(q, row.id, d.addons ?? []);
      return row.id as number;
    });
    await audit(req, 'create', 'services', id);
    res.status(201).json((await loadServices(req.db, 'AND s.id=$1', [id]))[0]);
  }));

  r.put('/:id', g, ah(async (req, res) => {
    const id = Number(req.params.id);
    const d = parse(serviceSchema.partial(), req.body);
    await req.db.tx(async (q) => {
      const [cur] = await q('SELECT id FROM services WHERE id=$1 AND deleted_at IS NULL', [id]);
      if (!cur) throw new HttpError(404, 'Not found');
      const json = new Set(['included', 'gallery']);
      const cols = ['category_id', 'name', 'description', 'price_cents', 'price_type', 'duration_min', 'included', 'image_url', 'gallery', 'available', 'bookable', 'featured', 'sort_order', 'is_demo'] as const;
      const sets: string[] = [], vals: any[] = [];
      for (const c of cols) if ((d as any)[c] !== undefined) { vals.push(json.has(c) ? JSON.stringify((d as any)[c]) : (d as any)[c]); sets.push(`${c}=$${vals.length}${json.has(c) ? '::jsonb' : ''}`); }
      if (d.slug) { vals.push(await uniqueSlug(q, d.slug, id)); sets.push(`slug=$${vals.length}`); }
      if (sets.length) await q(`UPDATE services SET ${sets.join(',')}, updated_at=now() WHERE id=$${vals.length + 1}`, [...vals, id]);
      if (d.addons) await saveAddons(q, id, d.addons);
    });
    await audit(req, 'update', 'services', id);
    res.json((await loadServices(req.db, 'AND s.id=$1', [id]))[0]);
  }));

  r.post('/:id/duplicate', g, ah(async (req, res) => {
    const [src] = await loadServices(req.db, 'AND s.id=$1', [Number(req.params.id)]);
    if (!src) throw new HttpError(404, 'Not found');
    const id = await req.db.tx(async (q) => {
      const slug = await uniqueSlug(q, `${src.slug}-copy`);
      const [{ n }] = await q<{ n: number }>('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM services');
      const [row] = await q<any>(
        `INSERT INTO services(category_id,name,slug,description,price_cents,price_type,duration_min,included,image_url,gallery,available,bookable,featured,sort_order,is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,false,$13,$14) RETURNING id`,
        [src.category_id, `${src.name} (copy)`, slug, src.description, src.price_cents, src.price_type, src.duration_min, JSON.stringify(src.included), src.image_url, JSON.stringify(src.gallery), false, src.bookable, n, src.is_demo]);
      await saveAddons(q, row.id, src.addons);
      return row.id as number;
    });
    await audit(req, 'duplicate', 'services', id, { from: src.id });
    res.status(201).json((await loadServices(req.db, 'AND s.id=$1', [id]))[0]);
  }));

  r.post('/reorder', g, ah(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.number().int()).max(1000) }), req.body);
    await req.db.tx(async (q) => { for (let i = 0; i < ids.length; i++) await q('UPDATE services SET sort_order=$1 WHERE id=$2', [i + 1, ids[i]]); });
    res.json({ ok: true });
  }));

  r.delete('/:id', g, ah(async (req, res) => {
    const rows = await req.db.q('UPDATE services SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id', [Number(req.params.id)]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    await audit(req, 'delete', 'services', req.params.id);
    res.json({ ok: true });
  }));

  return r;
}

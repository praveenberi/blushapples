import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import sharp from 'sharp';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { ah, audit, HttpError, parse } from '../lib/http';
import { requirePerm } from '../lib/auth';
import { applyManualEdits, inspect, removeVariants, slugify, storeImageVariants, type EditParams } from '../lib/images';
import { aiProvider, AI_FEATURES } from '../lib/ai';
import { storage } from '../lib/storage';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 30 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|avif)$/.test(file.mimetype)),
});

export async function fetchBuffer(url: string): Promise<Buffer> {
  if (url.startsWith('/uploads/')) {
    const root = path.resolve(config.uploadDir);
    const file = path.resolve(root, url.slice('/uploads/'.length));
    if (!file.startsWith(root)) throw new HttpError(400, 'Bad path');
    return fs.readFileSync(file);
  }
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(502, 'Could not load source image');
  return Buffer.from(await res.arrayBuffer());
}

/** SQL expression: is this image URL referenced anywhere on the site? */
const IN_USE = (u: string) => `
  EXISTS (SELECT 1 FROM page_sections s WHERE position(${u} in s.content::text) > 0)
  OR EXISTS (SELECT 1 FROM website_settings w WHERE position(${u} in w.value::text) > 0)
  OR EXISTS (SELECT 1 FROM services s WHERE s.deleted_at IS NULL AND (s.image_url = ${u} OR position(${u} in s.gallery::text) > 0))
  OR EXISTS (SELECT 1 FROM promotions p WHERE p.banner_url = ${u})
  OR EXISTS (SELECT 1 FROM testimonials t WHERE t.image_url = ${u})
  OR EXISTS (SELECT 1 FROM gallery_albums a WHERE a.cover_url = ${u})`;

const rid = () => crypto.randomBytes(5).toString('hex');
const num = z.number().min(-100).max(100).optional();
const paramsSchema = z.object({
  brightness: num, contrast: num, saturation: num, sharpness: num, exposure: num, temperature: num, tint: num, highlights: num, shadows: num,
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.02).max(1), h: z.number().min(0.02).max(1) }).optional(),
  intensity: z.enum(['subtle', 'natural', 'medium', 'strong']).optional(),
  denoise: z.number().min(0).max(100).optional(),
  autoLevel: z.boolean().optional(),
});
const editBody = z.object({ params: paramsSchema, ai: z.object({ features: z.array(z.enum(AI_FEATURES)).max(30) }).optional() });

const patchSchema = z.object({
  category_id: z.number().int().nullable().optional(), album_id: z.number().int().nullable().optional(),
  title: z.string().max(200).optional(), description: z.string().max(3000).optional(), alt_text: z.string().max(300).optional(),
  tags: z.array(z.string().max(40)).max(30).optional(), featured: z.boolean().optional(),
  status: z.enum(['published', 'hidden', 'archived']).optional(), allow_download: z.boolean().optional(),
  sort_order: z.number().int().optional(), before_url: z.string().max(2000).nullable().optional(), is_demo: z.boolean().optional(),
});

const LIST = `SELECT g.*, c.name AS category_name, a.title AS album_title FROM gallery_images g
  LEFT JOIN gallery_categories c ON c.id=g.category_id LEFT JOIN gallery_albums a ON a.id=g.album_id`;

export function galleryRouter() {
  const r = Router();
  const g = requirePerm('gallery');

  r.get('/', g, ah(async (req, res) => {
    const { q, category, status, album } = req.query as Record<string, string | undefined>;
    const where: string[] = ['g.deleted_at IS NULL'], p: any[] = [];
    if (q) { p.push(`%${q.toLowerCase()}%`); where.push(`(lower(g.title) LIKE $${p.length} OR lower(g.tags::text) LIKE $${p.length} OR lower(g.alt_text) LIKE $${p.length})`); }
    if (category) { p.push(Number(category)); where.push(`g.category_id=$${p.length}`); }
    if (album) { p.push(Number(album)); where.push(`g.album_id=$${p.length}`); }
    if (status) { p.push(status); where.push(`g.status=$${p.length}`); }
    res.json(await req.db.q(`${LIST} WHERE ${where.join(' AND ')} ORDER BY g.sort_order, g.id DESC`, p));
  }));

  r.post('/upload', g, upload.array('files', 30), ah(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) throw new HttpError(400, 'No valid image files received (JPEG, PNG, WebP, AVIF up to 15MB)');
    const body = parse(z.object({
      category_id: z.coerce.number().int().optional(), album_id: z.coerce.number().int().optional(),
      status: z.enum(['published', 'hidden']).optional(),
    }), req.body);
    const created: any[] = [], errors: { file: string; error: string }[] = [];
    for (const f of files) {
      try {
        const title = f.originalname.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 120);
        const v = await storeImageVariants(f.buffer, title);
        const [{ n }] = await req.db.q<{ n: number }>('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM gallery_images');
        const [row] = await req.db.q<any>(
          `INSERT INTO gallery_images(category_id,album_id,title,alt_text,storage_key,url,display_url,thumb_url,original_url,width,height,status,sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [body.category_id ?? null, body.album_id ?? null, title, title, v.storageKey, v.displayUrl, v.thumbUrl, v.originalUrl, v.width, v.height, body.status ?? 'published', n]);
        created.push(row.id);
      } catch (e: any) {
        errors.push({ file: f.originalname, error: e.message || 'Failed' });
      }
    }
    await audit(req, 'upload', 'gallery_images', undefined, { count: created.length });
    const items = created.length ? await req.db.q(`${LIST} WHERE g.id = ANY($1::int[]) ORDER BY g.id`, [created]) : [];
    res.status(created.length ? 201 : 400).json({ items, errors });
  }));

  /** Single image upload that returns URLs only (hero/profile/service/promo imagery, "before" photos, avatars). */
  r.post('/asset', requirePerm(), upload.single('file'), ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No valid image received');
    const v = await storeImageVariants(req.file.buffer, req.file.originalname.replace(/\.[^.]+$/, ''), 'assets');
    await req.db.q('INSERT INTO media_assets(url,thumb_url,original_url,storage_key,filename,width,height) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (url) DO NOTHING',
      [v.displayUrl, v.thumbUrl, v.originalUrl, v.storageKey, req.file.originalname.slice(0, 200), v.width, v.height]);
    res.status(201).json({ url: v.displayUrl, thumb_url: v.thumbUrl, original_url: v.originalUrl, width: v.width, height: v.height });
  }));

  /** Media library: every image uploaded for page sections, logos, services, etc. */
  r.get('/media', requirePerm(), ah(async (req, res) => {
    res.json(await req.db.q(`SELECT m.*, (${IN_USE('m.url')}) AS in_use FROM media_assets m ORDER BY m.id DESC LIMIT 500`));
  }));

  r.delete('/media/:id', requirePerm(), ah(async (req, res) => {
    const p = req.user!.permissions;
    if (!p.includes('*') && !p.includes('gallery') && !p.includes('content')) throw new HttpError(403, 'You do not have permission to delete images');
    const [m] = await req.db.q<any>('SELECT * FROM media_assets WHERE id=$1', [Number(req.params.id)]);
    if (!m) throw new HttpError(404, 'Not found');
    const [u] = await req.db.q<any>(`SELECT (${IN_USE('$1')}) AS in_use`, [m.url]);
    if (u.in_use && req.query.force !== 'true') throw new HttpError(409, 'This image is still used on the website');
    await removeVariants(m.storage_key).catch(() => {});
    await req.db.q('DELETE FROM media_assets WHERE id=$1', [m.id]);
    await audit(req, 'delete', 'media_assets', m.id, { url: m.url });
    res.json({ ok: true });
  }));

  r.get('/ai/capabilities', g, (_req, res) => {
    const p = aiProvider();
    res.json({ provider: p.name, available: p.available, features: p.features });
  });

  r.get('/presets', g, ah(async (req, res) => res.json(await req.db.q('SELECT * FROM enhancement_presets ORDER BY built_in DESC, id'))));
  r.post('/presets', g, ah(async (req, res) => {
    const d = parse(z.object({ name: z.string().min(1).max(60), params: z.object({}).passthrough() }), req.body);
    const [row] = await req.db.q('INSERT INTO enhancement_presets(name,params) VALUES ($1,$2::jsonb) RETURNING *', [d.name, JSON.stringify(d.params)]);
    await audit(req, 'create', 'enhancement_presets', (row as any).id);
    res.status(201).json(row);
  }));
  r.delete('/presets/:id', g, ah(async (req, res) => {
    const rows = await req.db.q('DELETE FROM enhancement_presets WHERE id=$1 AND NOT built_in RETURNING id', [Number(req.params.id)]);
    if (!rows.length) throw new HttpError(404, 'Custom preset not found');
    res.json({ ok: true });
  }));

  r.post('/bulk', g, ah(async (req, res) => {
    const d = parse(z.object({
      ids: z.array(z.number().int()).min(1).max(500),
      action: z.enum(['publish', 'hide', 'archive', 'delete', 'feature', 'unfeature', 'category']),
      category_id: z.number().int().nullable().optional(),
    }), req.body);
    const sql: Record<string, [string, any[]]> = {
      publish: [`UPDATE gallery_images SET status='published', updated_at=now() WHERE id = ANY($1::int[])`, [d.ids]],
      hide: [`UPDATE gallery_images SET status='hidden', updated_at=now() WHERE id = ANY($1::int[])`, [d.ids]],
      archive: [`UPDATE gallery_images SET status='archived', updated_at=now() WHERE id = ANY($1::int[])`, [d.ids]],
      delete: [`UPDATE gallery_images SET deleted_at=now() WHERE id = ANY($1::int[])`, [d.ids]],
      feature: [`UPDATE gallery_images SET featured=true, updated_at=now() WHERE id = ANY($1::int[])`, [d.ids]],
      unfeature: [`UPDATE gallery_images SET featured=false, updated_at=now() WHERE id = ANY($1::int[])`, [d.ids]],
      category: [`UPDATE gallery_images SET category_id=$2, updated_at=now() WHERE id = ANY($1::int[])`, [d.ids, d.category_id ?? null]],
    };
    const [text, params] = sql[d.action];
    await req.db.q(text, params);
    await audit(req, `bulk_${d.action}`, 'gallery_images', undefined, { ids: d.ids });
    res.json({ ok: true });
  }));

  r.post('/reorder', g, ah(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.number().int()).max(2000) }), req.body);
    await req.db.tx(async (q) => { for (let i = 0; i < ids.length; i++) await q('UPDATE gallery_images SET sort_order=$1 WHERE id=$2', [i + 1, ids[i]]); });
    res.json({ ok: true });
  }));

  r.get('/:id', g, ah(async (req, res) => {
    const [row] = await req.db.q<any>(`${LIST} WHERE g.id=$1 AND g.deleted_at IS NULL`, [Number(req.params.id)]);
    if (!row) throw new HttpError(404, 'Not found');
    const history = await req.db.q('SELECT id, action, created_at FROM image_edit_history WHERE image_id=$1 ORDER BY id DESC LIMIT 30', [row.id]);
    res.json({ ...row, history });
  }));

  r.put('/:id', g, ah(async (req, res) => {
    const id = Number(req.params.id);
    const d = parse(patchSchema, req.body) as Record<string, any>;
    const sets: string[] = [], vals: any[] = [];
    for (const [k, v] of Object.entries(d)) {
      if (v === undefined) continue;
      vals.push(k === 'tags' ? JSON.stringify(v) : v);
      sets.push(`${k}=$${vals.length}${k === 'tags' ? '::jsonb' : ''}`);
    }
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    const rows = await req.db.q(`UPDATE gallery_images SET ${sets.join(',')}, updated_at=now() WHERE id=$${vals.length + 1} AND deleted_at IS NULL RETURNING id`, [...vals, id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    await audit(req, 'update', 'gallery_images', id);
    res.json((await req.db.q(`${LIST} WHERE g.id=$1`, [id]))[0]);
  }));

  r.delete('/:id', g, ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = await req.db.q('UPDATE gallery_images SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id', [id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    await audit(req, 'delete', 'gallery_images', id);
    res.json({ ok: true });
  }));

  /* ---------------- enhancement studio ---------------- */

  /** The ORIGINAL is the only source: edits are non-destructive and always re-derived from it. */
  async function render(req: any, id: number, body: z.infer<typeof editBody>, maxWidth?: number) {
    const [img] = await req.db.q('SELECT * FROM gallery_images WHERE id=$1 AND deleted_at IS NULL', [id]);
    if (!img) throw new HttpError(404, 'Not found');
    let src = await fetchBuffer(img.original_url);
    let provider = 'manual';
    if (body.ai?.features.length) {
      const ai = aiProvider();
      if (!ai.available) throw new HttpError(409, 'AI provider is not configured. Manual tools remain available.');
      const input = maxWidth ? await sharp(src).rotate().resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer() : src;
      src = await ai.enhance(input, { intensity: body.params.intensity || 'natural', features: body.ai.features });
      provider = ai.name;
    }
    const out = await applyManualEdits(src, body.params as EditParams, maxWidth);
    return { img, out, provider };
  }

  r.post('/:id/edit/preview', g, ah(async (req, res) => {
    const { out } = await render(req, Number(req.params.id), parse(editBody, req.body), 1100);
    const jpg = await sharp(out).jpeg({ quality: 82 }).toBuffer();
    res.type('image/jpeg').set('Cache-Control', 'no-store').send(jpg);
  }));

  /** Full-resolution enhanced JPEG as a download; nothing is saved. */
  r.post('/:id/edit/download', g, ah(async (req, res) => {
    const { out, img } = await render(req, Number(req.params.id), parse(editBody, req.body));
    const jpg = await sharp(out).jpeg({ quality: 95 }).toBuffer();
    res.type('image/jpeg').set('Content-Disposition', 'attachment; filename="' + slugify(img.title || 'image') + '-enhanced.jpg"').send(jpg);
  }));

  r.post('/:id/edit/save', g, ah(async (req, res) => {
    const id = Number(req.params.id);
    const body = parse(editBody.extend({ mode: z.enum(['copy', 'replace']), confirm: z.boolean().optional(), preset: z.string().max(60).optional() }), req.body);
    if (body.mode === 'replace' && !body.confirm) throw new HttpError(400, 'Replacing requires confirmation');
    const { img, out, provider } = await render(req, id, body);
    const jpegOrig = await sharp(out).jpeg({ quality: 95 }).toBuffer();
    let resultId = id;

    if (body.mode === 'copy') {
      const v = await storeImageVariants(jpegOrig, `${img.title || 'image'} enhanced`);
      const [{ n }] = await req.db.q<{ n: number }>('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM gallery_images');
      const [row] = await req.db.q<any>(
        `INSERT INTO gallery_images(category_id,album_id,title,description,alt_text,tags,storage_key,url,display_url,thumb_url,original_url,width,height,status,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$8,$9,$10,$11,$12,'hidden',$13) RETURNING id`,
        [img.category_id, img.album_id, `${img.title} (enhanced)`, img.description, img.alt_text, JSON.stringify(img.tags), v.storageKey, v.displayUrl, v.thumbUrl, v.originalUrl, v.width, v.height, n]);
      resultId = row.id;
    } else {
      const key = `${img.storage_key}-edit-${rid()}`;
      const meta = await inspect(jpegOrig);
      const d = await storage().put(`${key}.webp`, await sharp(jpegOrig).resize({ width: 2000, withoutEnlargement: true }).webp({ quality: 86 }).toBuffer(), 'image/webp');
      const t = await storage().put(`${key}-thumb.webp`, await sharp(jpegOrig).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(), 'image/webp');
      await req.db.q('INSERT INTO image_edit_history(image_id,action,snapshot,created_by) VALUES ($1,$2,$3::jsonb,$4)', [
        id, 'replace', JSON.stringify({ prev: { url: img.url, display_url: img.display_url, thumb_url: img.thumb_url, width: img.width, height: img.height }, next_key: key }), req.user!.id]);
      await req.db.q('UPDATE gallery_images SET url=$1, display_url=$1, thumb_url=$2, width=$3, height=$4, updated_at=now() WHERE id=$5', [d.url, t.url, meta.width, meta.height, id]);
    }
    await req.db.q('INSERT INTO image_edits(image_id,result_image_id,params,provider,mode,created_by) VALUES ($1,$2,$3::jsonb,$4,$5,$6)', [
      id, resultId, JSON.stringify({ ...body.params, ai: body.ai, preset: body.preset }), provider, body.mode, req.user!.id]);
    await audit(req, `enhance_${body.mode}`, 'gallery_images', id, { resultId, provider });
    res.json((await req.db.q(`${LIST} WHERE g.id=$1`, [resultId]))[0]);
  }));

  r.post('/:id/revert', g, ah(async (req, res) => {
    const id = Number(req.params.id);
    const hist = await req.db.q<any>(`SELECT * FROM image_edit_history WHERE image_id=$1 AND action='replace' ORDER BY id`, [id]);
    if (!hist.length) throw new HttpError(409, 'This image has not been replaced; it is already the original');
    const prev = hist[0].snapshot.prev;
    await req.db.q('UPDATE gallery_images SET url=$1, display_url=$2, thumb_url=$3, width=$4, height=$5, updated_at=now() WHERE id=$6', [prev.url, prev.display_url, prev.thumb_url, prev.width, prev.height, id]);
    for (const h of hist) await removeVariants(h.snapshot.next_key).catch(() => {});
    await req.db.q(`DELETE FROM image_edit_history WHERE image_id=$1 AND action='replace'`, [id]);
    await req.db.q('INSERT INTO image_edit_history(image_id,action,snapshot,created_by) VALUES ($1,$2,$3::jsonb,$4)', [id, 'revert', '{}', req.user!.id]);
    await audit(req, 'revert', 'gallery_images', id);
    res.json((await req.db.q(`${LIST} WHERE g.id=$1`, [id]))[0]);
  }));

  return r;
}

export { slugify };

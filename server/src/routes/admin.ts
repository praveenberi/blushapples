import { Router } from 'express';
import { z } from 'zod';
import { ah, audit, HttpError, parse } from '../lib/http';
import { hashPassword, passwordSchema, requirePerm } from '../lib/auth';
import { localNow, setting } from '../lib/booking';

/** Which permission may edit which settings group. */
const SETTING_PERM: Record<string, string> = {
  brand: 'content', footer: 'content', faqs: 'content', instagram: 'content', policies: 'content',
  contact: 'settings', general: 'settings', theme: 'settings', whatsapp: 'settings', analytics: 'settings', seo: 'seo', booking: 'settings', notifications: 'settings',
};
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const SETTING_SCHEMA: Record<string, z.ZodTypeAny> = {
  theme: z.object({
    colors: z.record(hex).optional(),
    fonts: z.object({ heading: z.string().max(60), body: z.string().max(60) }).optional(),
    radius: z.number().min(0).max(40).optional(), sectionSpacing: z.number().min(24).max(240).optional(),
    buttonStyle: z.enum(['solid', 'outline', 'pill']).optional(),
  }).passthrough(),
  booking: z.object({
    slotIntervalMin: z.number().int().min(5).max(240), bufferMin: z.number().int().min(0).max(240), travelBufferMin: z.number().int().min(0).max(480),
    leadTimeHours: z.number().int().min(0).max(24 * 90), maxAdvanceDays: z.number().int().min(1).max(1000),
    depositPercent: z.number().int().min(0).max(100).optional(), autoConfirm: z.boolean().optional(),
  }).passthrough(),
  general: z.object({ currency: z.string().length(3), timezone: z.string().max(60).refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown timezone') }).passthrough(),
  faqs: z.array(z.object({ q: z.string().max(300), a: z.string().max(3000) })).max(60),
};

export function adminRouter() {
  const r = Router();

  /* ------- settings ------- */
  r.get('/settings', requirePerm(), ah(async (req, res) => {
    const rows = await req.db.q<{ key: string; value: any }>('SELECT key, value FROM website_settings');
    res.json(Object.fromEntries(rows.map((x) => [x.key, x.value])));
  }));

  r.put('/settings/:key', ah(async (req, _res, next) => requirePerm(SETTING_PERM[req.params.key])(req, _res, next)), ah(async (req, res) => {
    const key = req.params.key;
    if (!(key in SETTING_PERM)) throw new HttpError(404, 'Unknown setting group');
    const body = parse(z.object({ value: z.any() }), req.body).value;
    const value = SETTING_SCHEMA[key] ? parse(SETTING_SCHEMA[key], body) : body;
    if (typeof value !== 'object' || value === null) throw new HttpError(400, 'Value must be an object or array');
    if (JSON.stringify(value).length > 200_000) throw new HttpError(413, 'Setting too large');
    await req.db.q(`INSERT INTO website_settings(key,value,updated_at) VALUES ($1,$2::jsonb,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [key, JSON.stringify(value)]);
    await audit(req, 'update', 'website_settings', key);
    res.json({ ok: true });
  }));

  /* ------- business hours ------- */
  r.get('/hours', requirePerm('bookings'), ah(async (req, res) => res.json(await req.db.q('SELECT * FROM business_hours ORDER BY weekday'))));
  r.put('/hours', requirePerm('bookings'), ah(async (req, res) => {
    const rows = parse(z.array(z.object({
      weekday: z.number().int().min(0).max(6), closed: z.boolean(), open_min: z.number().int().min(0).max(1439), close_min: z.number().int().min(1).max(1440),
    }).refine((h) => h.closed || h.open_min < h.close_min, 'Opening time must be before closing time')).length(7), req.body);
    await req.db.tx(async (q) => { for (const h of rows) await q(
      `INSERT INTO business_hours(weekday,closed,open_min,close_min) VALUES ($1,$2,$3,$4) ON CONFLICT (weekday) DO UPDATE SET closed=EXCLUDED.closed, open_min=EXCLUDED.open_min, close_min=EXCLUDED.close_min`,
      [h.weekday, h.closed, h.open_min, h.close_min]); });
    await audit(req, 'update', 'business_hours');
    res.json({ ok: true });
  }));

  /* ------- pages / SEO ------- */
  r.get('/pages', requirePerm('seo'), ah(async (req, res) => res.json(await req.db.q('SELECT * FROM pages ORDER BY id'))));
  r.put('/pages/:id', requirePerm('seo'), ah(async (req, res) => {
    const id = Number(req.params.id);
    const t = z.string().max(500).nullable().optional();
    const d = parse(z.object({
      title: z.string().min(1).max(120).optional(), visible: z.boolean().optional(), seo_title: t, seo_description: t, seo_keywords: t, og_image: t, og_title: t, og_description: t,
      canonical_url: z.string().max(500).nullable().optional(), robots: z.enum(['index,follow', 'noindex,follow', 'index,nofollow', 'noindex,nofollow']).optional(),
    }), req.body) as Record<string, any>;
    const sets: string[] = [], vals: any[] = [];
    for (const [k, v] of Object.entries(d)) if (v !== undefined) { vals.push(v); sets.push(`${k}=$${vals.length}`); }
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    const rows = await req.db.q(`UPDATE pages SET ${sets.join(',')}, updated_at=now() WHERE id=$${vals.length + 1} RETURNING *`, [...vals, id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    await audit(req, 'update', 'pages', id);
    res.json(rows[0]);
  }));

  /* ------- dashboard & analytics ------- */
  r.get('/dashboard', requirePerm(), ah(async (req, res) => {
    const db = req.db, p = req.user!.permissions, all = p.includes('*');
    const tz = (await setting<any>(db.q, 'general', {})).timezone || 'UTC';
    const today = localNow(tz).date;
    const out: Record<string, any> = { today };
    if (all || p.includes('bookings')) {
      const [c] = await db.q<any>(
        `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE booking_date>=$1 AND status NOT IN ('cancelled','rejected','completed'))::int AS upcoming,
          count(*) FILTER (WHERE booking_date=$1 AND status NOT IN ('cancelled','rejected'))::int AS today,
          count(*) FILTER (WHERE status='confirmed')::int AS confirmed,
          count(*) FILTER (WHERE status IN ('new','pending_confirmation'))::int AS pending,
          count(*) FILTER (WHERE status='completed')::int AS completed,
          COALESCE(sum(total_cents) FILTER (WHERE status IN ('completed','deposit_paid','in_progress')),0)::int AS revenue_cents,
          COALESCE(sum(total_cents) FILTER (WHERE status IN ('confirmed','deposit_requested')),0)::int AS pipeline_cents
         FROM bookings WHERE deleted_at IS NULL`, [today]);
      out.bookings = c;
      out.popularServices = await db.q(`SELECT bs.name, count(*)::int AS count FROM booking_services bs JOIN bookings b ON b.id=bs.booking_id
        WHERE b.deleted_at IS NULL AND b.status NOT IN ('cancelled','rejected') GROUP BY bs.name ORDER BY count DESC LIMIT 5`);
      out.todaysAppointments = await db.q(`SELECT b.id,b.reference,b.status,b.start_min,b.end_min,c.name AS customer_name,
        (SELECT string_agg(name, ', ') FROM booking_services WHERE booking_id=b.id) AS service_names
        FROM bookings b LEFT JOIN customers c ON c.id=b.customer_id WHERE b.booking_date=$1 AND b.deleted_at IS NULL AND b.status NOT IN ('cancelled','rejected') ORDER BY b.start_min`, [today]);
    }
    if (all || p.includes('inquiries')) {
      const [i] = await db.q<any>(`SELECT count(*) FILTER (WHERE status='new')::int AS pending, count(*)::int AS total FROM inquiries`);
      out.inquiries = i;
      out.recentInquiries = await db.q('SELECT id,name,service_interest,message,status,created_at FROM inquiries ORDER BY id DESC LIMIT 5');
    }
    if (all || p.includes('gallery')) {
      const [g] = await db.q<any>(`SELECT count(*)::int AS images, COALESCE(sum(views),0)::int AS views FROM gallery_images WHERE deleted_at IS NULL`);
      out.gallery = g;
    }
    res.json(out);
  }));

  r.get('/analytics', requirePerm('analytics'), ah(async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const since = `now() - ($1 || ' days')::interval`;
    const counts = await req.db.q<any>(`SELECT type, count(*)::int AS count FROM analytics_events WHERE created_at >= ${since} GROUP BY type`, [String(days)]);
    const [v] = await req.db.q<any>(`SELECT count(DISTINCT visitor)::int AS visitors FROM analytics_events WHERE type='pageview' AND created_at >= ${since}`, [String(days)]);
    const pages = await req.db.q(`SELECT path, count(*)::int AS views FROM analytics_events WHERE type='pageview' AND created_at >= ${since} GROUP BY path ORDER BY views DESC LIMIT 10`, [String(days)]);
    const gallery = await req.db.q(`SELECT g.id, g.title, g.thumb_url, count(*)::int AS views FROM analytics_events e JOIN gallery_images g ON g.id::text=e.ref_id
      WHERE e.type='gallery_view' AND e.created_at >= ${since} GROUP BY g.id,g.title,g.thumb_url ORDER BY views DESC LIMIT 8`, [String(days)]);
    const by = Object.fromEntries(counts.map((c) => [c.type, c.count]));
    const [bk] = await req.db.q<any>(`SELECT count(*)::int AS n FROM bookings WHERE created_at >= ${since} AND source='website'`, [String(days)]);
    res.json({
      days, visitors: v.visitors, pageViews: by.pageview || 0, bookingClicks: by.booking_click || 0, whatsappClicks: by.whatsapp_click || 0, callClicks: by.call_click || 0,
      formSubmissions: by.form_submit || 0, bookings: bk.n, conversionRate: v.visitors ? Math.round((bk.n / v.visitors) * 1000) / 10 : 0, topPages: pages, topGallery: gallery,
    });
  }));

  /* ------- customers ------- */
  const cg = requirePerm('customers');
  r.get('/customers', cg, ah(async (req, res) => {
    const q = req.query.q ? `%${String(req.query.q).toLowerCase()}%` : null;
    res.json(await req.db.q(`SELECT c.*, count(b.id)::int AS booking_count, max(b.booking_date) AS last_appointment
      FROM customers c LEFT JOIN bookings b ON b.customer_id=c.id AND b.deleted_at IS NULL
      WHERE c.deleted_at IS NULL AND ($1::text IS NULL OR lower(c.name) LIKE $1 OR lower(c.email) LIKE $1 OR c.phone LIKE $1)
      GROUP BY c.id ORDER BY c.created_at DESC LIMIT 500`, [q]));
  }));
  r.get('/customers/:id', cg, ah(async (req, res) => {
    const id = Number(req.params.id);
    const [c] = await req.db.q<any>('SELECT * FROM customers WHERE id=$1 AND deleted_at IS NULL', [id]);
    if (!c) throw new HttpError(404, 'Not found');
    c.bookings = await req.db.q(`SELECT b.id,b.reference,b.status,b.booking_date,b.start_min,b.total_cents,
      (SELECT string_agg(name, ', ') FROM booking_services WHERE booking_id=b.id) AS service_names FROM bookings b WHERE b.customer_id=$1 AND b.deleted_at IS NULL ORDER BY b.booking_date DESC`, [id]);
    c.notes = await req.db.q('SELECT n.*, u.name AS author FROM customer_notes n LEFT JOIN users u ON u.id=n.created_by WHERE n.customer_id=$1 ORDER BY n.id DESC', [id]);
    res.json(c);
  }));
  r.put('/customers/:id', cg, ah(async (req, res) => {
    const d = parse(z.object({ name: z.string().min(1).max(120), email: z.string().email().nullable().optional().or(z.literal('')), phone: z.string().max(30).nullable().optional(), whatsapp: z.string().max(30).nullable().optional(), tags: z.array(z.string().max(30)).max(20).optional() }), req.body);
    const rows = await req.db.q(`UPDATE customers SET name=$1, email=NULLIF($2,''), phone=$3, whatsapp=$4, tags=COALESCE($5::jsonb,tags), updated_at=now() WHERE id=$6 AND deleted_at IS NULL RETURNING id`,
      [d.name, d.email ?? '', d.phone ?? null, d.whatsapp ?? null, d.tags ? JSON.stringify(d.tags) : null, Number(req.params.id)]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    await audit(req, 'update', 'customers', req.params.id);
    res.json({ ok: true });
  }));
  r.post('/customers/:id/notes', cg, ah(async (req, res) => {
    const { note } = parse(z.object({ note: z.string().trim().min(1).max(3000) }), req.body);
    await req.db.q('INSERT INTO customer_notes(customer_id,note,created_by) VALUES ($1,$2,$3)', [Number(req.params.id), note, req.user!.id]);
    res.status(201).json({ ok: true });
  }));

  /* ------- users & roles ------- */
  const ug = requirePerm('users');
  r.get('/roles', ug, ah(async (req, res) => res.json(await req.db.q('SELECT * FROM roles ORDER BY id'))));
  r.get('/users', ug, ah(async (req, res) => res.json(await req.db.q(
    `SELECT u.id,u.email,u.name,u.active,u.last_login_at,u.created_at,r.name AS role,r.label AS role_label FROM users u JOIN roles r ON r.id=u.role_id WHERE u.deleted_at IS NULL ORDER BY u.id`))));
  r.post('/users', ug, ah(async (req, res) => {
    const d = parse(z.object({ email: z.string().email().max(200), name: z.string().min(1).max(120), password: passwordSchema, role: z.string() }), req.body);
    const [role] = await req.db.q<any>('SELECT id FROM roles WHERE name=$1', [d.role]);
    if (!role) throw new HttpError(400, 'Unknown role');
    const [dupe] = await req.db.q('SELECT id FROM users WHERE lower(email)=lower($1) AND deleted_at IS NULL', [d.email]);
    if (dupe) throw new HttpError(409, 'A user with that email already exists');
    const [u] = await req.db.q<any>('INSERT INTO users(email,name,password_hash,role_id) VALUES ($1,$2,$3,$4) RETURNING id', [d.email, d.name, await hashPassword(d.password), role.id]);
    await audit(req, 'create', 'users', u.id, { role: d.role });
    res.status(201).json({ id: u.id });
  }));
  r.put('/users/:id', ug, ah(async (req, res) => {
    const id = Number(req.params.id);
    const d = parse(z.object({ name: z.string().min(1).max(120).optional(), role: z.string().optional(), active: z.boolean().optional(), password: passwordSchema.optional() }), req.body);
    if (id === req.user!.id && (d.active === false || (d.role && d.role !== req.user!.role))) throw new HttpError(400, 'You cannot deactivate or demote your own account');
    const sets: string[] = [], vals: any[] = [];
    if (d.name) { vals.push(d.name); sets.push(`name=$${vals.length}`); }
    if (d.active !== undefined) { vals.push(d.active); sets.push(`active=$${vals.length}`); }
    if (d.role) { const [ro] = await req.db.q<any>('SELECT id FROM roles WHERE name=$1', [d.role]); if (!ro) throw new HttpError(400, 'Unknown role'); vals.push(ro.id); sets.push(`role_id=$${vals.length}`); }
    if (d.password) { vals.push(await hashPassword(d.password)); sets.push(`password_hash=$${vals.length}`); }
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    const rows = await req.db.q(`UPDATE users SET ${sets.join(',')}, updated_at=now() WHERE id=$${vals.length + 1} AND deleted_at IS NULL RETURNING id`, [...vals, id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    await audit(req, 'update', 'users', id, { role: d.role, active: d.active, passwordReset: !!d.password });
    res.json({ ok: true });
  }));

  r.get('/audit', ug, ah(async (req, res) => res.json(await req.db.q('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200'))));

  return r;
}

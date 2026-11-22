import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createDb, migrate, type Db } from '../src/db';
import { createApp } from '../src/app';
import { seed } from '../src/seed';
import { hashPassword } from '../src/lib/auth';

let db: Db;
let app: ReturnType<typeof createApp>;
const ADMIN = { email: 'admin@example.com', password: 'Str0ngPassw0rd!' };

async function login(email: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  return { agent, res, csrf: res.body.csrf as string };
}

/** next bookable date: 10+ days out and not a Sunday (seed closes Sundays) */
function futureDate(offset = 10) {
  const d = new Date(Date.now() + offset * 86_400_000);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const bookingBody = (serviceId: number, date: string, time: string, email = 'client@example.com') => ({
  serviceIds: [serviceId], addonIds: [], date, time,
  customer: { name: 'Test Client', phone: '+1 555 ' + String(Math.abs([...email].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 9000000 + 1000000), email },
  event: { locationType: 'studio', venue: '', people: 1 },
});

beforeAll(async () => {
  db = await createDb({ memory: true });
  await migrate(db);
  await seed(db, { adminPassword: ADMIN.password, demoImages: false });
  const [role] = await db.q<any>(`SELECT id FROM roles WHERE name='booking_manager'`);
  await db.q('INSERT INTO users(email,name,password_hash,role_id) VALUES ($1,$2,$3,$4)', ['bm@example.com', 'BM', await hashPassword('Str0ngPassw0rd!'), role.id]);
  app = createApp(db);
});
afterAll(async () => { await db.close(); });

describe('auth & security', () => {
  it('rejects bad credentials and unauthenticated admin access', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: ADMIN.email, password: 'wrong-password' })).status).toBe(401);
    expect((await request(app).get('/api/admin/services')).status).toBe(401);
  });

  it('requires a CSRF token on state-changing admin requests', async () => {
    const { agent, res, csrf } = await login(ADMIN.email, ADMIN.password);
    expect(res.status).toBe(200);
    const body = { name: 'CSRF test', price_cents: 1000, price_type: 'fixed', duration_min: 30 };
    expect((await agent.post('/api/admin/services').send(body)).status).toBe(403);
    expect((await agent.post('/api/admin/services').set('x-csrf-token', csrf).send(body)).status).toBe(201);
  });

  it('enforces role permissions server-side', async () => {
    const { agent, csrf } = await login('bm@example.com', 'Str0ngPassw0rd!');
    expect((await agent.get('/api/admin/bookings')).status).toBe(200);
    expect((await agent.put('/api/admin/settings/theme').set('x-csrf-token', csrf).send({ value: {} })).status).toBe(403);
    expect((await agent.get('/api/admin/users')).status).toBe(403);
    expect((await agent.get('/api/admin/gallery')).status).toBe(403);
  });

  it('validates input with field errors', async () => {
    const { agent, csrf } = await login(ADMIN.email, ADMIN.password);
    const res = await agent.post('/api/admin/services').set('x-csrf-token', csrf).send({ name: '', price_cents: -5, price_type: 'nope', duration_min: 1 });
    expect(res.status).toBe(400);
    expect(res.body.details).toBeTruthy();
  });

  it('does not leak SQL injection through search params', async () => {
    const { agent } = await login(ADMIN.email, ADMIN.password);
    const res = await agent.get('/api/admin/bookings').query({ q: "'; DROP TABLE bookings; --" });
    expect(res.status).toBe(200);
    expect((await agent.get('/api/admin/bookings')).status).toBe(200);
  });
});

describe('public site', () => {
  it('serves site payload with seeded demo content flagged as demo', async () => {
    const res = await request(app).get('/api/public/site');
    expect(res.status).toBe(200);
    expect(res.body.settings.brand.name).toBeTruthy();
    expect(res.body.categories.length).toBeGreaterThanOrEqual(18);
    expect(res.body.testimonials.length).toBeGreaterThanOrEqual(6);
    expect(res.body.testimonials.every((t: any) => t.is_demo)).toBe(true);
    expect(JSON.stringify(res.body.settings)).not.toMatch(/private_/);
  });

  it('has at least 10 services and sitemap/robots', async () => {
    const services = await request(app).get('/api/public/services');
    expect(services.body.length).toBeGreaterThanOrEqual(10);
    expect((await request(app).get('/sitemap.xml')).text).toContain('<urlset');
    expect((await request(app).get('/robots.txt')).text).toContain('Disallow: /admin');
  });

  it('stores inquiries and rejects honeypot/invalid ones', async () => {
    expect((await request(app).post('/api/public/inquiries').send({ name: 'A', message: 'hi' })).status).toBe(400);
    const ok = await request(app).post('/api/public/inquiries').send({ name: 'Jane Doe', email: 'jane@example.com', message: 'Do you do bridal trials?' });
    expect(ok.status).toBe(201);
    const { agent } = await login(ADMIN.email, ADMIN.password);
    expect((await agent.get('/api/admin/inquiries')).body.some((i: any) => i.name === 'Jane Doe')).toBe(true);
  });
});

describe('booking engine', () => {
  let serviceId: number;
  beforeAll(async () => { serviceId = (await request(app).get('/api/public/services')).body.find((s: any) => s.bookable).id; });

  it('returns slots, none on closed days, and none in the past', async () => {
    const date = futureDate();
    const ok = await request(app).get('/api/public/availability').query({ date, serviceIds: String(serviceId) });
    expect(ok.status).toBe(200);
    expect(ok.body.slots.length).toBeGreaterThan(0);
    const d = new Date(); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCDate(d.getUTCDate() + 14);
    expect((await request(app).get('/api/public/availability').query({ date: d.toISOString().slice(0, 10), serviceIds: String(serviceId) })).body.slots).toEqual([]);
    expect((await request(app).get('/api/public/availability').query({ date: '2020-01-06', serviceIds: String(serviceId) })).body.slots).toEqual([]);
  });

  it('creates a booking, hides the taken slot, and refuses a double booking', async () => {
    const date = futureDate(12);
    const first = await request(app).post('/api/public/bookings').send(bookingBody(serviceId, date, '10:00'));
    expect(first.status).toBe(201);
    expect(first.body.reference).toMatch(/^BA-/);
    const dup = await request(app).post('/api/public/bookings').send(bookingBody(serviceId, date, '10:00', 'other@example.com'));
    expect(dup.status).toBe(409);
    const slots = (await request(app).get('/api/public/availability').query({ date, serviceIds: String(serviceId) })).body.slots.map((s: any) => s.start);
    expect(slots).not.toContain('10:00');
  });

  it('lets only one of two simultaneous requests win the same slot', async () => {
    const date = futureDate(14);
    const results = await Promise.all([1, 2, 3].map((i) => request(app).post('/api/public/bookings').send(bookingBody(serviceId, date, '13:00', `race${i}@example.com`))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
  });

  it('applies promo codes and rejects invalid ones', async () => {
    const date = futureDate(16);
    const bad = await request(app).post('/api/public/bookings').send({ ...bookingBody(serviceId, date, '09:00'), promoCode: 'NOPE' });
    expect(bad.status).toBe(400);
    const good = await request(app).post('/api/public/bookings').send({ ...bookingBody(serviceId, date, '09:00', 'promo@example.com'), promoCode: 'WELCOME10' });
    expect(good.status).toBe(201);
    expect(good.body.discount_cents).toBeGreaterThan(0);
  });

  it('manages bookings: status, reschedule collision, customer record', async () => {
    const { agent, csrf } = await login(ADMIN.email, ADMIN.password);
    const list = (await agent.get('/api/admin/bookings')).body;
    const b = list.find((x: any) => x.customer_email === 'client@example.com');
    const upd = await agent.put(`/api/admin/bookings/${b.id}`).set('x-csrf-token', csrf).send({ status: 'confirmed', internal_notes: 'VIP' });
    expect(upd.body.status).toBe('confirmed');
    const race = list.find((x: any) => x.customer_email?.startsWith('race'));
    const clash = await agent.post(`/api/admin/bookings/${b.id}/reschedule`).set('x-csrf-token', csrf).send({ date: race.booking_date, time: '13:00' });
    expect(clash.status).toBe(409);
    const ok = await agent.post(`/api/admin/bookings/${b.id}/reschedule`).set('x-csrf-token', csrf).send({ date: futureDate(20), time: '11:00' });
    expect(ok.status).toBe(200);
    const customers = (await agent.get('/api/admin/customers')).body;
    expect(customers.some((c: any) => c.email === 'client@example.com' && c.booking_count === 1)).toBe(true);
    const dash = (await agent.get('/api/admin/dashboard')).body;
    expect(dash.bookings.total).toBeGreaterThan(0);
  });

  it('blocked dates remove availability', async () => {
    const { agent, csrf } = await login(ADMIN.email, ADMIN.password);
    const date = futureDate(30);
    await agent.post('/api/admin/blocked-dates').set('x-csrf-token', csrf).send({ date, reason: 'Holiday', is_holiday: true }).expect(201);
    expect((await request(app).get('/api/public/availability').query({ date, serviceIds: String(serviceId) })).body.slots).toEqual([]);
  });
});

describe('services admin', () => {
  it('creates with add-ons, duplicates, hides from public, soft-deletes', async () => {
    const { agent, csrf } = await login(ADMIN.email, ADMIN.password);
    const created = await agent.post('/api/admin/services').set('x-csrf-token', csrf).send({
      name: 'Test Look', price_cents: 9900, price_type: 'starting_from', duration_min: 45, included: ['a', 'b'], addons: [{ name: 'Lashes', price_cents: 1500, duration_min: 10 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.addons).toHaveLength(1);
    const dup = await agent.post(`/api/admin/services/${created.body.id}/duplicate`).set('x-csrf-token', csrf);
    expect(dup.body.name).toContain('(copy)');
    expect(dup.body.addons).toHaveLength(1);
    await agent.put(`/api/admin/services/${created.body.id}`).set('x-csrf-token', csrf).send({ available: false }).expect(200);
    expect((await request(app).get('/api/public/services')).body.some((s: any) => s.id === created.body.id)).toBe(false);
    await agent.delete(`/api/admin/services/${dup.body.id}`).set('x-csrf-token', csrf).expect(200);
    expect((await agent.get('/api/admin/services')).body.some((s: any) => s.id === dup.body.id)).toBe(false);
  });
});

describe('gallery & photo studio', () => {
  async function png(color: string) {
    return sharp({ create: { width: 640, height: 800, channels: 3, background: color } }).png().toBuffer();
  }

  it('uploads, generates variants, rejects fake images', async () => {
    const { agent, csrf } = await login(ADMIN.email, ADMIN.password);
    const res = await agent.post('/api/admin/gallery/upload').set('x-csrf-token', csrf)
      .attach('files', await png('#d9a7a0'), { filename: 'bridal glow.png', contentType: 'image/png' })
      .attach('files', Buffer.from('not an image at all'), { filename: 'evil.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.errors).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.thumb_url).toMatch(/thumb\.webp$/);
    expect(item.width).toBe(640);
    const file = await request(app).get(item.thumb_url);
    expect(file.status).toBe(200);
  });

  it('previews, saves a copy, replaces with confirmation and reverts to original', async () => {
    const { agent, csrf } = await login(ADMIN.email, ADMIN.password);
    const up = await agent.post('/api/admin/gallery/upload').set('x-csrf-token', csrf).attach('files', await png('#8f6f5e'), { filename: 'edit-me.png', contentType: 'image/png' });
    const img = up.body.items[0];
    const params = { brightness: 20, contrast: 10, saturation: 10, sharpness: 20, rotate: 90, crop: { x: 0, y: 0, w: 1, h: 0.5 }, intensity: 'natural' };
    const prev = await agent.post(`/api/admin/gallery/${img.id}/edit/preview`).set('x-csrf-token', csrf).send({ params }).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(prev.status).toBe(200);
    expect(prev.headers['content-type']).toContain('image/jpeg');
    const meta = await sharp(prev.body as Buffer).metadata();
    expect(meta.width).toBe(800); // rotated 90deg: 640x800 -> 800x640, then cropped to half the height
    expect(meta.height).toBe(320);

    const copy = await agent.post(`/api/admin/gallery/${img.id}/edit/save`).set('x-csrf-token', csrf).send({ params, mode: 'copy' });
    expect(copy.status).toBe(200);
    expect(copy.body.id).not.toBe(img.id);
    expect(copy.body.status).toBe('hidden');

    expect((await agent.post(`/api/admin/gallery/${img.id}/edit/save`).set('x-csrf-token', csrf).send({ params, mode: 'replace' })).status).toBe(400);
    const rep = await agent.post(`/api/admin/gallery/${img.id}/edit/save`).set('x-csrf-token', csrf).send({ params, mode: 'replace', confirm: true });
    expect(rep.status).toBe(200);
    expect(rep.body.display_url).not.toBe(img.display_url);
    expect(rep.body.original_url).toBe(img.original_url); // original untouched

    const rev = await agent.post(`/api/admin/gallery/${img.id}/revert`).set('x-csrf-token', csrf);
    expect(rev.body.display_url).toBe(img.display_url);
  });

  it('AI enhancement fails cleanly when no provider is configured, manual stays available', async () => {
    const { agent, csrf } = await login(ADMIN.email, ADMIN.password);
    const cap = await agent.get('/api/admin/gallery/ai/capabilities');
    expect(cap.body.available).toBe(false);
    const id = (await agent.get('/api/admin/gallery')).body[0].id;
    const res = await agent.post(`/api/admin/gallery/${id}/edit/preview`).set('x-csrf-token', csrf).send({ params: {}, ai: { features: ['skin_tone'] } });
    expect(res.status).toBe(409);
  });

  it('filters, bulk-publishes and reorders', async () => {
    const { agent, csrf } = await login(ADMIN.email, ADMIN.password);
    const all = (await agent.get('/api/admin/gallery')).body;
    const ids = all.map((i: any) => i.id).reverse();
    await agent.post('/api/admin/gallery/reorder').set('x-csrf-token', csrf).send({ ids }).expect(200);
    await agent.post('/api/admin/gallery/bulk').set('x-csrf-token', csrf).send({ ids, action: 'publish' }).expect(200);
    const pub = (await request(app).get('/api/public/gallery')).body;
    expect(pub.items.length).toBe(all.length);
    expect((await request(app).get('/api/public/gallery').query({ q: 'bridal' })).body.items.length).toBeGreaterThan(0);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb, migrate, type Db } from '../src/db';
import { createApp } from '../src/app';
import { seed } from '../src/seed';
import { waNumber } from '../src/lib/customerMessages';

let db: Db;
let app: ReturnType<typeof createApp>;
let agent: ReturnType<typeof request.agent>;
let csrf: string;
let id: number;

const slotOn = async (date: string, n = 0) => (await agent.get(`/api/admin/bookings/slots?date=${date}&duration=60&location=studio`)).body[n].start;
const futureWeekday = (weeks: number) => { const d = new Date(Date.now() + weeks * 7 * 86_400_000); while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const put = (body: object) => agent.put(`/api/admin/bookings/${id}`).set('x-csrf-token', csrf).send(body);
const text = (url: string) => decodeURIComponent(new URL(url).searchParams.get('text')!);

beforeAll(async () => {
  db = await createDb({ memory: true });
  await migrate(db);
  await seed(db, { adminEmail: 'p@example.com', adminPassword: 'PayPassw0rd!!', demoImages: false });
  app = createApp(db);
  agent = request.agent(app);
  csrf = (await agent.post('/api/auth/login').send({ email: 'p@example.com', password: 'PayPassw0rd!!' })).body.csrf;
  await db.q(`UPDATE website_settings SET value = value || '{"currency":"SGD"}'::jsonb WHERE key='general'`);
  const [svc] = await db.q<any>('SELECT id FROM services WHERE available AND bookable ORDER BY id LIMIT 1');
  await db.q('UPDATE services SET duration_min=60 WHERE id=$1', [svc.id]);
  const date = futureWeekday(3);
  const made = await agent.post('/api/admin/bookings').set('x-csrf-token', csrf).send({
    serviceIds: [svc.id], date, time: await slotOn(date), status: 'new',
    customer: { name: 'Asha Tan', phone: '9067 1739', email: 'asha@example.com' }, event: { locationType: 'studio', people: 1 },
  });
  expect(made.status).toBe(201);
  id = made.body.id;
});
afterAll(async () => { await db.close(); });

describe('payment tracking', () => {
  it('stores total, deposit and balance, and refuses payments above the total', async () => {
    const ok = await put({ total_cents: 10000, deposit_cents: 3000, balance_paid_cents: 2000 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ total_cents: 10000, deposit_cents: 3000, balance_paid_cents: 2000, messages: null });
    expect((await put({ deposit_cents: 9000 })).status).toBe(400);
    expect((await put({ total_cents: 4000 })).status).toBe(400);
  });
});

describe('customer messages', () => {
  it('prepares email and WhatsApp when the status changes', async () => {
    const r = await put({ status: 'deposit_paid' });
    expect(r.body.messages).toMatchObject({ email: 'skipped', whatsapp: 'manual', kind: 'status' });
    expect(r.body.messages.whatsappUrl).toMatch(/^https:\/\/wa\.me\/6590671739\?text=/);
    const msg = text(r.body.messages.whatsappUrl);
    expect(msg).toContain('We have received your deposit');
    expect(msg).toContain('Paid: SGD 50.00');
    expect(msg).toContain('Balance due: SGD 50.00');
  });

  it('can be switched off for a correction', async () => {
    expect((await put({ status: 'in_progress', notify: false })).body.messages).toBeNull();
  });

  it('tells the customer the new time after rescheduling', async () => {
    const date = futureWeekday(5);
    const r = await agent.post(`/api/admin/bookings/${id}/reschedule`).set('x-csrf-token', csrf).send({ date, time: await slotOn(date, 1) });
    expect(r.status).toBe(200);
    expect(r.body.messages.kind).toBe('rescheduled');
    expect(text(r.body.messages.whatsappUrl)).toContain(date);
  });

  it('formats local and international numbers', () => {
    expect(waNumber('9067 1739', '65')).toBe('6590671739');
    expect(waNumber('6590671739', '65')).toBe('6590671739');
    expect(waNumber('+91 98765 43210', '65')).toBe('919876543210');
    expect(waNumber('012-345 6789', '60')).toBe('60123456789');
  });
});

describe('feedback', () => {
  it('sends a link when closed; the answer waits for approval and the link works once', async () => {
    const r = await put({ status: 'completed' });
    expect(r.body.messages.kind).toBe('feedback');
    const token = text(r.body.messages.whatsappUrl).match(/\/feedback\/([\w-]+)/)![1];

    const visitor = request(app);
    expect((await visitor.get(`/api/public/feedback/${token}`)).body.customerName).toBe('Asha Tan');
    const answer = { name: 'Asha', rating: 5, review: 'Loved my look, thank you!' };
    expect((await visitor.post(`/api/public/feedback/${token}`).send(answer)).status).toBe(201);
    expect((await visitor.post(`/api/public/feedback/${token}`).send(answer)).status).toBe(410);

    const [t] = await db.q<any>(`SELECT * FROM testimonials WHERE customer_name='Asha'`);
    expect(t).toMatchObject({ approved: false, rating: 5, is_demo: false });
    expect((await visitor.get('/api/public/site')).body.testimonials.some((x: any) => x.customer_name === 'Asha')).toBe(false);

    // closing again after an answer does not ask a second time
    await put({ status: 'in_progress', notify: false });
    expect((await put({ status: 'completed' })).body.messages.kind).toBe('status');
  });

  it('lets staff make a link by hand, and only staff', async () => {
    expect((await request(app).get('/api/admin/feedback-links')).status).toBe(401);
    const made = await agent.post('/api/admin/feedback-links').set('x-csrf-token', csrf).send({ customer_name: 'Mei' });
    expect(made.status).toBe(201);
    expect(made.body.url).toContain(`/feedback/${made.body.token}`);
    expect((await agent.get('/api/admin/feedback-links')).body[0].customer_name).toBe('Mei');
    expect((await request(app).get('/api/public/feedback/not-a-real-token')).status).toBe(404);
  });
});

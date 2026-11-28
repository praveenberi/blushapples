import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb, migrate, type Db } from '../src/db';
import { createApp } from '../src/app';
import { seed } from '../src/seed';
import { localNow } from '../src/lib/booking';
import { runReminders } from '../src/lib/reminders';

let db: Db;
let agent: ReturnType<typeof request.agent>;
let csrf: string;
let id: number;

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const alerts = async () => (await agent.get('/api/admin/bookings/alerts')).body;
const adminSoonMails = async () => (await db.q<any>(`SELECT count(*)::int AS n FROM notification_logs WHERE template_key='admin_booking_soon'`))[0].n;

beforeAll(async () => {
  db = await createDb({ memory: true });
  await migrate(db);
  await seed(db, { adminEmail: 'al@example.com', adminPassword: 'AlertPassw0rd!!', demoImages: false });
  const app = createApp(db);
  agent = request.agent(app);
  csrf = (await agent.post('/api/auth/login').send({ email: 'al@example.com', password: 'AlertPassw0rd!!' })).body.csrf;
  await db.q(`UPDATE website_settings SET value = value || '{"adminEmail":"studio@example.com"}'::jsonb WHERE key='notifications'`);
  await db.q('UPDATE business_hours SET closed=false, open_min=0, close_min=1440');
  const [c] = await db.q<any>(`INSERT INTO customers(name,email,phone) VALUES ('Lin','lin@example.com','91234567') RETURNING id`);
  const [b] = await db.q<any>(
    `INSERT INTO bookings(reference,customer_id,status,booking_date,start_min,end_min,block_end_min,source) VALUES ('BA-ALERT1',$1,'new',$2,600,660,675,'website') RETURNING id`, [c.id, day(20)]);
  id = b.id;
});
afterAll(async () => { await db.close(); });

describe('admin alerts', () => {
  it('shows a website request until it is opened', async () => {
    expect((await alerts()).newRequests.map((x: any) => x.reference)).toEqual(['BA-ALERT1']);
    await agent.get(`/api/admin/bookings/${id}`).expect(200);
    expect((await alerts()).newRequests).toEqual([]);
  });

  it('records a reschedule and offers a WhatsApp message for the new time', async () => {
    const to = day(25);
    const r = await agent.post(`/api/admin/bookings/${id}/reschedule`).set('x-csrf-token', csrf).send({ date: to, time: '14:00' });
    expect(r.status).toBe(200);
    expect(r.body.booking_date).toBe(to);
    expect(r.body.reschedule_history).toHaveLength(1);
    expect(r.body.reschedule_history[0]).toMatchObject({ from: `${day(20)} 10:00`, to: `${to} 14:00` });
    const detail = (await agent.get(`/api/admin/bookings/${id}`)).body;
    expect(decodeURIComponent(detail.whatsapp_links.rescheduled)).toContain(to);
    // the calendar asks by date range: the booking is found on its new day only
    expect((await agent.get(`/api/admin/bookings?from=${to}&to=${to}`)).body).toHaveLength(1);
    expect((await agent.get(`/api/admin/bookings?from=${day(20)}&to=${day(20)}`)).body).toHaveLength(0);
  });

  it('alerts the admin once when an appointment is within 24 hours', async () => {
    const [{ value: general }] = await db.q<any>(`SELECT value FROM website_settings WHERE key='general'`);
    const local = localNow(general.timezone || 'UTC');
    const tomorrow = new Date(Date.parse(`${local.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const start = Math.max(0, local.min - 60); // about 23 hours from now
    await db.q('UPDATE bookings SET booking_date=$1, start_min=$2, end_min=$2+60, admin_alerted_at=NULL, reminder_sent_at=NULL WHERE id=$3', [tomorrow, start, id]);

    const a = await alerts();
    expect(a.upcoming.map((x: any) => x.reference)).toEqual(['BA-ALERT1']);
    expect(a.upcoming[0].whatsappUrl).toContain('wa.me/');

    // an unconfirmed booking alerts the admin but does not remind the customer
    expect(await runReminders(db)).toBe(0);
    expect(await adminSoonMails()).toBe(1);
    await runReminders(db);
    expect(await adminSoonMails()).toBe(1);

    await db.q(`UPDATE bookings SET status='cancelled' WHERE id=$1`, [id]);
    expect((await alerts()).upcoming).toEqual([]);
  });
});

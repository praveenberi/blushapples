import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb, migrate, type Db } from '../src/db';
import { createApp } from '../src/app';
import { seed } from '../src/seed';
import { runReminders } from '../src/lib/reminders';
import { localNow } from '../src/lib/booking';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await createDb({ memory: true });
  await migrate(db);
  await seed(db, { adminPassword: 'Str0ngPassw0rd!', demoImages: false });
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>x</title><meta name="description" content="x" /></head><body><div id="root"></div></body></html>');
  app = createApp(db, { webDist: dist });
});
afterAll(async () => { await db.close(); });

describe('server-rendered SEO', () => {
  it('injects title, canonical, OG, JSON-LD and crawlable text per page', async () => {
    const res = await request(app).get('/services');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>Services | Blush &amp; Apples</title>');
    expect(res.text).toContain('rel="canonical"');
    expect(res.text).toContain('property="og:title"');
    expect(res.text).toContain('application/ld+json');
    expect(res.text).toContain('Signature Bridal Makeup');
    expect(res.text).not.toContain('<title>x</title>');
  });

  it('applies admin SEO edits, noindex for admin and 404 for unknown paths', async () => {
    await db.q(`UPDATE pages SET seo_title='Custom <Title>', robots='noindex,follow' WHERE slug='about'`);
    const about = await request(app).get('/about');
    expect(about.text).toContain('Custom &lt;Title&gt;');
    expect(about.text).toContain('content="noindex,follow"');
    expect((await request(app).get('/admin/bookings')).text).toContain('noindex,nofollow');
    expect((await request(app).get('/nope')).status).toBe(404);
  });
});

describe('appointment reminders', () => {
  async function booking(daysAhead: number, startMin: number, status = 'confirmed') {
    const now = localNow('America/New_York');
    const d = new Date(Date.parse(now.date + 'T00:00:00Z') + daysAhead * 86_400_000).toISOString().slice(0, 10);
    const [c] = await db.q<any>(`INSERT INTO customers(name,email) VALUES ('R','r${daysAhead}${startMin}@example.com') RETURNING id`);
    const [b] = await db.q<any>(`INSERT INTO bookings(reference,customer_id,status,booking_date,start_min,end_min,block_end_min) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [`T-${daysAhead}-${startMin}-${status}`, c.id, status, d, startMin, startMin + 60, startMin + 75]);
    return b.id as number;
  }

  it('reminds only confirmed bookings inside the window, and only once', async () => {
    await db.q(`INSERT INTO website_settings(key,value) VALUES ('notifications','{"reminderHoursBefore":72}'::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`);
    const soon = await booking(1, 23 * 60); // under 72h away: always inside the window
    const far = await booking(5, 600);
    const unconfirmed = await booking(1, 23 * 60 + 30, 'new');
    const first = await runReminders(db);
    const again = await runReminders(db);
    const sent = async (id: number) => (await db.q<any>('SELECT reminder_sent_at FROM bookings WHERE id=$1', [id]))[0].reminder_sent_at;
    expect(await sent(far)).toBeNull();
    expect(await sent(unconfirmed)).toBeNull();
    expect(await sent(soon)).not.toBeNull();
    expect(first).toBe(1);
    expect(again).toBe(0);
    const logs = await db.q<any>(`SELECT * FROM notification_logs WHERE template_key='booking_reminder'`);
    expect(logs).toHaveLength(1);
  });

  it('a booking starting in about an hour is always reminded', async () => {
    const now = localNow('America/New_York');
    const start = now.min + 60;
    if (start >= 1440) return; // too close to midnight to construct on the same day
    const id = await booking(0, start);
    expect(await runReminders(db)).toBe(1);
    expect((await db.q<any>('SELECT reminder_sent_at FROM bookings WHERE id=$1', [id]))[0].reminder_sent_at).not.toBeNull();
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb, migrate, type Db } from '../src/db';
import { createApp } from '../src/app';
import { seed } from '../src/seed';
import { resolveItems, UNTIMED_SERVICE_MIN } from '../src/lib/booking';

let db: Db;
beforeAll(async () => { db = await createDb({ memory: true }); await migrate(db); await seed(db, { adminEmail: 'z@example.com', adminPassword: 'ZeroPassw0rd!!', demoImages: false }); });
afterAll(async () => { await db.close(); });

describe('services without a published price or duration', () => {
  it('can be saved with 0, and bookings still reserve calendar time', async () => {
    const agent = request.agent(createApp(db));
    const csrf = (await agent.post('/api/auth/login').send({ email: 'z@example.com', password: 'ZeroPassw0rd!!' })).body.csrf;
    const [svc] = await db.q<any>('SELECT id FROM services WHERE available AND bookable ORDER BY id LIMIT 1');
    const res = await agent.put(`/api/admin/services/${svc.id}`).set('x-csrf-token', csrf).send({ price_cents: 0, duration_min: 0 });
    expect(res.status).toBe(200);
    expect(res.body.duration_min).toBe(0);
    expect((await resolveItems(db.q, [svc.id], [])).duration).toBe(UNTIMED_SERVICE_MIN);
  });
});

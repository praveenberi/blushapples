import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb, migrate, type Db } from '../src/db';
import { createApp } from '../src/app';
import { seed } from '../src/seed';

let db: Db;
beforeAll(async () => { db = await createDb({ memory: true }); await migrate(db); await seed(db, { adminEmail: 'first@example.com', adminPassword: 'FirstPassw0rd!!', demoImages: false }); });
afterAll(async () => { await db.close(); });

describe('admin recovery', () => {
  it('ignores new env values once an admin exists', async () => {
    await seed(db, { adminEmail: 'new@example.com', adminPassword: 'NewPassw0rd!!', demoImages: false });
    const app = createApp(db);
    expect((await request(app).post('/api/auth/login').send({ email: 'new@example.com', password: 'NewPassw0rd!!' })).status).toBe(401);
  });

  it('resets the admin email and password when resetAdmin is set, and the old login stops working', async () => {
    await seed(db, { adminEmail: 'AdminApple@blushapples.com', adminPassword: 'NewPassw0rd!!', resetAdmin: true, demoImages: false });
    const app = createApp(db);
    expect((await request(app).post('/api/auth/login').send({ email: 'adminapple@blushapples.com', password: 'NewPassw0rd!!' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: 'first@example.com', password: 'FirstPassw0rd!!' })).status).toBe(401);
    expect((await db.q<any>('SELECT count(*)::int AS n FROM users'))[0].n).toBe(1);
  });
});

describe('restore default sections', () => {
  it('adds only missing section types and never duplicates', async () => {
    const app = createApp(db);
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: 'adminapple@blushapples.com', password: 'NewPassw0rd!!' });
    const csrf = login.body.csrf;
    await db.q("DELETE FROM page_sections WHERE page='home' AND type<>'hero'");
    const first = await agent.post('/api/admin/sections/restore-defaults').set('x-csrf-token', csrf).send({ page: 'home' });
    expect(first.status).toBe(200);
    expect(first.body.added).toBe(8);
    const again = await agent.post('/api/admin/sections/restore-defaults').set('x-csrf-token', csrf).send({ page: 'home' });
    expect(again.body.added).toBe(0);
    expect((await db.q<any>("SELECT count(*)::int AS n FROM page_sections WHERE page='home' AND type='hero'"))[0].n).toBe(1);
  });
});

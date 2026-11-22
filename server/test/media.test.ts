import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createDb, migrate, type Db } from '../src/db';
import { createApp } from '../src/app';
import { seed } from '../src/seed';

let db: Db;
let agent: ReturnType<typeof request.agent>;
let csrf: string;

beforeAll(async () => {
  db = await createDb({ memory: true });
  await migrate(db);
  await seed(db, { adminEmail: 'm@example.com', adminPassword: 'MediaPassw0rd!!', demoImages: false });
  agent = request.agent(createApp(db));
  csrf = (await agent.post('/api/auth/login').send({ email: 'm@example.com', password: 'MediaPassw0rd!!' })).body.csrf;
});
afterAll(async () => { await db.close(); });

describe('media library', () => {
  it('lists uploaded assets, protects images in use, and deletes with confirmation', async () => {
    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#c9a96e' } }).png().toBuffer();
    const up = await agent.post('/api/admin/gallery/asset').set('x-csrf-token', csrf).attach('file', png, { filename: 'hero.png', contentType: 'image/png' });
    expect(up.status).toBe(201);

    let list = (await agent.get('/api/admin/gallery/media')).body;
    const item = list.find((m: any) => m.url === up.body.url);
    expect(item).toBeTruthy();
    expect(item.in_use).toBe(false);

    // put it on the home hero: now it is in use
    const [hero] = await db.q<any>(`SELECT id, content FROM page_sections WHERE type='hero' AND page='home'`);
    await agent.put(`/api/admin/sections/${hero.id}`).set('x-csrf-token', csrf).send({ content: { ...hero.content, images: [up.body.url] } }).expect(200);
    list = (await agent.get('/api/admin/gallery/media')).body;
    expect(list.find((m: any) => m.id === item.id).in_use).toBe(true);

    expect((await agent.delete(`/api/admin/gallery/media/${item.id}`).set('x-csrf-token', csrf)).status).toBe(409);
    expect((await request(agent.get('/').app).get(up.body.url)).status).toBe(200);
    expect((await agent.delete(`/api/admin/gallery/media/${item.id}?force=true`).set('x-csrf-token', csrf)).status).toBe(200);
    expect((await agent.get('/api/admin/gallery/media')).body.some((m: any) => m.id === item.id)).toBe(false);
  });

  it('requires a login and CSRF token', async () => {
    expect((await request(createApp(db)).get('/api/admin/gallery/media')).status).toBe(401);
    expect((await agent.delete('/api/admin/gallery/media/1')).status).toBe(403);
  });
});

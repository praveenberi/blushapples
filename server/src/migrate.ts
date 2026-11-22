import { createDb, migrate } from './db';

(async () => {
  const db = await createDb();
  const ran = await migrate(db);
  console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });

import { config } from './config';
import { createDb, migrate } from './db';
import { createApp } from './app';
import { seed } from './seed';
import { startReminderScheduler } from './lib/reminders';

(async () => {
  const db = await createDb();
  const ran = await migrate(db);
  if (ran.length) console.log(`Applied migrations: ${ran.join(', ')}`);
  const s = await seed(db);
  if (s.generatedPassword) console.log(`\n  Admin account created: ${config.seed.adminEmail}\n  Generated password (shown once): ${s.generatedPassword}\n`);
  startReminderScheduler(db);
  const app = createApp(db);
  app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port} (db: ${db.kind}, storage: ${config.storage.provider})`));
})().catch((e) => { console.error(e); process.exit(1); });

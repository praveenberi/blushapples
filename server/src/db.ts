import fs from 'fs';
import path from 'path';
import { config } from './config';

export type Q = <T = any>(sql: string, params?: any[]) => Promise<T[]>;

export interface Db {
  q: Q;
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'pg' | 'pglite';
}

/** Real Postgres when DATABASE_URL is set; embedded PGlite (also real Postgres) otherwise. */
export async function createDb(opts: { memory?: boolean } = {}): Promise<Db> {
  if (config.databaseUrl && !opts.memory) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
    return {
      kind: 'pg',
      q: async (sql, params) => (await pool.query(sql, params)).rows,
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = await fn(async (sql, params) => (await c.query(sql, params)).rows);
          await c.query('COMMIT');
          return r;
        } catch (e) {
          await c.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  let dir: string | undefined;
  if (!opts.memory) {
    fs.mkdirSync(path.dirname(config.pgliteDir), { recursive: true });
    dir = config.pgliteDir;
  }
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  return {
    kind: 'pglite',
    q: async (sql, params) => (await pg.query(sql, params)).rows as any[],
    tx: (fn) => pg.transaction((t) => fn(async (sql, params) => (await t.query(sql, params)).rows as any[])),
    close: () => pg.close(),
  };
}

export async function migrate(db: Db): Promise<string[]> {
  await db.q(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = path.resolve(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set((await db.q<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await db.tx(async (q) => {
      // PGlite's query() takes one statement; exec-style splitting is unsafe, so use multi-statement via simple protocol where available.
      await runScript(db, q, sql);
      await q('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
    });
    ran.push(f);
  }
  return ran;
}

async function runScript(db: Db, q: Q, sql: string) {
  // Statements in our migrations never contain semicolons inside strings/functions.
  const stmts = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
  for (const s of stmts) await q(s);
}

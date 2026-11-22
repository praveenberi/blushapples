import express, { type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import type { Db } from './db';
import { authRouter, loadUser } from './lib/auth';
import { HttpError } from './lib/http';
import { adminRouter } from './routes/admin';
import { adminBookingRouter, publicBookingRouter } from './routes/bookings';
import { galleryRouter } from './routes/gallery';
import { publicRouter, seoRouter } from './routes/public';
import { resourceRouter } from './routes/resources';
import { servicesRouter } from './routes/services';
import { renderPage } from './lib/seoRender';
import { ah } from './lib/http';
import crypto from 'crypto';
import { runReminders } from './lib/reminders';

export function createApp(db: Db, opts: { webDist?: string } = {}) {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: config.isProd,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:', 'https:'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'], scriptSrc: ["'self'", 'https://www.googletagmanager.com'], frameSrc: ["'self'", 'https://www.google.com', 'https://www.youtube.com', 'https://www.tiktok.com', 'https://www.instagram.com'],
        upgradeInsecureRequests: config.isProd ? [] : null, connectSrc: ["'self'", 'https://www.google-analytics.com', 'https://*.google-analytics.com'], mediaSrc: ["'self'", 'https:'],
      },
    },
  }));
  if (!config.isProd) app.use(cors({ origin: config.publicUrl, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use(loadUser);

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', immutable: true, fallthrough: false, setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }));
  // Called by the Cloudflare cron trigger (containers can sleep, so the in-process timer is not enough).
  app.post('/api/internal/reminders', ah(async (req, res) => {
    const given = Buffer.from(String(req.header('x-cron-secret') || '')), want = Buffer.from(config.cronSecret);
    if (!want.length || given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw new HttpError(403, 'Forbidden');
    res.json({ sent: await runReminders(db) });
  }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter());
  app.use('/api/public', publicRouter(), publicBookingRouter());
  app.use('/api/admin/bookings', adminBookingRouter());
  app.use('/api/admin/services', servicesRouter());
  app.use('/api/admin/gallery', galleryRouter());
  app.use('/api/admin', resourceRouter());
  app.use('/api/admin', adminRouter());
  app.use(seoRouter());

  // Production: serve the built SPA.
  const dist = opts.webDist || path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    const template = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    app.get(/^(?!\/(api|uploads)\/).*/, ah(async (req, res) => {
      const out = await renderPage(db, template, req.path);
      res.status(out.status).type('html').set('Cache-Control', 'no-cache').send(out.html);
    }));
  }

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, details: err.details });
    if (err?.name === 'MulterError') return void res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (15MB max)' : err.message });
    if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Invalid JSON' });
    if (err?.status === 404) return void res.status(404).json({ error: 'Not found' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  };
  app.use(onError);
  return app;
}

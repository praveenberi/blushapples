import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { ah, audit, HttpError, parse, type AuthUser } from './http';
import { notify } from './notify';

const COOKIE = 'ba_session';
const CSRF = 'ba_csrf';
const SESSION_HOURS = 12;
// Pre-computed hash so login timing does not reveal whether an email exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const cookieOpts = { sameSite: 'lax' as const, secure: config.isProd, path: '/' };

export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);
export const passwordSchema = z.string().min(10, 'Password must be at least 10 characters').max(200)
  .refine((p) => /[a-z]/i.test(p) && /\d/.test(p), 'Password needs letters and numbers');

function setSession(res: any, userId: number) {
  const token = jwt.sign({ uid: userId }, config.jwtSecret, { expiresIn: `${SESSION_HOURS}h` });
  const csrf = crypto.randomBytes(24).toString('hex');
  res.cookie(COOKIE, token, { ...cookieOpts, httpOnly: true, maxAge: SESSION_HOURS * 3600_000 });
  res.cookie(CSRF, csrf, { ...cookieOpts, httpOnly: false, maxAge: SESSION_HOURS * 3600_000 });
  return csrf;
}

/** Loads the user fresh from the DB each request so deactivation/role changes apply immediately. */
export const loadUser: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) return next();
    const payload = jwt.verify(token, config.jwtSecret) as unknown as { uid: number };
    const [u] = await req.db.q<any>(
      `SELECT u.id,u.email,u.name,r.name AS role,r.permissions FROM users u JOIN roles r ON r.id=u.role_id
       WHERE u.id=$1 AND u.active AND u.deleted_at IS NULL`, [payload.uid]);
    if (u) req.user = { id: u.id, email: u.email, name: u.name, role: u.role, permissions: u.permissions };
  } catch { /* invalid/expired token -> unauthenticated */ }
  next();
};

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Server-side permission gate. Also enforces CSRF (double-submit cookie) on state-changing requests. */
export const requirePerm = (perm?: string): RequestHandler => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  if (!SAFE.has(req.method)) {
    const c = req.cookies?.[CSRF], h = req.header('x-csrf-token');
    if (!c || !h || c.length !== h.length || !crypto.timingSafeEqual(Buffer.from(c), Buffer.from(h))) {
      return next(new HttpError(403, 'Invalid CSRF token'));
    }
  }
  if (perm && !req.user.permissions.includes('*') && !req.user.permissions.includes(perm)) {
    return next(new HttpError(403, 'You do not have permission to do that'));
  }
  next();
};

export function authRouter() {
  const r = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: config.isTest ? 1000 : 10, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many attempts. Try again later.' },
  });

  r.post('/login', loginLimiter, ah(async (req, res) => {
    const { email, password } = parse(z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }), req.body);
    const [u] = await req.db.q<any>(
      `SELECT u.*, r.name AS role, r.permissions FROM users u JOIN roles r ON r.id=u.role_id
       WHERE lower(u.email)=lower($1) AND u.deleted_at IS NULL`, [email]);
    const ok = await bcrypt.compare(password, u?.password_hash || DUMMY_HASH);
    if (!u || !ok || !u.active) {
      await audit(req, 'login_failed', 'user', undefined, { email });
      throw new HttpError(401, 'Invalid email or password');
    }
    await req.db.q('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
    const csrf = setSession(res, u.id);
    req.user = { id: u.id, email: u.email, name: u.name, role: u.role, permissions: u.permissions };
    await audit(req, 'login', 'user', u.id);
    res.json({ user: req.user, csrf });
  }));

  r.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE, cookieOpts).clearCookie(CSRF, cookieOpts).json({ ok: true });
  });

  r.get('/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: req.user, csrf: setSession(res, req.user.id) });
  });

  const resetLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.isTest ? 1000 : 5, standardHeaders: true, legacyHeaders: false });

  r.post('/forgot', resetLimiter, ah(async (req, res) => {
    const { email } = parse(z.object({ email: z.string().email() }), req.body);
    const [u] = await req.db.q<any>('SELECT id,name,email FROM users WHERE lower(email)=lower($1) AND active AND deleted_at IS NULL', [email]);
    if (u) {
      const token = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      await req.db.q(`UPDATE users SET reset_token_hash=$1, reset_expires=now()+interval '1 hour' WHERE id=$2`, [hash, u.id]);
      const link = `${config.publicUrl}/admin/reset?token=${token}`;
      await notify(req.db, 'admin_password_reset', u.email, { name: u.name, link });
      if (!config.isProd && !config.smtp.host) console.log(`[dev] password reset link for ${u.email}: ${link}`);
    }
    res.json({ ok: true }); // same response either way: no account enumeration
  }));

  r.post('/reset', resetLimiter, ah(async (req, res) => {
    const { token, password } = parse(z.object({ token: z.string().min(20), password: passwordSchema }), req.body);
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const [u] = await req.db.q<any>('SELECT id FROM users WHERE reset_token_hash=$1 AND reset_expires>now() AND deleted_at IS NULL', [hash]);
    if (!u) throw new HttpError(400, 'Reset link is invalid or has expired');
    await req.db.q('UPDATE users SET password_hash=$1, reset_token_hash=NULL, reset_expires=NULL, updated_at=now() WHERE id=$2', [await hashPassword(password), u.id]);
    res.json({ ok: true });
  }));

  r.post('/change-password', requirePerm(), ah(async (req, res) => {
    const { current, password } = parse(z.object({ current: z.string(), password: passwordSchema }), req.body);
    const [u] = await req.db.q<any>('SELECT password_hash FROM users WHERE id=$1', [req.user!.id]);
    if (!(await bcrypt.compare(current, u.password_hash))) throw new HttpError(400, 'Current password is incorrect');
    await req.db.q('UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2', [await hashPassword(password), req.user!.id]);
    await audit(req, 'password_changed', 'user', req.user!.id);
    res.json({ ok: true });
  }));

  return r;
}

export type { AuthUser };

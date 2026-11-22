import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, ZodTypeAny } from 'zod';
import type { Db } from '../db';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export interface AuthUser { id: number; email: string; name: string; role: string; permissions: string[] }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: AuthUser; db: Db }
  }
}

/** Wrap async handlers so rejections reach the error middleware. */
export const ah = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export const parse = <T extends ZodTypeAny>(schema: T, data: unknown): ReturnType<T['parse']> => {
  try {
    return schema.parse(data);
  } catch (e) {
    if (e instanceof ZodError) throw new HttpError(400, 'Validation failed', e.flatten().fieldErrors);
    throw e;
  }
};

export const audit = (req: Request, action: string, entity: string, entityId?: string | number, detail: object = {}) =>
  req.db.q('INSERT INTO audit_logs(user_id,user_email,action,entity,entity_id,detail) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [
    req.user?.id ?? null, req.user?.email ?? null, action, entity, entityId == null ? null : String(entityId), JSON.stringify(detail),
  ]).catch(() => {});

export const toInt = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);

export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

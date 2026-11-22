import { Router } from 'express';
import { z, ZodObject, ZodRawShape } from 'zod';
import { ah, audit, HttpError, parse } from './http';
import { requirePerm } from './auth';

type ColType = 'text' | 'int' | 'bool' | 'json';
export interface CrudSpec {
  table: string;
  perm: string;
  cols: Record<string, ColType>;
  schema: ZodObject<ZodRawShape>;
  order?: string;
  /** table has updated_at to bump */
  touch?: boolean;
  /** use deleted_at soft delete */
  soft?: boolean;
  /** columns that may be used as ?column=value list filters */
  filters?: string[];
  /** extra SELECT columns, e.g. joined names */
  select?: string;
  from?: string;
}

/** Generic validated CRUD router. Column names come from the spec (never user input), values are always parameterised. */
export function crudRouter(spec: CrudSpec) {
  const r = Router();
  const { table, cols } = spec;
  const hasSort = 'sort_order' in cols;
  const order = spec.order || (hasSort ? 'sort_order, id' : 'id');
  const notDeleted = spec.soft ? 'AND t.deleted_at IS NULL' : '';
  const base = `SELECT t.*${spec.select ? ', ' + spec.select : ''} FROM ${table} t ${spec.from || ''}`;
  const guard = requirePerm(spec.perm);

  const bind = (data: Record<string, unknown>) => {
    const keys = Object.keys(data).filter((k) => k in cols && data[k] !== undefined);
    const values = keys.map((k) => (cols[k] === 'json' ? JSON.stringify(data[k]) : data[k]));
    const ph = keys.map((k, i) => `$${i + 1}${cols[k] === 'json' ? '::jsonb' : ''}`);
    return { keys, values, ph };
  };

  r.get('/', guard, ah(async (req, res) => {
    const where: string[] = [], p: any[] = [];
    for (const f of spec.filters || []) if (typeof req.query[f] === 'string') { p.push(req.query[f]); where.push(`t.${f}=${p.length}`); }
    res.json(await req.db.q(`${base} WHERE 1=1 ${notDeleted} ${where.map((w) => 'AND ' + w).join(' ')} ORDER BY ${order}`, p));
  }));

  r.get('/:id', guard, ah(async (req, res) => {
    const [row] = await req.db.q(`${base} WHERE t.id=$1 ${notDeleted}`, [Number(req.params.id)]);
    if (!row) throw new HttpError(404, 'Not found');
    res.json(row);
  }));

  r.post('/', guard, ah(async (req, res) => {
    const data = parse(spec.schema, req.body) as Record<string, unknown>;
    if (hasSort && data.sort_order === undefined) {
      const [m] = await req.db.q<{ n: number }>(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM ${table}`);
      data.sort_order = m.n;
    }
    const { keys, values, ph } = bind(data);
    const [row] = await req.db.q<any>(`INSERT INTO ${table}(${keys.join(',')}) VALUES (${ph.join(',')}) RETURNING id`, values);
    await audit(req, 'create', table, row.id);
    const [out] = await req.db.q(`${base} WHERE t.id=$1`, [row.id]);
    res.status(201).json(out);
  }));

  r.put('/:id', guard, ah(async (req, res) => {
    const id = Number(req.params.id);
    const data = parse(spec.schema.partial(), req.body) as Record<string, unknown>;
    const { keys, values, ph } = bind(data);
    if (!keys.length) throw new HttpError(400, 'Nothing to update');
    const set = keys.map((k, i) => `${k}=${ph[i]}`).join(',');
    const touched = spec.touch ? ', updated_at=now()' : '';
    const rows = await req.db.q(`UPDATE ${table} SET ${set}${touched} WHERE id=$${keys.length + 1} ${spec.soft ? 'AND deleted_at IS NULL' : ''} RETURNING id`, [...values, id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    await audit(req, 'update', table, id);
    const [out] = await req.db.q(`${base} WHERE t.id=$1`, [id]);
    res.json(out);
  }));

  r.delete('/:id', guard, ah(async (req, res) => {
    const id = Number(req.params.id);
    const rows = spec.soft
      ? await req.db.q(`UPDATE ${table} SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id])
      : await req.db.q(`DELETE FROM ${table} WHERE id=$1 RETURNING id`, [id]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    await audit(req, 'delete', table, id);
    res.json({ ok: true });
  }));

  if (hasSort) {
    r.post('/reorder', guard, ah(async (req, res) => {
      const { ids } = parse(z.object({ ids: z.array(z.number().int()).max(1000) }), req.body);
      await req.db.tx(async (q) => { for (let i = 0; i < ids.length; i++) await q(`UPDATE ${table} SET sort_order=$1 WHERE id=$2`, [i + 1, ids[i]]); });
      await audit(req, 'reorder', table);
      res.json({ ok: true });
    }));
  }
  return r;
}

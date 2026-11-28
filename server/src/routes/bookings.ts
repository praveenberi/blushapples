import { Router } from 'express';
import { z } from 'zod';
import { ah, audit, hhmm, HttpError, parse, toMin } from '../lib/http';
import { requirePerm } from '../lib/auth';
import { bookingSchema, bookingSettings, computeSlots, createBooking, resolveItems, setting } from '../lib/booking';
import { notify, whatsappAdmin } from '../lib/notify';
import { bookingVars, messageCustomer, whatsappLink } from '../lib/customerMessages';
import { adminAlerts } from '../lib/reminders';
import type { Db } from '../db';

export const STATUSES = ['new', 'pending_confirmation', 'confirmed', 'deposit_requested', 'deposit_paid', 'in_progress', 'completed', 'cancelled', 'rejected'] as const;

const SELECT = `SELECT b.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, c.whatsapp AS customer_whatsapp,
  (SELECT string_agg(name, ', ' ORDER BY id) FROM booking_services WHERE booking_id=b.id) AS service_names
  FROM bookings b LEFT JOIN customers c ON c.id=b.customer_id`;

export async function bookingDetail(db: Db, id: number) {
  const [b] = await db.q<any>(`${SELECT} WHERE b.id=$1 AND b.deleted_at IS NULL`, [id]);
  if (!b) return null;
  b.services = await db.q('SELECT * FROM booking_services WHERE booking_id=$1 ORDER BY id', [id]);
  b.addons = await db.q('SELECT * FROM booking_addons WHERE booking_id=$1 ORDER BY id', [id]);
  return b;
}

export async function adminEmail(db: Db) {
  const n = await setting<any>(db.q, 'notifications', {});
  const c = await setting<any>(db.q, 'contact', {});
  return n.adminEmail || c.email || '';
}

export async function notifyBooking(db: Db, event: string, b: any) {
  const vars = await bookingVars(db, b);
  const admin = await adminEmail(db);
  if (event === 'received') {
    await notify(db, 'booking_received', b.customer_email, vars);
    await notify(db, 'admin_new_booking', admin, vars);
    await whatsappAdmin(db, `New booking ${vars.reference}: ${vars.services} on ${vars.date} ${vars.time} - ${vars.name}`);
  } else if (event === 'confirmed') await notify(db, 'booking_confirmed', b.customer_email, vars);
  else if (event === 'reminder') await notify(db, 'booking_reminder', b.customer_email, vars);
  else if (event === 'rescheduled') await notify(db, 'booking_rescheduled', b.customer_email, vars);
  else if (event === 'cancelled') {
    await notify(db, 'booking_cancelled', b.customer_email, vars);
    await notify(db, 'admin_booking_cancelled', admin, vars);
    await whatsappAdmin(db, `Booking ${vars.reference} cancelled (${vars.name}, ${vars.date})`);
  }
}

export function publicBookingRouter() {
  const r = Router();

  r.get('/availability', ah(async (req, res) => {
    const q = parse(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      serviceIds: z.string().regex(/^\d+(,\d+)*$/), addonIds: z.string().regex(/^(\d+(,\d+)*)?$/).optional(),
      location: z.enum(['studio', 'client_home', 'hotel', 'event_venue', 'other']).default('studio'),
    }), req.query);
    const { duration } = await resolveItems(req.db.q, q.serviceIds.split(',').map(Number), q.addonIds ? q.addonIds.split(',').map(Number) : []);
    const slots = await computeSlots(req.db.q, { date: q.date, durationMin: duration, locationType: q.location });
    res.json({ date: q.date, durationMin: duration, slots: slots.map(({ start, end }) => ({ start, end })) });
  }));

  /** Dates in a month that have at least one free slot, for the date picker. */
  r.get('/availability/month', ah(async (req, res) => {
    const q = parse(z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/), serviceIds: z.string().regex(/^\d+(,\d+)*$/),
      location: z.enum(['studio', 'client_home', 'hotel', 'event_venue', 'other']).default('studio'),
    }), req.query);
    const { duration } = await resolveItems(req.db.q, q.serviceIds.split(',').map(Number), []);
    const [y, m] = q.month.split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const available: string[] = [];
    for (let d = 1; d <= days; d++) {
      const date = `${q.month}-${String(d).padStart(2, '0')}`;
      if ((await computeSlots(req.db.q, { date, durationMin: duration, locationType: q.location })).length) available.push(date);
    }
    res.json({ month: q.month, available });
  }));

  r.post('/bookings', ah(async (req, res) => {
    const input = parse(bookingSchema, req.body);
    if (input.website) return void res.status(201).json({ reference: 'BA-RECEIVED' }); // honeypot: pretend success
    const out = await createBooking(req.db.tx.bind(req.db), input);
    const detail = await bookingDetail(req.db, out.booking.id);
    void notifyBooking(req.db, 'received', detail);
    res.status(201).json({
      reference: out.booking.reference, status: out.booking.status, date: out.booking.booking_date, time: hhmm(out.booking.start_min),
      total_cents: out.booking.total_cents, discount_cents: out.discount, services: out.services.map((s: any) => s.name),
    });
  }));

  return r;
}

const money = z.number().int().min(0).max(100_000_000);

export function adminBookingRouter() {
  const r = Router();
  const g = requirePerm('bookings');

  r.get('/', g, ah(async (req, res) => {
    const { status, q, from, to } = req.query as Record<string, string | undefined>;
    const where = ['b.deleted_at IS NULL'], p: any[] = [];
    if (status) { p.push(status); where.push(`b.status=$${p.length}`); }
    if (from) { p.push(from); where.push(`b.booking_date>=$${p.length}`); }
    if (to) { p.push(to); where.push(`b.booking_date<=$${p.length}`); }
    if (q) { p.push(`%${q.toLowerCase()}%`); where.push(`(lower(c.name) LIKE $${p.length} OR lower(b.reference) LIKE $${p.length} OR lower(c.email) LIKE $${p.length} OR c.phone LIKE $${p.length})`); }
    res.json(await req.db.q(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY b.booking_date DESC, b.start_min DESC LIMIT 1000`, p));
  }));

  r.get('/slots', g, ah(async (req, res) => {
    const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), duration: z.coerce.number().int().min(5).max(1440), location: z.string().default('studio'), exclude: z.coerce.number().int().optional() }), req.query);
    res.json(await computeSlots(req.db.q, { date: q.date, durationMin: q.duration, locationType: q.location, excludeBookingId: q.exclude, admin: true }));
  }));

  r.get('/alerts', g, ah(async (req, res) => res.json(await adminAlerts(req.db))));

  r.post('/alerts/seen', g, ah(async (req, res) => {
    await req.db.q('UPDATE bookings SET admin_seen_at=now() WHERE admin_seen_at IS NULL');
    res.json({ ok: true });
  }));

  r.get('/:id', g, ah(async (req, res) => {
    const id = Number(req.params.id);
    const b = await bookingDetail(req.db, id);
    if (!b) throw new HttpError(404, 'Not found');
    await req.db.q('UPDATE bookings SET admin_seen_at=now() WHERE id=$1 AND admin_seen_at IS NULL', [id]);
    // always available, so a message can still be sent after the notice has been closed
    b.whatsapp_links = { rescheduled: await whatsappLink(req.db, b, 'booking_rescheduled'), reminder: await whatsappLink(req.db, b, 'booking_reminder') };
    res.json(b);
  }));

  /** Manual booking by the artist (phone/WhatsApp clients). Bypasses lead time/hours but never double-books. */
  r.post('/', g, ah(async (req, res) => {
    const input = parse(bookingSchema.extend({ status: z.enum(STATUSES).optional(), sendNotifications: z.boolean().optional() }), req.body);
    const out = await createBooking(req.db.tx.bind(req.db), input, { admin: true, status: input.status || 'confirmed', source: 'admin' });
    await audit(req, 'create', 'bookings', out.booking.id);
    const detail = await bookingDetail(req.db, out.booking.id);
    if (input.sendNotifications) void notifyBooking(req.db, 'confirmed', detail);
    res.status(201).json(detail);
  }));

  r.put('/:id', g, ah(async (req, res) => {
    const id = Number(req.params.id);
    const d = parse(z.object({
      status: z.enum(STATUSES).optional(), internal_notes: z.string().max(5000).optional(), assigned_to: z.string().max(120).optional(),
      total_cents: money.optional(), deposit_cents: money.optional(), balance_paid_cents: money.optional(), venue: z.string().max(500).optional(),
      notify: z.boolean().optional(),
    }), req.body) as Record<string, any>;
    const { notify: wantsNotify = true, ...changes } = d;
    const [cur] = await req.db.q<any>('SELECT status, total_cents, deposit_cents, balance_paid_cents FROM bookings WHERE id=$1 AND deleted_at IS NULL', [id]);
    if (!cur) throw new HttpError(404, 'Not found');
    if (['total_cents', 'deposit_cents', 'balance_paid_cents'].some((k) => changes[k] !== undefined)) {
      const next = { ...cur, ...changes };
      if (next.deposit_cents + next.balance_paid_cents > next.total_cents) throw new HttpError(400, 'Payments received cannot be more than the total amount. Update the total first.');
    }
    const sets: string[] = [], vals: any[] = [];
    for (const [k, v] of Object.entries(changes)) if (v !== undefined) { vals.push(v); sets.push(`${k}=$${vals.length}`); }
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    await req.db.q(`UPDATE bookings SET ${sets.join(',')}, updated_at=now() WHERE id=$${vals.length + 1}`, [...vals, id]);
    await audit(req, 'update', 'bookings', id, changes);
    const b = await bookingDetail(req.db, id);
    let messages = null;
    if (changes.status && changes.status !== cur.status) {
      if (changes.status === 'cancelled') {
        const vars = await bookingVars(req.db, b);
        void notify(req.db, 'admin_booking_cancelled', await adminEmail(req.db), vars);
        void whatsappAdmin(req.db, `Booking ${vars.reference} cancelled (${vars.name}, ${vars.date})`);
      }
      if (wantsNotify) messages = await messageCustomer(req.db, b, changes.status);
    }
    res.json({ ...b, messages });
  }));

  r.post('/:id/reschedule', g, ah(async (req, res) => {
    const id = Number(req.params.id);
    const d = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }), req.body);
    await req.db.tx(async (q) => {
      await q('LOCK TABLE bookings IN SHARE ROW EXCLUSIVE MODE');
      const [b] = await q<any>('SELECT * FROM bookings WHERE id=$1 AND deleted_at IS NULL', [id]);
      if (!b) throw new HttpError(404, 'Not found');
      const duration = b.end_min - b.start_min;
      const slots = await computeSlots(q, { date: d.date, durationMin: duration, locationType: b.location_type, excludeBookingId: id, admin: true });
      const start = toMin(d.time);
      if (!slots.some((s) => s.startMin === start)) throw new HttpError(409, 'That time overlaps another booking or is outside working hours');
      const block = b.block_end_min - b.start_min;
      const change = [{ from: `${b.booking_date} ${hhmm(b.start_min)}`, to: `${d.date} ${d.time}`, at: new Date().toISOString() }];
      await q(`UPDATE bookings SET booking_date=$1, start_min=$2, end_min=$3, block_end_min=$4, reminder_sent_at=NULL, admin_alerted_at=NULL,
        reschedule_history = reschedule_history || $6::jsonb, updated_at=now() WHERE id=$5`, [d.date, start, start + duration, start + block, id, JSON.stringify(change)]);
    });
    await audit(req, 'reschedule', 'bookings', id, d);
    const b = await bookingDetail(req.db, id);
    res.json({ ...b, messages: await messageCustomer(req.db, b, 'rescheduled') });
  }));

  /** Replace the services/add-ons of a booking, recalculating total and duration (no overlap allowed). */
  r.put('/:id/items', g, ah(async (req, res) => {
    const id = Number(req.params.id);
    const d = parse(z.object({ serviceIds: z.array(z.number().int()).min(1).max(10), addonIds: z.array(z.number().int()).max(30).default([]) }), req.body);
    await req.db.tx(async (q) => {
      await q('LOCK TABLE bookings IN SHARE ROW EXCLUSIVE MODE');
      const [b] = await q<any>('SELECT * FROM bookings WHERE id=$1 AND deleted_at IS NULL', [id]);
      if (!b) throw new HttpError(404, 'Not found');
      const { services, addons, duration, subtotal } = await resolveItems(q, d.serviceIds, d.addonIds);
      const bs = await bookingSettings(q);
      const block = duration + bs.bufferMin + (b.location_type === 'studio' ? 0 : bs.travelBufferMin);
      const slots = await computeSlots(q, { date: b.booking_date, durationMin: duration, locationType: b.location_type, excludeBookingId: id, admin: true });
      if (!slots.some((s) => s.startMin === b.start_min)) throw new HttpError(409, 'The longer appointment would overlap another booking');
      await q('DELETE FROM booking_services WHERE booking_id=$1', [id]);
      await q('DELETE FROM booking_addons WHERE booking_id=$1', [id]);
      for (const s of services) await q('INSERT INTO booking_services(booking_id,service_id,name,price_cents,duration_min) VALUES ($1,$2,$3,$4,$5)', [id, s.id, s.name, s.price_cents, s.duration_min]);
      for (const a of addons) await q('INSERT INTO booking_addons(booking_id,addon_id,name,price_cents,duration_min) VALUES ($1,$2,$3,$4,$5)', [id, a.id, a.name, a.price_cents, a.duration_min]);
      await q('UPDATE bookings SET total_cents=$1, end_min=$2, block_end_min=$3, updated_at=now() WHERE id=$4', [subtotal || b.total_cents, b.start_min + duration, b.start_min + block, id]);
    });
    await audit(req, 'update_items', 'bookings', id, d);
    res.json(await bookingDetail(req.db, id));
  }));

  r.delete('/:id', g, ah(async (req, res) => {
    const rows = await req.db.q('UPDATE bookings SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id', [Number(req.params.id)]);
    if (!rows.length) throw new HttpError(404, 'Not found');
    await audit(req, 'delete', 'bookings', req.params.id);
    res.json({ ok: true });
  }));

  return r;
}

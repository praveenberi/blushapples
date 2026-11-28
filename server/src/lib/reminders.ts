import type { Db } from '../db';
import { localNow, setting } from './booking';
import { adminEmail, bookingDetail, notifyBooking } from '../routes/bookings';
import { bookingVars, defaultCountryCode, STATUS_LABELS, waNumber, whatsappLink } from './customerMessages';
import { notify, whatsappAdmin, whatsappCustomer } from './notify';
import { config } from '../config';

const dayIndex = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, dd) / 86_400_000); };

const OVER = ['cancelled', 'rejected', 'completed'];

async function alertWindow(db: Db) {
  const tz = (await setting<any>(db.q, 'general', {})).timezone || 'UTC';
  const hours = Number((await setting<any>(db.q, 'notifications', {})).reminderHoursBefore ?? 24);
  const now = localNow(tz);
  return { hours, now, nowAbs: dayIndex(now.date) * 1440 + now.min };
}

/** Bookings starting within the next `hours`, soonest first. */
async function startingWithin(db: Db, hours: number, w: Awaited<ReturnType<typeof alertWindow>>) {
  const last = new Date((dayIndex(w.now.date) + Math.ceil(hours / 24) + 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.q<any>(
    'SELECT id, status, booking_date, start_min, reminder_sent_at, admin_alerted_at FROM bookings WHERE deleted_at IS NULL AND booking_date >= $1 AND booking_date <= $2 ORDER BY booking_date, start_min', [w.now.date, last]);
  return rows
    .map((r) => ({ ...r, until: dayIndex(r.booking_date) * 1440 + r.start_min - w.nowAbs }))
    .filter((r) => !OVER.includes(r.status) && r.until >= 0 && r.until <= hours * 60);
}

/** What the admin's alert bell shows: unopened website requests, and appointments coming up soon. */
export async function adminAlerts(db: Db) {
  const w = await alertWindow(db);
  const hours = w.hours > 0 ? w.hours : 24;
  const newRequests = await db.q<any>(
    `SELECT b.id, b.reference, b.booking_date, b.start_min, b.created_at, c.name AS customer_name,
       (SELECT string_agg(name, ', ' ORDER BY id) FROM booking_services WHERE booking_id=b.id) AS service_names
     FROM bookings b LEFT JOIN customers c ON c.id=b.customer_id
     WHERE b.deleted_at IS NULL AND b.source='website' AND b.admin_seen_at IS NULL AND b.status NOT IN ('cancelled','rejected','completed')
     ORDER BY b.id DESC LIMIT 30`);
  const upcoming = [];
  for (const r of await startingWithin(db, hours, w)) {
    const b = await bookingDetail(db, r.id);
    upcoming.push({
      id: b.id, reference: b.reference, booking_date: b.booking_date, start_min: b.start_min, status: b.status,
      customer_name: b.customer_name, service_names: b.service_names, whatsappUrl: await whatsappLink(db, b, 'booking_reminder'),
    });
  }
  return { hours, newRequests, upcoming };
}

/** Sends one reminder per upcoming confirmed booking once it is within `reminderHoursBefore`. Safe to run repeatedly. */
export async function runReminders(db: Db): Promise<number> {
  const w = await alertWindow(db);
  if (!w.hours || w.hours < 0) return 0;
  let sent = 0;
  for (const r of await startingWithin(db, w.hours, w)) {
    // each claim happens first, so overlapping runs or restarts can never send twice
    if (!r.admin_alerted_at && (await db.q('UPDATE bookings SET admin_alerted_at=now() WHERE id=$1 AND admin_alerted_at IS NULL RETURNING id', [r.id])).length) {
      const b = await bookingDetail(db, r.id);
      const vars = { ...(await bookingVars(db, b)), status_label: STATUS_LABELS[b.status] || b.status };
      await notify(db, 'admin_booking_soon', await adminEmail(db), vars);
      await whatsappAdmin(db, `Coming up: ${vars.name}, ${vars.services} on ${vars.date} at ${vars.time}`);
    }
    // customers are only reminded about bookings that are actually going ahead
    if (r.reminder_sent_at || !['confirmed', 'deposit_requested', 'deposit_paid'].includes(r.status)) continue;
    const claimed = await db.q('UPDATE bookings SET reminder_sent_at=now() WHERE id=$1 AND reminder_sent_at IS NULL RETURNING id', [r.id]);
    if (!claimed.length) continue;
    const b = await bookingDetail(db, r.id);
    await notifyBooking(db, 'reminder', b);
    const to = waNumber(b.customer_whatsapp || b.customer_phone || '', await defaultCountryCode(db));
    if (to) {
      const vars = await bookingVars(db, b);
      await whatsappCustomer(db, 'booking_reminder', to, config.whatsapp.updateTemplate, [vars.name, vars.reference, 'Reminder', `${vars.date} at ${vars.time}`]);
    }
    sent++;
  }
  return sent;
}

export function startReminderScheduler(db: Db, everyMs = 10 * 60_000) {
  const tick = () => runReminders(db).catch((e) => console.error('reminder run failed', e));
  setTimeout(tick, 15_000);
  return setInterval(tick, everyMs);
}

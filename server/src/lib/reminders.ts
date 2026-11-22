import type { Db } from '../db';
import { localNow, setting } from './booking';
import { bookingDetail, notifyBooking } from '../routes/bookings';

const dayIndex = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, dd) / 86_400_000); };

/** Sends one reminder per upcoming confirmed booking once it is within `reminderHoursBefore`. Safe to run repeatedly. */
export async function runReminders(db: Db): Promise<number> {
  const tz = (await setting<any>(db.q, 'general', {})).timezone || 'UTC';
  const hours = Number((await setting<any>(db.q, 'notifications', {})).reminderHoursBefore ?? 24);
  if (!hours || hours < 0) return 0;
  const now = localNow(tz);
  const nowAbs = dayIndex(now.date) * 1440 + now.min;
  const last = new Date((dayIndex(now.date) + Math.ceil(hours / 24) + 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.q<any>(
    `SELECT id, booking_date, start_min FROM bookings WHERE deleted_at IS NULL AND reminder_sent_at IS NULL
     AND status IN ('confirmed','deposit_requested','deposit_paid') AND booking_date >= $1 AND booking_date <= $2`, [now.date, last]);
  let sent = 0;
  for (const r of rows) {
    const until = dayIndex(r.booking_date) * 1440 + r.start_min - nowAbs;
    if (until < 0 || until > hours * 60) continue;
    // claim first so overlapping runs or restarts can never send twice
    const claimed = await db.q('UPDATE bookings SET reminder_sent_at=now() WHERE id=$1 AND reminder_sent_at IS NULL RETURNING id', [r.id]);
    if (!claimed.length) continue;
    await notifyBooking(db, 'reminder', await bookingDetail(db, r.id));
    sent++;
  }
  return sent;
}

export function startReminderScheduler(db: Db, everyMs = 10 * 60_000) {
  const tick = () => runReminders(db).catch((e) => console.error('reminder run failed', e));
  setTimeout(tick, 15_000);
  return setInterval(tick, everyMs);
}

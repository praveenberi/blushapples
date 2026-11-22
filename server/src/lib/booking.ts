import crypto from 'crypto';
import { z } from 'zod';
import type { Q } from '../db';
import { HttpError, hhmm, toMin } from './http';

export const BOOKING_DEFAULTS = {
  slotIntervalMin: 30, bufferMin: 15, travelBufferMin: 45, leadTimeHours: 24, maxAdvanceDays: 365, depositPercent: 30, autoConfirm: false,
};
export const ACTIVE_STATUS = `('cancelled','rejected')`; // statuses that free the slot

export async function setting<T = any>(q: Q, key: string, fallback: T): Promise<T> {
  const [r] = await q<{ value: T }>('SELECT value FROM website_settings WHERE key=$1', [key]);
  return (r?.value ?? fallback) as T;
}

export const bookingSettings = async (q: Q) => ({ ...BOOKING_DEFAULTS, ...(await setting(q, 'booking', {})) });

const dayIndex = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, dd) / 86_400_000); };
export const weekday = (d: string) => new Date(dayIndex(d) * 86_400_000).getUTCDay();

export function localNow(tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
}

export interface AvailabilityOpts { date: string; durationMin: number; locationType: string; excludeBookingId?: number; admin?: boolean }

export async function computeSlots(q: Q, o: AvailabilityOpts) {
  const s = await bookingSettings(q);
  const general = await setting<any>(q, 'general', {});
  const tz = general.timezone || 'UTC';
  const now = localNow(tz);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new HttpError(400, 'Invalid date');
  const dIdx = dayIndex(o.date);
  if (!o.admin) {
    if (dIdx < dayIndex(now.date)) return [];
    if (dIdx - dayIndex(now.date) > s.maxAdvanceDays) return [];
    const [blocked] = await q('SELECT 1 FROM blocked_dates WHERE $1 >= date AND $1 <= COALESCE(end_date, date) LIMIT 1', [o.date]);
    if (blocked) return [];
  }
  const [hours] = await q<any>('SELECT * FROM business_hours WHERE weekday=$1', [weekday(o.date)]);
  if (!hours || (hours.closed && !o.admin)) return [];
  const open = hours.closed ? 0 : hours.open_min, close = hours.closed ? 1440 : hours.close_min;

  const existing = await q<any>(
    `SELECT start_min, block_end_min FROM bookings WHERE booking_date=$1 AND deleted_at IS NULL AND status NOT IN ${ACTIVE_STATUS} AND ($2::int IS NULL OR id<>$2)`,
    [o.date, o.excludeBookingId ?? null]);
  const block = o.durationMin + s.bufferMin + (o.locationType === 'studio' ? 0 : s.travelBufferMin);
  const minutesFromNow = (t: number) => (dIdx - dayIndex(now.date)) * 1440 + t - now.min;
  const slots: { start: string; end: string; startMin: number }[] = [];
  for (let t = open; t + o.durationMin <= close; t += s.slotIntervalMin) {
    if (!o.admin && minutesFromNow(t) < s.leadTimeHours * 60) continue;
    if (existing.some((b) => t < b.block_end_min && t + block > b.start_min)) continue;
    slots.push({ start: hhmm(t), end: hhmm(t + o.durationMin), startMin: t });
  }
  return slots;
}

const url = z.string().max(2000).refine((u) => u.startsWith('/uploads/') || /^https:\/\//.test(u), 'Invalid image URL');
export const bookingSchema = z.object({
  serviceIds: z.array(z.number().int()).min(1).max(10),
  addonIds: z.array(z.number().int()).max(30).default([]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(30).regex(/^[+\d][\d\s().-]{5,}$/, 'Invalid phone number'),
    whatsapp: z.string().trim().max(30).optional().default(''),
    email: z.string().trim().email().max(200),
  }),
  event: z.object({
    locationType: z.enum(['studio', 'client_home', 'hotel', 'event_venue', 'other']),
    venue: z.string().max(500).optional().default(''),
    people: z.number().int().min(1).max(50).default(1),
    hairstyling: z.string().max(1000).optional().default(''),
    specialRequests: z.string().max(3000).optional().default(''),
    notes: z.string().max(3000).optional().default(''),
    referenceImages: z.array(url).max(6).default([]),
  }),
  promoCode: z.string().max(40).optional(),
  website: z.string().max(0).optional(), // honeypot: real users leave this empty
});
export type BookingInput = z.infer<typeof bookingSchema>;

export async function applyPromo(q: Q, code: string | undefined, subtotal: number) {
  if (!code) return { discount: 0, code: null as string | null };
  const general = await setting<any>(q, 'general', {});
  const today = localNow(general.timezone || 'UTC').date;
  const [p] = await q<any>(
    `SELECT * FROM promotions WHERE visible AND lower(promo_code)=lower($1) AND (start_date IS NULL OR start_date<=$2) AND (end_date IS NULL OR end_date>=$2)`, [code, today]);
  if (!p) throw new HttpError(400, 'Promo code is invalid or expired');
  const discount = p.discount_type === 'percent' ? Math.round(subtotal * Math.min(100, p.discount_value) / 100)
    : p.discount_type === 'fixed' ? Math.min(subtotal, p.discount_value) : 0;
  return { discount, code: p.promo_code as string };
}

export async function resolveItems(q: Q, serviceIds: number[], addonIds: number[]) {
  const services = await q<any>('SELECT * FROM services WHERE id = ANY($1::int[]) AND deleted_at IS NULL AND available AND bookable', [serviceIds]);
  if (services.length !== new Set(serviceIds).size) throw new HttpError(400, 'One or more services are unavailable for booking');
  const addons = addonIds.length ? await q<any>('SELECT * FROM service_addons WHERE id = ANY($1::int[])', [addonIds]) : [];
  if (addons.length !== new Set(addonIds).size || addons.some((a) => !serviceIds.includes(a.service_id))) throw new HttpError(400, 'Invalid add-on selection');
  const duration = [...services, ...addons].reduce((n, x) => n + x.duration_min, 0);
  const subtotal = [...services, ...addons].reduce((n, x) => n + x.price_cents, 0);
  return { services, addons, duration, subtotal };
}

const ref = () => 'BA-' + crypto.randomBytes(4).toString('hex').toUpperCase();

export async function upsertCustomer(q: Q, c: { name: string; email?: string; phone?: string; whatsapp?: string }) {
  const [found] = await q<any>(
    `SELECT id FROM customers WHERE deleted_at IS NULL AND (($1<>'' AND lower(email)=lower($1)) OR ($2<>'' AND phone=$2)) ORDER BY id LIMIT 1`, [c.email || '', c.phone || '']);
  if (found) {
    await q('UPDATE customers SET name=$1, whatsapp=COALESCE(NULLIF($2,\'\'),whatsapp), updated_at=now() WHERE id=$3', [c.name, c.whatsapp || '', found.id]);
    return found.id as number;
  }
  const [row] = await q<any>('INSERT INTO customers(name,email,phone,whatsapp) VALUES ($1,$2,$3,$4) RETURNING id', [c.name, c.email || null, c.phone || null, c.whatsapp || null]);
  return row.id as number;
}

/** Create a booking inside a transaction with a table lock so two requests can never claim the same slot. */
export async function createBooking(
  txRunner: <T>(fn: (q: Q) => Promise<T>) => Promise<T>,
  input: BookingInput,
  opts: { admin?: boolean; status?: string; source?: string } = {},
) {
  return txRunner(async (q) => {
    await q('LOCK TABLE bookings IN SHARE ROW EXCLUSIVE MODE');
    const { services, addons, duration, subtotal } = await resolveItems(q, input.serviceIds, input.addonIds);
    const slots = await computeSlots(q, { date: input.date, durationMin: duration, locationType: input.event.locationType, admin: opts.admin });
    const start = toMin(input.time);
    if (!slots.some((s) => s.startMin === start)) throw new HttpError(409, 'That time is no longer available. Please choose another slot.');
    const bs = await bookingSettings(q);
    const block = duration + bs.bufferMin + (input.event.locationType === 'studio' ? 0 : bs.travelBufferMin);
    const promo = await applyPromo(q, input.promoCode, subtotal);
    const customerId = await upsertCustomer(q, input.customer);
    const reference = ref();
    const [b] = await q<any>(
      `INSERT INTO bookings(reference,customer_id,status,booking_date,start_min,end_min,block_end_min,location_type,venue,people_count,hairstyling,special_requests,notes,reference_images,total_cents,promo_code,source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17) RETURNING *`,
      [reference, customerId, opts.status || (bs.autoConfirm ? 'confirmed' : 'new'), input.date, start, start + duration, start + block, input.event.locationType, input.event.venue,
        input.event.people, input.event.hairstyling, input.event.specialRequests, input.event.notes, JSON.stringify(input.event.referenceImages), subtotal - promo.discount, promo.code, opts.source || 'website']);
    for (const s of services) await q('INSERT INTO booking_services(booking_id,service_id,name,price_cents,duration_min) VALUES ($1,$2,$3,$4,$5)', [b.id, s.id, s.name, s.price_cents, s.duration_min]);
    for (const a of addons) await q('INSERT INTO booking_addons(booking_id,addon_id,name,price_cents,duration_min) VALUES ($1,$2,$3,$4,$5)', [b.id, a.id, a.name, a.price_cents, a.duration_min]);
    return { booking: b, services, addons, discount: promo.discount };
  });
}

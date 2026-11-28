import crypto from 'crypto';
import type { Q } from '../db';
import { config } from '../config';

export const FEEDBACK_VALID_DAYS = 90;
export const feedbackUrl = (token: string) => `${config.publicUrl.replace(/\/$/, '')}/feedback/${token}`;

export async function createFeedbackRequest(q: Q, r: { bookingId?: number | null; customerName?: string; serviceCategory?: string }) {
  const token = crypto.randomBytes(18).toString('base64url');
  const expires = new Date(Date.now() + FEEDBACK_VALID_DAYS * 86_400_000).toISOString();
  const [row] = await q<any>(
    `INSERT INTO feedback_requests(token,booking_id,customer_name,service_category,expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [token, r.bookingId ?? null, r.customerName || '', (r.serviceCategory || '').slice(0, 120), expires]);
  return row;
}

/** One link per booking: reuses an open one, and returns null once the customer has already answered. */
export async function feedbackForBooking(q: Q, b: { id: number; customer_name: string; service_names: string }) {
  const [used] = await q('SELECT 1 FROM feedback_requests WHERE booking_id=$1 AND used_at IS NOT NULL LIMIT 1', [b.id]);
  if (used) return null;
  const [open] = await q<any>('SELECT * FROM feedback_requests WHERE booking_id=$1 AND used_at IS NULL AND expires_at>now() ORDER BY id DESC LIMIT 1', [b.id]);
  return open || createFeedbackRequest(q, { bookingId: b.id, customerName: b.customer_name, serviceCategory: b.service_names });
}

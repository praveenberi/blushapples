import type { Db } from '../db';
import { config } from '../config';
import { setting } from './booking';
import { hhmm } from './http';
import { dropEmptyLines, notify, render, whatsappCustomer, type Delivery } from './notify';
import { feedbackForBooking } from './feedback';

export const STATUS_LABELS: Record<string, string> = {
  new: 'New', pending_confirmation: 'Pending confirmation', confirmed: 'Confirmed', deposit_requested: 'Deposit requested', deposit_paid: 'Deposit paid',
  in_progress: 'In progress', completed: 'Closed', cancelled: 'Cancelled', rejected: 'Rejected', rescheduled: 'Rescheduled',
};

const STATUS_MESSAGES: Record<string, string> = {
  pending_confirmation: 'We are reviewing your booking and will confirm it shortly.',
  deposit_requested: 'To secure your appointment, please arrange your deposit. Reply to this message if you have any questions.',
  deposit_paid: 'We have received your deposit. Thank you!',
  in_progress: 'Your appointment is now in progress.',
  rejected: 'We are sorry, we are unable to take this booking. Please get in touch to arrange another time.',
  completed: 'Your booking is now complete. Thank you!',
};

export async function bookingVars(db: Db, b: any) {
  const brand = await setting<any>(db.q, 'brand', {});
  const currency = (await setting<any>(db.q, 'general', {})).currency || 'USD';
  const amount = (cents: number) => `${currency} ${(cents / 100).toFixed(2)}`;
  const paid = (b.deposit_cents || 0) + (b.balance_paid_cents || 0);
  return {
    brand: brand.name || 'Blush & Apples', name: b.customer_name, reference: b.reference, services: b.service_names,
    date: b.booking_date, time: hhmm(b.start_min), venue: b.venue || b.location_type,
    total: b.total_cents > 0 ? amount(b.total_cents) : '',
    paid: paid > 0 ? amount(paid) : '',
    pending: b.total_cents > 0 ? amount(Math.max(0, b.total_cents - paid)) : '',
    status: b.status, link: `${config.publicUrl}/admin/bookings`,
  };
}

/** Digits in international form, as WhatsApp needs. Local numbers get the default country code. */
export function waNumber(raw: string, countryCode: string) {
  const text = (raw || '').trim();
  let digits = text.replace(/\D/g, '');
  if (!digits) return '';
  if (text.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  digits = digits.replace(/^0+/, '');
  const alreadyHasCode = countryCode && digits.startsWith(countryCode) && digits.length >= countryCode.length + 8;
  return !countryCode || alreadyHasCode || digits.length > 10 ? digits : countryCode + digits;
}

const CODE_BY_CURRENCY: Record<string, string> = { SGD: '65', MYR: '60', INR: '91', AED: '971', GBP: '44', AUD: '61', NZD: '64', HKD: '852' };

export async function defaultCountryCode(db: Db) {
  const chosen = String((await setting<any>(db.q, 'whatsapp', {})).countryCode || '').replace(/\D/g, '');
  return chosen || CODE_BY_CURRENCY[(await setting<any>(db.q, 'general', {})).currency] || '';
}

export interface CustomerMessages {
  email: Delivery;
  whatsapp: 'sent' | 'failed' | 'manual' | 'no_number';
  /** Opens WhatsApp with the same message already typed, for sending by hand. */
  whatsappUrl: string | null;
  kind: 'status' | 'rescheduled' | 'feedback';
}

/**
 * Tells the customer about a status change or a new time, by email and WhatsApp, using the same editable template.
 * Closing a booking sends the feedback link. Never throws: the change itself is already saved.
 */
export async function messageCustomer(db: Db, b: any, event: string): Promise<CustomerMessages | null> {
  if (event === 'new') return null;
  try {
    const feedback = event === 'completed' ? await feedbackForBooking(db.q, b) : null;
    const key = feedback ? 'booking_feedback'
      : event === 'confirmed' ? 'booking_confirmed' : event === 'cancelled' ? 'booking_cancelled' : event === 'rescheduled' ? 'booking_rescheduled' : 'booking_status';
    const vars = {
      ...(await bookingVars(db, b)),
      status_label: STATUS_LABELS[event] || event,
      status_message: STATUS_MESSAGES[event] || '',
      feedback_link: feedback ? `${config.publicUrl.replace(/\/$/, '')}/feedback/${feedback.token}` : '',
    };
    const [tpl] = await db.q<any>('SELECT body FROM notification_templates WHERE key=$1', [key]);
    const text = render(dropEmptyLines(tpl?.body || '', vars), vars);
    const to = waNumber(b.customer_whatsapp || b.customer_phone || '', await defaultCountryCode(db));
    const [email, whatsapp] = await Promise.all([
      notify(db, key, b.customer_email, vars),
      !to ? Promise.resolve('no_number' as const)
        : whatsappCustomer(db, key, to, feedback ? config.whatsapp.feedbackTemplate : config.whatsapp.updateTemplate,
          feedback ? [vars.name, vars.feedback_link] : [vars.name, vars.reference, vars.status_label, `${vars.date} at ${vars.time}`]),
    ]);
    return {
      email, whatsapp, kind: feedback ? 'feedback' : event === 'rescheduled' ? 'rescheduled' : 'status',
      whatsappUrl: to && text ? `https://wa.me/${to}?text=${encodeURIComponent(text)}` : null,
    };
  } catch (e) {
    console.error('customer message failed', e);
    return { email: 'failed', whatsapp: 'failed', whatsappUrl: null, kind: 'status' };
  }
}

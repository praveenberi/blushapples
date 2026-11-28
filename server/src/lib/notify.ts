import nodemailer from 'nodemailer';
import { config } from '../config';
import type { Db } from '../db';

let transport: nodemailer.Transporter | null = null;
function mailer() {
  if (!config.smtp.host) return null;
  transport ||= nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000, // staff wait for the result
  });
  return transport;
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const render = (tpl: string, vars: Record<string, unknown>, escape = false) =>
  tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (escape ? esc(vars[k]) : String(vars[k] ?? '')));

/** Lines about money are left out when there is no amount to show. */
const OPTIONAL = ['total', 'paid', 'pending'];
export const dropEmptyLines = (tpl: string, vars: Record<string, unknown>) =>
  tpl.split('\n').filter((l) => !OPTIONAL.some((k) => vars[k] === '' && new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`).test(l))).join('\n');

export type Delivery = 'sent' | 'skipped' | 'failed' | 'off';

function wrap(brand: string, bodyHtml: string, accent: string) {
  return `<div style="background:#faf6f1;padding:32px 16px;font-family:Georgia,serif;color:#2b2626"><div style="max-width:560px;margin:auto;background:#fff;border-top:4px solid ${esc(accent)};padding:32px"><h1 style="font-weight:400;letter-spacing:.08em;font-size:20px;margin:0 0 20px">${esc(brand)}</h1>${bodyHtml}</div></div>`;
}

const log = (db: Db, channel: string, key: string | null, to: string, status: string, detail = '') =>
  db.q('INSERT INTO notification_logs(channel,template_key,recipient,status,detail) VALUES ($1,$2,$3,$4,$5)', [channel, key, to, status, detail]).catch(() => {});

/** Fire-and-log. A failed notification must never fail the booking itself. */
export async function notify(db: Db, key: string, to: string | undefined, vars: Record<string, unknown>): Promise<Delivery> {
  try {
    const [tpl] = await db.q<any>('SELECT * FROM notification_templates WHERE key=$1', [key]);
    if (!tpl || !tpl.enabled || !to) return 'off';
    const body = dropEmptyLines(tpl.body, vars);
    const brand = (await db.q<any>(`SELECT value FROM website_settings WHERE key='brand'`))[0]?.value || {};
    const theme = (await db.q<any>(`SELECT value FROM website_settings WHERE key='theme'`))[0]?.value || {};
    const subject = render(tpl.subject, vars);
    const text = render(body, vars);
    const html = wrap(
      brand.name || 'Blush & Apples',
      render(body, vars, true).split('\n').map((l: string) => `<p style="line-height:1.6">${l}</p>`).join(''),
      theme.colors?.gold || '#c9a96e',
    );
    const m = mailer();
    if (!m) { await log(db, 'email', key, to, 'skipped', 'SMTP not configured'); return 'skipped'; }
    await m.sendMail({ from: config.smtp.from, to, subject, text, html });
    await log(db, 'email', key, to, 'sent');
    return 'sent';
  } catch (e: any) {
    await log(db, 'email', key, to || '', 'failed', String(e.message).slice(0, 300));
    return 'failed';
  }
}

/** WhatsApp Cloud API admin alert; logs and falls back to click-to-chat when not configured. */
export async function whatsappAdmin(db: Db, message: string) {
  const w = config.whatsapp;
  try {
    if (!w.token || !w.phoneId || !w.adminNumber) return void (await log(db, 'whatsapp', null, w.adminNumber, 'skipped', 'WhatsApp API not configured'));
    const res = await fetch(`https://graph.facebook.com/v20.0/${w.phoneId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: w.adminNumber, type: 'text', text: { body: message } }),
    });
    await log(db, 'whatsapp', null, w.adminNumber, res.ok ? 'sent' : 'failed', res.ok ? '' : `HTTP ${res.status}`);
  } catch (e: any) {
    await log(db, 'whatsapp', null, w.adminNumber, 'failed', String(e.message).slice(0, 300));
  }
}

/**
 * Sends an approved WhatsApp Cloud API template to a customer. Free-form text is not used here: Meta only
 * delivers it within 24 hours of the customer's last message, and failures would look like successes.
 * Returns 'manual' when not set up, so staff can send the prepared message with one tap.
 */
export async function whatsappCustomer(db: Db, key: string, to: string, template: string, params: string[]): Promise<'sent' | 'failed' | 'manual'> {
  const w = config.whatsapp;
  if (!w.token || !w.phoneId || !template) { await log(db, 'whatsapp', key, to, 'skipped', 'Automatic WhatsApp not configured'); return 'manual'; }
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${w.phoneId}/messages`, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'template',
        template: { name: template, language: { code: w.templateLang }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: text.replace(/\s+/g, ' ').trim() || '-' })) }] },
      }),
    });
    await log(db, 'whatsapp', key, to, res.ok ? 'sent' : 'failed', res.ok ? '' : `HTTP ${res.status}: ${(await res.text()).slice(0, 250)}`);
    return res.ok ? 'sent' : 'failed';
  } catch (e: any) {
    await log(db, 'whatsapp', key, to, 'failed', String(e.message).slice(0, 300));
    return 'failed';
  }
}

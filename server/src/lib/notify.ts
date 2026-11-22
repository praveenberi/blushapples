import nodemailer from 'nodemailer';
import { config } from '../config';
import type { Db } from '../db';

let transport: nodemailer.Transporter | null = null;
function mailer() {
  if (!config.smtp.host) return null;
  transport ||= nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transport;
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const render = (tpl: string, vars: Record<string, unknown>, escape = false) =>
  tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (escape ? esc(vars[k]) : String(vars[k] ?? '')));

function wrap(brand: string, bodyHtml: string, accent: string) {
  return `<div style="background:#faf6f1;padding:32px 16px;font-family:Georgia,serif;color:#2b2626"><div style="max-width:560px;margin:auto;background:#fff;border-top:4px solid ${esc(accent)};padding:32px"><h1 style="font-weight:400;letter-spacing:.08em;font-size:20px;margin:0 0 20px">${esc(brand)}</h1>${bodyHtml}</div></div>`;
}

const log = (db: Db, channel: string, key: string | null, to: string, status: string, detail = '') =>
  db.q('INSERT INTO notification_logs(channel,template_key,recipient,status,detail) VALUES ($1,$2,$3,$4,$5)', [channel, key, to, status, detail]).catch(() => {});

/** Fire-and-log. A failed notification must never fail the booking itself. */
export async function notify(db: Db, key: string, to: string | undefined, vars: Record<string, unknown>) {
  try {
    const [tpl] = await db.q<any>('SELECT * FROM notification_templates WHERE key=$1', [key]);
    if (!tpl || !tpl.enabled || !to) return;
    const brand = (await db.q<any>(`SELECT value FROM website_settings WHERE key='brand'`))[0]?.value || {};
    const theme = (await db.q<any>(`SELECT value FROM website_settings WHERE key='theme'`))[0]?.value || {};
    const subject = render(tpl.subject, vars);
    const text = render(tpl.body, vars);
    const html = wrap(
      brand.name || 'Blush & Apples',
      render(tpl.body, vars, true).split('\n').map((l: string) => `<p style="line-height:1.6">${l}</p>`).join(''),
      theme.colors?.gold || '#c9a96e',
    );
    const m = mailer();
    if (!m) return void (await log(db, 'email', key, to, 'skipped', 'SMTP not configured'));
    await m.sendMail({ from: config.smtp.from, to, subject, text, html });
    await log(db, 'email', key, to, 'sent');
  } catch (e: any) {
    await log(db, 'email', key, to || '', 'failed', String(e.message).slice(0, 300));
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

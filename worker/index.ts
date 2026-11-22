import { Container, getContainer } from '@cloudflare/containers';

// Settings forwarded from the Worker's variables/secrets into the container's environment.
const KEYS = [
  'NODE_ENV', 'PUBLIC_URL', 'DATABASE_URL', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'TRUST_PROXY', 'CRON_SECRET',
  'STORAGE_PROVIDER', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CLOUDINARY_FOLDER',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM',
  'WHATSAPP_API_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ADMIN_NUMBER',
  'AI_PROVIDER', 'AI_PROVIDER_URL', 'AI_PROVIDER_KEY',
];

export class ApiContainer extends Container {
  defaultPort = 4000;
  sleepAfter = '20m';
  constructor(ctx: any, env: any) {
    super(ctx, env);
    this.envVars = Object.fromEntries(KEYS.filter((k) => env[k] !== undefined && env[k] !== '').map((k) => [k, String(env[k])]));
  }
}

export default {
  // Every request (site, API, uploads, sitemap) goes to the one container, which serves them all.
  async fetch(request: Request, env: any) {
    const headers = new Headers(request.headers);
    // Overwrite, never trust, the client-supplied value so rate limits see the real visitor IP.
    headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') || '');
    headers.set('x-forwarded-proto', 'https');
    return getContainer(env.API).fetch(new Request(request, { headers }));
  },

  // Cron: wakes the container and triggers appointment reminders.
  async scheduled(_event: any, env: any, ctx: any) {
    ctx.waitUntil(
      getContainer(env.API).fetch(new Request('http://container/api/internal/reminders', { method: 'POST', headers: { 'x-cron-secret': env.CRON_SECRET || '' } })),
    );
  },
};

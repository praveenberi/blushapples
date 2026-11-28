import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const env = process.env;
/** Example files use CHANGE_ME; treat that as "not set up". */
const real = (v?: string) => (v && v !== 'CHANGE_ME' ? v : '');
const isProd = env.NODE_ENV === 'production';

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set (32+ chars) in production');
}

export const config = {
  isProd,
  isTest: env.NODE_ENV === 'test',
  port: Number(env.PORT || 4000),
  cronSecret: env.CRON_SECRET || '',
  trustProxy: Number(env.TRUST_PROXY || 1),
  publicUrl: env.PUBLIC_URL || 'http://localhost:5173',
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret',
  databaseUrl: env.DATABASE_URL || '',
  pgliteDir: env.PGLITE_DIR || path.resolve(__dirname, '../data/pglite'),
  uploadDir: env.UPLOAD_DIR || path.resolve(__dirname, '../uploads'),
  storage: {
    provider: (env.STORAGE_PROVIDER || 'local') as 'local' | 'cloudinary',
    cloudinary: {
      cloudName: env.CLOUDINARY_CLOUD_NAME || '',
      apiKey: env.CLOUDINARY_API_KEY || '',
      apiSecret: env.CLOUDINARY_API_SECRET || '',
      folder: env.CLOUDINARY_FOLDER || 'blush-apples',
    },
  },
  ai: {
    provider: env.AI_PROVIDER || 'none', // none | http
    url: env.AI_PROVIDER_URL || '',
    key: env.AI_PROVIDER_KEY || '',
  },
  smtp: {
    host: real(env.SMTP_HOST),
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || 'Blush & Apples <no-reply@example.com>',
  },
  whatsapp: {
    token: real(env.WHATSAPP_API_TOKEN),
    phoneId: real(env.WHATSAPP_PHONE_NUMBER_ID),
    // Names of Meta-approved message templates. Customer messages can only be sent automatically with these.
    updateTemplate: real(env.WHATSAPP_TEMPLATE_UPDATE),
    feedbackTemplate: real(env.WHATSAPP_TEMPLATE_FEEDBACK),
    templateLang: env.WHATSAPP_TEMPLATE_LANG || 'en',
    adminNumber: env.WHATSAPP_ADMIN_NUMBER || '',
  },
  seed: {
    adminEmail: env.ADMIN_EMAIL || 'admin@example.com',
    resetAdmin: env.RESET_ADMIN === 'true',
    adminPassword: env.ADMIN_PASSWORD || '',
  },
};

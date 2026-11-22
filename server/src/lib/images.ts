import sharp from 'sharp';
import crypto from 'crypto';
import { storage } from './storage';

export const ALLOWED_FORMATS = ['jpeg', 'png', 'webp', 'avif'];

/** Validates real image content (decoded by sharp), not the client-declared mime type. */
export async function inspect(buf: Buffer) {
  const meta = await sharp(buf, { failOn: 'error' }).metadata();
  if (!meta.format || !ALLOWED_FORMATS.includes(meta.format)) throw new Error('Unsupported image format');
  if (!meta.width || !meta.height) throw new Error('Invalid image');
  return meta;
}

export interface StoredImage {
  storageKey: string; originalUrl: string; displayUrl: string; thumbUrl: string; width: number; height: number;
}

const rid = () => crypto.randomBytes(6).toString('hex');
export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';

/** Stores the untouched original plus a 2000px display webp and a 480px thumbnail webp. */
export async function storeImageVariants(buf: Buffer, baseName: string, folder = 'gallery'): Promise<StoredImage> {
  const meta = await inspect(buf);
  const key = `${folder}/${slugify(baseName)}-${rid()}`;
  const s = storage();
  const orig = await sharp(buf).rotate().toBuffer({ resolveWithObject: true });
  const ext = meta.format === 'jpeg' ? 'jpg' : meta.format!;
  const original = await s.put(`${key}-original.${ext}`, orig.data, `image/${meta.format}`);
  const display = await sharp(buf).rotate().resize({ width: 2000, withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
  const thumb = await sharp(buf).rotate().resize({ width: 480, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  const d = await s.put(`${key}.webp`, display, 'image/webp');
  const t = await s.put(`${key}-thumb.webp`, thumb, 'image/webp');
  return { storageKey: key, originalUrl: original.url, displayUrl: d.url, thumbUrl: t.url, width: orig.info.width, height: orig.info.height };
}

export async function removeVariants(key: string) {
  const s = storage();
  for (const suffix of ['.webp', '-thumb.webp', '-original.jpg', '-original.png', '-original.webp', '-original.avif']) {
    await s.remove(key + suffix).catch(() => {});
  }
}

/* ---------- manual editing pipeline (always available, no AI needed) ---------- */

export interface EditParams {
  brightness?: number; contrast?: number; saturation?: number; sharpness?: number; exposure?: number;
  temperature?: number; tint?: number; highlights?: number; shadows?: number; // all -100..100
  rotate?: 0 | 90 | 180 | 270;
  crop?: { x: number; y: number; w: number; h: number }; // fractions 0..1 of the (rotated) image
  intensity?: 'subtle' | 'natural' | 'medium' | 'strong';
  denoise?: number; // 0..100
  autoLevel?: boolean;
}

export const INTENSITY: Record<string, number> = { subtle: 0.35, natural: 0.6, medium: 0.8, strong: 1 };
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

export async function applyManualEdits(src: Buffer, p: EditParams, maxWidth?: number): Promise<Buffer> {
  const k = INTENSITY[p.intensity || 'natural'] ?? 0.6; // intensity scales automatic looks, never explicit sliders
  let work = await sharp(src).rotate().toBuffer(); // honour EXIF
  if (p.rotate) work = await sharp(work).rotate(p.rotate).toBuffer();
  if (p.crop) {
    const m = await sharp(work).metadata();
    const W = m.width!, H = m.height!;
    const left = Math.min(W - 1, Math.round(clamp(p.crop.x, 0, 1) * W));
    const top = Math.min(H - 1, Math.round(clamp(p.crop.y, 0, 1) * H));
    const width = Math.max(1, Math.min(W - left, Math.round(clamp(p.crop.w, 0.02, 1) * W)));
    const height = Math.max(1, Math.min(H - top, Math.round(clamp(p.crop.h, 0.02, 1) * H)));
    work = await sharp(work).extract({ left, top, width, height }).toBuffer();
  }
  let out = sharp(work);
  if (maxWidth) out = out.resize({ width: maxWidth, withoutEnlargement: true });
  if (p.denoise) out = out.median(p.denoise > 60 ? 3 : 1);
  if (p.autoLevel) out = out.normalise({ lower: 1 + (1 - k) * 4, upper: 99 - (1 - k) * 4 });

  const exposure = (p.exposure ?? 0) / 100;
  const bright = 1 + (p.brightness ?? 0) / 100 + exposure * 0.6;
  const sat = 1 + (p.saturation ?? 0) / 100;
  out = out.modulate({ brightness: clamp(bright, 0.1, 3), saturation: clamp(sat, 0, 3) });

  const c = 1 + (p.contrast ?? 0) / 100;
  const sh = (p.shadows ?? 0) / 100, hi = (p.highlights ?? 0) / 100; // tonal ends approximated as a gentle lift/compress
  out = out.linear(clamp(c * (1 + hi * 0.15 - sh * 0.1), 0.4, 2.5), 128 * (1 - c) + sh * 22 - hi * 8);

  const t = (p.temperature ?? 0) / 100, ti = (p.tint ?? 0) / 100; // warm(+) = more red/less blue; tint magenta(+) / green(-)
  if (t || ti) out = out.recomb([[1 + t * 0.12, 0, 0], [0, 1 - ti * 0.1, 0], [0, 0, 1 - t * 0.12]]);

  if (p.sharpness && p.sharpness > 0) out = out.sharpen({ sigma: 0.6 + (p.sharpness / 100) * 1.4 });
  else if (p.sharpness && p.sharpness < 0) out = out.blur(0.3 + (-p.sharpness / 100) * 1.5);
  return out.toBuffer();
}

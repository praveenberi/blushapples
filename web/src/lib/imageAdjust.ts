/** Pixel work for the upload editor. Done by hand because canvas `filter` is not supported in every browser. */
export interface Adjust { brightness: number; contrast: number; saturation: number; warmth: number; sharpen: number }
export const NO_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpen: 0 };
export const isNeutral = (a: Adjust) => Object.values(a).every((v) => v === 0);

/** Adjusts RGBA pixels in place. Alpha is left alone. */
export function applyAdjust(px: Uint8ClampedArray, w: number, h: number, a: Adjust) {
  const bright = a.brightness * 0.8, con = 1 + a.contrast / 100, sat = 1 + a.saturation / 100, warm = a.warmth * 0.3;
  if (a.brightness || a.contrast || a.saturation || a.warmth) {
    for (let i = 0; i < px.length; i += 4) {
      const r = (px[i] + bright - 128) * con + 128 + warm;
      const g = (px[i + 1] + bright - 128) * con + 128;
      const b = (px[i + 2] + bright - 128) * con + 128 - warm;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      px[i] = l + (r - l) * sat; px[i + 1] = l + (g - l) * sat; px[i + 2] = l + (b - l) * sat;
    }
  }
  if (a.sharpen > 0) {
    const src = new Uint8ClampedArray(px), k = a.sharpen / 200, row = w * 4;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * row + x * 4;
        for (let c = 0; c < 3; c++) px[i + c] = src[i + c] + k * (4 * src[i + c] - src[i + c - 4] - src[i + c + 4] - src[i + c - row] - src[i + c + row]);
      }
    }
  }
}

/** A gentle one-tap enhancement based on how bright and how flat the photo is. */
export function autoAdjust(px: Uint8ClampedArray): Adjust {
  let sum = 0, sq = 0, n = 0;
  for (let i = 0; i < px.length; i += 16) {
    if (px[i + 3] < 128) continue;
    const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    sum += l; sq += l * l; n++;
  }
  const mean = n ? sum / n : 128;
  const spread = n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 60;
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));
  return { brightness: clamp((130 - mean) * 0.3, -15, 20), contrast: clamp((60 - spread) * 0.5 + 6, 3, 20), saturation: 10, warmth: 4, sharpen: 25 };
}

export interface Crop { x: number; y: number; w: number; h: number }

/** The crop box for an aspect ratio, zoom and centre point, always kept inside the image. */
export function cropBox(imgW: number, imgH: number, aspect: number | null, zoom: number, cx: number, cy: number): Crop {
  const a = aspect ?? imgW / imgH;
  const w = Math.min(imgW, imgH * a) / zoom, h = w / a;
  const clamp = (v: number, max: number) => Math.min(Math.max(0, v), Math.max(0, max));
  return { x: clamp(cx - w / 2, imgW - w), y: clamp(cy - h / 2, imgH - h), w, h };
}

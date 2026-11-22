import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config';

/** Storage abstraction: swap providers via STORAGE_PROVIDER without touching callers. */
export interface StorageProvider {
  name: string;
  put(key: string, data: Buffer, contentType: string): Promise<{ url: string }>;
  remove(key: string): Promise<void>;
}

class LocalStorage implements StorageProvider {
  name = 'local';
  async put(key: string, data: Buffer) {
    const file = path.join(config.uploadDir, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    return { url: `/uploads/${key}` };
  }
  async remove(key: string) {
    const file = path.resolve(config.uploadDir, key);
    if (file.startsWith(path.resolve(config.uploadDir)) && fs.existsSync(file)) fs.unlinkSync(file);
  }
}

/** Cloudinary signed server-side upload (credentials never reach the browser). */
class CloudinaryStorage implements StorageProvider {
  name = 'cloudinary';
  private c = config.storage.cloudinary;
  private sign(params: Record<string, string>) {
    const str = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
    return crypto.createHash('sha1').update(str + this.c.apiSecret).digest('hex');
  }
  private publicId(key: string) {
    return `${this.c.folder}/${key.replace(/\.[a-z0-9]+$/i, '')}`;
  }
  async put(key: string, data: Buffer, contentType: string) {
    const public_id = this.publicId(key);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = this.sign({ public_id, timestamp, overwrite: 'true' });
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)], { type: contentType }), path.basename(key));
    form.append('public_id', public_id);
    form.append('timestamp', timestamp);
    form.append('overwrite', 'true');
    form.append('api_key', this.c.apiKey);
    form.append('signature', signature);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${this.c.cloudName}/image/upload`, { method: 'POST', body: form });
    const json: any = await res.json();
    if (!res.ok) throw new Error(`Cloudinary upload failed: ${json?.error?.message || res.status}`);
    return { url: json.secure_url as string };
  }
  async remove(key: string) {
    const public_id = this.publicId(key);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = new URLSearchParams({ public_id, timestamp, api_key: this.c.apiKey, signature: this.sign({ public_id, timestamp }) });
    await fetch(`https://api.cloudinary.com/v1_1/${this.c.cloudName}/image/destroy`, { method: 'POST', body });
  }
}

let instance: StorageProvider | null = null;
export function storage(): StorageProvider {
  if (!instance) {
    if (config.storage.provider === 'cloudinary') {
      const c = config.storage.cloudinary;
      if (!c.cloudName || !c.apiKey || !c.apiSecret) throw new Error('Cloudinary selected but CLOUDINARY_* env vars are missing');
      instance = new CloudinaryStorage();
    } else instance = new LocalStorage();
  }
  return instance;
}

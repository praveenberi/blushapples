export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, string[]>) {
    super(message);
  }
}

const csrf = () => document.cookie.split('; ').find((c) => c.startsWith('ba_csrf='))?.split('=')[1] || '';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = csrf();
  const res = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText, data?.details);
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T = any>(p: string, b: unknown) => request<T>('PUT', p, b),
  del: <T = any>(p: string) => request<T>('DELETE', p),
  /** Multipart upload with progress callback (0..1). */
  upload<T = any>(path: string, files: File[], fields: Record<string, string | number | undefined> = {}, onProgress?: (p: number) => void, field = 'files'): Promise<T> {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      files.forEach((f) => fd.append(field, f));
      Object.entries(fields).forEach(([k, v]) => v !== undefined && fd.append(k, String(v)));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api${path}`);
      xhr.setRequestHeader('x-csrf-token', csrf());
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let data: any = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* empty */ }
        xhr.status >= 200 && xhr.status < 300 ? resolve(data) : reject(new ApiError(xhr.status, data?.error || 'Upload failed', data?.details));
      };
      xhr.onerror = () => reject(new ApiError(0, 'Network error'));
      xhr.send(fd);
    });
  },
  /** POST JSON, receive an image blob (photo-studio preview). */
  async blob(path: string, body: unknown): Promise<Blob> {
    const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() }, body: JSON.stringify(body) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(res.status, d.error || 'Failed'); }
    return res.blob();
  },
};

export const errorMessage = (e: unknown) => {
  if (e instanceof ApiError) {
    const first = e.details && Object.entries(e.details)[0];
    return first ? `${first[0]}: ${first[1][0]}` : e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
};

export const money = (cents: number, currency = 'USD', locale = 'en-US') =>
  new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

export const mins = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const toMins = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

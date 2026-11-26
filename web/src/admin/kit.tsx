import { AnimatePresence, motion, Reorder } from 'framer-motion';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage, slugify } from '../lib/api';
import { ErrorNote, Modal, PageLoader, Spinner } from '../components/ui';
import { urlToFile, useUploadEditor } from '../components/UploadEditor';

/* ---------------- auth + toast ---------------- */
export interface AdminUser { id: number; email: string; name: string; role: string; permissions: string[] }
interface AuthCtx { user: AdminUser | null; ready: boolean; login: (e: string, p: string) => Promise<void>; logout: () => Promise<void>; can: (p: string) => boolean }
export const AuthContext = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(AuthContext);

const ToastContext = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const push = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 6000 : 2800);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[120] flex flex-col gap-2" aria-live="polite">
        <AnimatePresence>{items.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }}
            className={`pointer-events-auto max-w-sm px-4 py-3 text-sm shadow-lg ${t.kind === 'err' ? 'bg-rose text-white' : 'bg-charcoal text-white'}`}>{t.msg}</motion.div>))}</AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/* ---------------- field system ---------------- */
export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'bool' | 'select' | 'image' | 'images' | 'color' | 'lines' | 'date' | 'tags';
export interface FieldDef { key: string; label: string; type?: FieldType; options?: [string, string][]; help?: string; placeholder?: string; required?: boolean; half?: boolean; min?: number; max?: number; show?: (v: any) => boolean }

export const getPath = (o: any, p: string) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
export const setPath = (o: any, p: string, v: any) => {
  const keys = p.split('.');
  const copy = Array.isArray(o) ? [...o] : { ...o };
  let cur = copy;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = v;
    else { cur[k] = cur[k] && typeof cur[k] === 'object' ? (Array.isArray(cur[k]) ? [...cur[k]] : { ...cur[k] }) : {}; cur = cur[k]; }
  });
  return copy;
};

/** Every image uploaded for sections/logo/services. Pick one (when onPick is given) or delete unused ones. */
export function MediaLibrary({ open, onClose, onPick, multiple }: { open: boolean; onClose: () => void; onPick?: (urls: string[]) => void; multiple?: boolean }) {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad<any[]>(open ? '/admin/gallery/media' : null, [open]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [del, setDel] = useState<{ item: any; force: boolean } | null>(null);
  useEffect(() => { if (open) setChosen([]); }, [open]);
  const toggle = (u: string) => {
    if (!onPick) return;
    if (!multiple) { onPick([u]); onClose(); return; }
    setChosen((c) => (c.includes(u) ? c.filter((x) => x !== u) : [...c, u]));
  };
  const remove = async () => {
    const { item, force } = del!;
    try { await api.del(`/admin/gallery/media/${item.id}${force ? '?force=true' : ''}`); toast('Image deleted'); setDel(null); reload(); }
    catch (e: any) { if (e?.status === 409 && !force) setDel({ item, force: true }); else { toast(errorMessage(e), 'err'); setDel(null); } }
  };
  return (
    <>
      <Modal open={open} onClose={onClose} title="Media library" wide>
        <ErrorNote message={error} />
        {loading ? <PageLoader /> : !data?.length ? <p className="py-10 text-center text-charcoal/60">No uploaded images yet. Images you upload for the hero, logo, services and more appear here.</p> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.map((m) => (
              <div key={m.id} className={`group relative border bg-paper ${chosen.includes(m.url) ? 'border-gold ring-2 ring-gold' : 'border-charcoal/10'}`}>
                <button type="button" onClick={() => toggle(m.url)} className="block w-full" aria-label={onPick ? `Use ${m.filename || 'image'}` : m.filename || 'image'}>
                  <img src={m.thumb_url} onError={(e) => { (e.target as HTMLImageElement).src = m.url; }} alt={m.filename} loading="lazy" className="aspect-square w-full bg-nude/50 object-contain" />
                </button>
                <div className="flex items-center justify-between gap-1 p-1.5 text-[11px]">
                  <span className="truncate text-charcoal/55">{m.in_use ? 'In use' : 'Unused'} · {m.filename || 'image'}</span>
                  <button type="button" onClick={() => setDel({ item: m, force: false })} className="shrink-0 px-1 text-rose hover:underline" aria-label="Delete image">Delete</button>
                </div>
              </div>))}
          </div>)}
        {onPick && multiple && <div className="mt-5 flex justify-end gap-2 border-t border-charcoal/10 pt-4"><button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-solid btn-sm" disabled={!chosen.length} onClick={() => { onPick(chosen); onClose(); }}>Add {chosen.length || ''} selected</button></div>}
      </Modal>
      <Confirm open={!!del} confirmLabel="Delete image" onNo={() => setDel(null)} onYes={remove}
        message={del?.force ? 'This image is still used on the website. Deleting it will leave a blank spot until you choose another. Delete anyway?' : 'Delete this image permanently? This cannot be undone.'} />
    </>
  );
}

export function ImageField({ value, onChange, label }: { value?: string | null; onChange: (u: string | null) => void; label: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [lib, setLib] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { edit, editor } = useUploadEditor();
  const send = async (f: File) => {
    setBusy(true);
    try { const r = await api.upload('/admin/gallery/asset', [f], {}, undefined, 'file'); onChange(r.url); } catch (e) { toast(errorMessage(e), 'err'); } finally { setBusy(false); }
  };
  const pick = async (f?: File) => {
    if (!f) return;
    const [chosen] = await edit([f]);
    if (chosen) await send(chosen);
  };
  /** Edits the current image and saves the result as a new upload; the old one stays in the library. */
  const reEdit = async () => {
    try {
      const current = await urlToFile(value!);
      const [chosen] = await edit([current]);
      if (chosen && chosen !== current) await send(chosen);
    } catch (e) { toast(errorMessage(e), 'err'); }
  };
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden bg-nude text-xs text-charcoal/40">{value ? <img src={value} alt={label} className="h-full w-full object-cover" /> : 'No image'}</div>
      <div className="flex flex-col gap-1.5">
        <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="btn btn-outline btn-sm" onClick={() => input.current?.click()} disabled={busy}>{busy ? <Spinner /> : value ? 'Replace' : 'Upload'}</button>
        {value && <button type="button" className="text-left text-xs text-gold hover:underline" onClick={reEdit} disabled={busy}>Crop &amp; enhance</button>}
        <button type="button" className="text-left text-xs text-gold hover:underline" onClick={() => setLib(true)}>Choose from library</button>
        {value && <button type="button" className="text-left text-xs text-rose hover:underline" onClick={() => onChange(null)}>Remove</button>}
      </div>
      <MediaLibrary open={lib} onClose={() => setLib(false)} onPick={(u) => onChange(u[0])} />
      {editor}
    </div>
  );
}

/** Several images in order: upload many at once, reorder with arrows, remove. */
export function MultiImageField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [lib, setLib] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { edit, editor } = useUploadEditor();
  const reEdit = async (i: number) => {
    try {
      const current = await urlToFile(value[i]);
      const [chosen] = await edit([current]);
      if (!chosen || chosen === current) return;
      setBusy(true);
      const { url } = await api.upload('/admin/gallery/asset', [chosen], {}, undefined, 'file');
      onChange(value.map((u, n) => (n === i ? url : u)));
    } catch (e) { toast(errorMessage(e), 'err'); } finally { setBusy(false); }
  };
  const add = async (picked: File[]) => {
    const files = await edit(picked);
    if (!files.length) return;
    setBusy(true);
    const urls: string[] = [];
    try { for (const f of files) urls.push((await api.upload('/admin/gallery/asset', [f], {}, undefined, 'file')).url); } catch (e) { toast(errorMessage(e), 'err'); }
    if (urls.length) onChange([...value, ...urls]);
    setBusy(false);
  };
  const move = (i: number, d: number) => { const n = [...value]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {value.map((u, i) => (
          <div key={u + i} className="w-24">
            <img src={u} alt={`Slide ${i + 1}`} className="h-24 w-24 object-cover" />
            <button type="button" disabled={busy} onClick={() => reEdit(i)} className="mt-1 block w-full text-[11px] text-gold hover:underline">Crop &amp; enhance</button>
            <div className="mt-1 flex justify-between text-xs">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move earlier" className="px-1.5 disabled:opacity-30">←</button>
              <button type="button" onClick={() => onChange(value.filter((_, n) => n !== i))} aria-label="Remove" className="px-1.5 text-rose">✕</button>
              <button type="button" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Move later" className="px-1.5 disabled:opacity-30">→</button>
            </div>
          </div>))}
        <input ref={input} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e) => { add(Array.from(e.target.files || [])); e.target.value = ''; }} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="grid h-24 w-24 place-items-center border border-dashed border-charcoal/30 text-xs text-charcoal/60 hover:border-gold">{busy ? <Spinner /> : '+ Upload'}</button>
        <button type="button" onClick={() => setLib(true)} className="grid h-24 w-24 place-items-center border border-dashed border-gold/60 text-xs text-gold hover:bg-gold/10">From library</button>
      </div>
      <MediaLibrary open={lib} multiple onClose={() => setLib(false)} onPick={(urls) => onChange([...value, ...urls.filter((u) => !value.includes(u))])} />
      {editor}
    </div>
  );
}

export function FieldInput({ f, value, onChange }: { f: FieldDef; value: any; onChange: (v: any) => void }) {
  const id = `f-${f.key}`;
  switch (f.type) {
    case 'textarea': return <textarea id={id} rows={4} className="input" value={value ?? ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'number': return <input id={id} type="number" className="input" min={f.min} max={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />;
    case 'money': return <input id={id} type="number" step="0.01" min={0} className="input" value={value == null ? '' : value / 100} onChange={(e) => onChange(Math.round(Number(e.target.value || 0) * 100))} />;
    case 'bool': return <label className="flex items-center gap-2 py-2"><input id={id} type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-gold))]" checked={!!value} onChange={(e) => onChange(e.target.checked)} /><span className="text-sm">{f.help || 'Enabled'}</span></label>;
    case 'select': return <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>{f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
    case 'image': return <ImageField label={f.label} value={value} onChange={onChange} />;
    case 'images': return <MultiImageField value={value || []} onChange={onChange} />;
    case 'color': return <div className="flex items-center gap-2"><input id={id} type="color" className="h-10 w-14 cursor-pointer border border-charcoal/15 bg-paper p-1" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} /><code className="text-xs">{value}</code></div>;
    case 'lines': return <textarea id={id} rows={5} className="input" placeholder="One item per line" value={(value || []).join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} onBlur={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} />;
    case 'tags': return <input id={id} className="input" placeholder="comma, separated" defaultValue={(value || []).join(', ')} onBlur={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />;
    case 'date': return <input id={id} type="date" className="input" value={value || ''} onChange={(e) => onChange(e.target.value || null)} />;
    default: return <input id={id} className="input" value={value ?? ''} placeholder={f.placeholder} required={f.required} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function Fields({ fields, value, onChange }: { fields: FieldDef[]; value: any; onChange: (v: any) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.filter((f) => !f.show || f.show(value)).map((f) => (
        <div key={f.key} className={f.half ? '' : 'sm:col-span-2'}>
          {f.type !== 'bool' && <label className="label" htmlFor={`f-${f.key}`}>{f.label}{f.required && ' *'}</label>}
          {f.type === 'bool' && <p className="label">{f.label}</p>}
          <FieldInput f={f} value={getPath(value, f.key)} onChange={(v) => onChange(setPath(value, f.key, v))} />
          {f.help && f.type !== 'bool' && <p className="mt-1 text-xs text-charcoal/50">{f.help}</p>}
        </div>))}
    </div>
  );
}

export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setError(null);
    api.get<T>(path).then((d) => live && setData(d)).catch((e) => live && setError(errorMessage(e)));
    return () => { live = false; };
  }, [path, n, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, setData, error, reload: () => setN((x) => x + 1), loading: !data && !error };
}

export const PageHeader = ({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl sm:text-4xl">{title}</h1>{sub && <p className="mt-1 text-sm text-charcoal/60">{sub}</p>}</div><div className="flex flex-wrap gap-2">{actions}</div></div>
);

export function Confirm({ open, message, onYes, onNo, confirmLabel = 'Delete' }: { open: boolean; message: string; onYes: () => void; onNo: () => void; confirmLabel?: string }) {
  return (
    <Modal open={open} onClose={onNo} title="Please confirm">
      <p className="text-charcoal/75">{message}</p>
      <div className="mt-6 flex justify-end gap-2"><button className="btn btn-outline btn-sm" onClick={onNo}>Cancel</button><button className="btn btn-solid btn-sm !bg-rose" onClick={onYes}>{confirmLabel}</button></div>
    </Modal>
  );
}

/* ---------------- generic resource manager ---------------- */
export interface Column { label: string; render: (row: any) => ReactNode }
export function ResourceManager({ title, sub, endpoint, fields, columns, blank, reorderable, extra, wide, noAdd }: {
  title: string; sub?: string; endpoint: string; fields: FieldDef[]; columns: Column[]; blank: any; reorderable?: boolean; wide?: boolean; noAdd?: boolean;
  extra?: (row: any, reload: () => void) => ReactNode;
}) {
  const toast = useToast();
  const { data, setData, error, reload, loading } = useLoad<any[]>(endpoint);
  const [edit, setEdit] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [del, setDel] = useState<any | null>(null);
  // The list URL may carry a filter (?page=about); item URLs must be built without it.
  const base = endpoint.split('?')[0];

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      if ('slug' in edit && !edit.slug) edit.slug = slugify(edit.name || edit.title || '');
      if (edit.id) await api.put(`${base}/${edit.id}`, edit); else await api.post(base, edit);
      toast('Saved'); setEdit(null); reload();
    } catch (e) { setErr(errorMessage(e)); } finally { setSaving(false); }
  };
  const remove = async () => {
    try { await api.del(`${base}/${del.id}`); toast('Deleted'); setDel(null); reload(); } catch (e) { toast(errorMessage(e), 'err'); setDel(null); }
  };
  const reorder = async (rows: any[]) => {
    setData(rows);
    try { await api.post(`${base}/reorder`, { ids: rows.map((r) => r.id) }); } catch (e) { toast(errorMessage(e), 'err'); reload(); }
  };

  return (
    <div>
      <PageHeader title={title} sub={sub} actions={!noAdd && <button className="btn btn-solid btn-sm" onClick={() => { setErr(null); setEdit(structuredClone(blank)); }}>+ Add new</button>} />
      <ErrorNote message={error} />
      {loading ? <PageLoader /> : !data?.length ? (
        <div className="admin-card p-10 text-center text-charcoal/60">Nothing here yet. <button className="text-gold underline" onClick={() => setEdit(structuredClone(blank))}>Add the first one</button>.</div>
      ) : (
        <div className="admin-card overflow-x-auto">
          <table className="w-full min-w-[520px]"><thead><tr>{reorderable && <th className="admin-th w-8" />}{columns.map((c) => <th key={c.label} className="admin-th">{c.label}</th>)}<th className="admin-th w-40 text-right">Actions</th></tr></thead>
            {reorderable ? (
              <Reorder.Group as="tbody" axis="y" values={data} onReorder={setData}>
                {data.map((row) => (
                  <Reorder.Item as="tr" key={row.id} value={row} onDragEnd={() => reorder(data)} className="bg-paper">
                    <td className="admin-td cursor-grab text-charcoal/35" aria-label="Drag to reorder">⋮⋮</td>
                    {columns.map((c) => <td key={c.label} className="admin-td">{c.render(row)}</td>)}
                    <td className="admin-td text-right"><RowActions row={row} onEdit={() => { setErr(null); setEdit(structuredClone(row)); }} onDelete={() => setDel(row)} extra={extra?.(row, reload)} /></td>
                  </Reorder.Item>))}
              </Reorder.Group>
            ) : (
              <tbody>{data.map((row) => (<tr key={row.id}>{columns.map((c) => <td key={c.label} className="admin-td">{c.render(row)}</td>)}
                <td className="admin-td text-right"><RowActions row={row} onEdit={() => { setErr(null); setEdit(structuredClone(row)); }} onDelete={() => setDel(row)} extra={extra?.(row, reload)} /></td></tr>))}</tbody>)}
          </table>
        </div>)}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${title.toLowerCase()}` : `New ${title.toLowerCase()}`} wide={wide}>
        {edit && (<form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-5">
          <Fields fields={fields} value={edit} onChange={setEdit} /><ErrorNote message={err} />
          <div className="flex justify-end gap-2 border-t border-charcoal/10 pt-4"><button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-solid btn-sm" disabled={saving}>{saving ? <Spinner /> : 'Save'}</button></div></form>)}
      </Modal>
      <Confirm open={!!del} message="This cannot be undone. Delete it?" onYes={remove} onNo={() => setDel(null)} />
    </div>
  );
}
function RowActions({ onEdit, onDelete, extra }: { row: any; onEdit: () => void; onDelete: () => void; extra?: ReactNode }) {
  return <span className="inline-flex items-center gap-1">{extra}<button className="btn btn-ghost btn-sm !px-2" onClick={onEdit}>Edit</button><button className="btn btn-ghost btn-sm !px-2 hover:!text-rose" onClick={onDelete}>Delete</button></span>;
}

export const Bool = ({ v, yes = 'Yes', no = '-' }: { v: boolean; yes?: string; no?: string }) => v ? <span className="badge !bg-gold/20 !text-gold">{yes}</span> : <span className="text-charcoal/35">{no}</span>;

/* ---------------- settings group editor ---------------- */
export function SettingsForm({ group, title, sub, fields, perm, onPreview, onSaved }: { group: string; title: string; sub?: string; fields: FieldDef[]; perm?: boolean; onPreview?: (v: any) => void; onSaved?: () => void }) {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad<Record<string, any>>('/admin/settings');
  const [val, setVal] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setVal(structuredClone(data[group] ?? {})); }, [data, group]);
  if (loading || !val) return error ? <ErrorNote message={error} /> : <PageLoader />;
  const save = async () => {
    setSaving(true);
    try { await api.put(`/admin/settings/${group}`, { value: val }); toast('Saved. Live on the website now.'); reload(); onSaved?.(); } catch (e) { toast(errorMessage(e), 'err'); } finally { setSaving(false); }
  };
  void perm;
  return (
    <section className="admin-card mb-6 p-5 sm:p-6">
      <h2 className="text-2xl">{title}</h2>{sub && <p className="mb-4 mt-1 text-sm text-charcoal/60">{sub}</p>}
      <div className="mt-4"><Fields fields={fields} value={val} onChange={(n) => { setVal(n); onPreview?.(n); }} /></div>
      <div className="mt-5 flex justify-end"><button className="btn btn-solid btn-sm" onClick={save} disabled={saving}>{saving ? <Spinner /> : 'Save changes'}</button></div>
    </section>
  );
}

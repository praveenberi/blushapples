import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { BeforeAfter, ErrorNote, Modal, PageLoader, Spinner } from '../components/ui';
import { Bool, Confirm, Fields, MediaLibrary, PageHeader, ResourceManager, useLoad, useToast, type FieldDef } from './kit';
import { useUploadEditor } from '../components/UploadEditor';

/* ============================== Photo Studio ============================== */
interface Params {
  brightness: number; contrast: number; saturation: number; sharpness: number; exposure: number; temperature: number; tint: number; highlights: number; shadows: number;
  denoise: number; autoLevel: boolean; rotate: 0 | 90 | 180 | 270; intensity: 'subtle' | 'natural' | 'medium' | 'strong';
  crop?: { x: number; y: number; w: number; h: number };
}
const DEFAULTS: Params = { brightness: 0, contrast: 0, saturation: 0, sharpness: 0, exposure: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, denoise: 0, autoLevel: false, rotate: 0, intensity: 'natural' };
const SLIDERS: [keyof Params, string][] = [['exposure', 'Exposure'], ['brightness', 'Brightness'], ['contrast', 'Contrast'], ['highlights', 'Highlights'], ['shadows', 'Shadows'], ['saturation', 'Saturation'], ['temperature', 'Temperature'], ['tint', 'Tint'], ['sharpness', 'Sharpness']];
const AI_GROUPS: [string, [string, string][]][] = [
  ['Automatic', [['auto_enhance', 'Auto enhance'], ['upscale', 'Improve resolution'], ['denoise', 'Reduce noise']]],
  ['Beauty (natural)', [['skin_tone', 'Skin tone correction'], ['natural_retouch', 'Natural skin retouching'], ['blemish_removal', 'Blemish / acne spots'], ['under_eye', 'Under-eye correction'], ['reduce_shine', 'Reduce shine'], ['teeth_whitening', 'Teeth whitening'], ['flyaway_hair', 'Hair flyaways']]],
  ['Makeup', [['eye_makeup', 'Enhance eye makeup'], ['eyelashes', 'Eyelashes'], ['eyebrows', 'Eyebrows'], ['lipstick', 'Lipstick colour'], ['blush', 'Blush'], ['contour', 'Contour'], ['highlighter', 'Highlighter'], ['makeup_blend', 'Improve blending']]],
  ['Background', [['background_cleanup', 'Background cleanup'], ['object_removal', 'Remove objects'], ['background_blur', 'Blur background'], ['background_replace', 'Replace background'], ['studio_backdrop', 'Studio / luxury backdrop']]],
];
const ASPECTS: [string, number | null][] = [['Free', null], ['1:1', 1], ['4:5', 4 / 5], ['3:4', 3 / 4], ['16:9', 16 / 9]];

function PhotoStudio({ image, onSaved, onReverted }: { image: any; onSaved: () => void; onReverted: () => void }) {
  const toast = useToast();
  const caps = useLoad<{ available: boolean; provider: string }>('/admin/gallery/ai/capabilities');
  const presets = useLoad<any[]>('/admin/gallery/presets');
  const [p, setP] = useState<Params>(DEFAULTS);
  const [undo, setUndo] = useState<Params[]>([]);
  const [redo, setRedo] = useState<Params[]>([]);
  const [ai, setAi] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'slider' | 'side' | 'edited' | 'original'>('slider');
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState<number | null>(null);
  const [crop, setCrop] = useState({ zoom: 1, px: 0.5, py: 0.5 });
  const [cropOn, setCropOn] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const imgAspect = useMemo(() => { const a = (image.width || 4) / (image.height || 5); return p.rotate === 90 || p.rotate === 270 ? 1 / a : a; }, [image, p.rotate]);
  const cropRect = useMemo(() => {
    if (!cropOn) return undefined;
    const r = aspect ?? imgAspect;
    let w = 1, h = 1;
    if (imgAspect > r) w = r / imgAspect; else h = imgAspect / r;
    w /= crop.zoom; h /= crop.zoom;
    return { x: (1 - w) * crop.px, y: (1 - h) * crop.py, w, h };
  }, [cropOn, aspect, crop, imgAspect]);

  const payload = useMemo(() => {
    const { crop: _c, ...rest } = p; void _c;
    return { params: { ...rest, ...(cropRect && { crop: cropRect }) }, ...(ai.length && { ai: { features: ai } }) };
  }, [p, cropRect, ai]);

  // debounced server-side preview (the same pipeline that produces the saved file)
  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true); setErr(null);
      try {
        const blob = await api.blob(`/admin/gallery/${image.id}/edit/preview`, payload);
        if (id === seq.current) setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
      } catch (e) { if (id === seq.current) setErr(errorMessage(e)); } finally { if (id === seq.current) setBusy(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [payload, image.id]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, []); // eslint-disable-line

  const commit = (next: Params) => { setUndo((u) => [...u.slice(-49), p]); setRedo([]); setP(next); };
  const dirty = JSON.stringify(p) !== JSON.stringify(DEFAULTS) || ai.length > 0 || cropOn;
  const aspectRatio = `${Math.round(imgAspect * 1000)}/1000`;

  const save = async (modeSave: 'copy' | 'replace') => {
    setSaving(true);
    try { await api.post(`/admin/gallery/${image.id}/edit/save`, { ...payload, mode: modeSave, confirm: modeSave === 'replace' ? true : undefined }); toast(modeSave === 'copy' ? 'Saved as a new (hidden) gallery image' : 'Image replaced. Original is kept and can be restored.'); onSaved(); } catch (e) { toast(errorMessage(e), 'err'); } finally { setSaving(false); setConfirmReplace(false); }
  };
  const download = async () => {
    setSaving(true);
    try { const blob = await api.blob(`/admin/gallery/${image.id}/edit/download`, payload); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${image.title || 'image'}-enhanced.jpg`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); } catch (e) { toast(errorMessage(e), 'err'); } finally { setSaving(false); }
  };
  const savePreset = async () => {
    const name = prompt('Name for this preset');
    if (!name) return;
    const { crop: _c, rotate: _r, ...keep } = p; void _c; void _r;
    try { await api.post('/admin/gallery/presets', { name, params: keep }); toast('Preset saved'); presets.reload(); } catch (e) { toast(errorMessage(e), 'err'); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex border border-charcoal/15 bg-paper">{([['slider', 'Slider'], ['side', 'Side by side'], ['edited', 'Enhanced'], ['original', 'Original']] as const).map(([m, l]) => <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={`px-3 py-1.5 text-[11px] uppercase tracking-widest ${mode === m ? 'bg-charcoal text-paper' : ''}`}>{l}</button>)}</div>
          <div className="flex items-center gap-1 text-xs"><button className="btn btn-ghost btn-sm !px-2" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="Zoom out">−</button><span className="w-10 text-center">{Math.round(zoom * 100)}%</span><button className="btn btn-ghost btn-sm !px-2" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="Zoom in">+</button></div>
          <div className="ml-auto flex gap-1">
            <button className="btn btn-outline btn-sm" disabled={!undo.length} onClick={() => { setRedo((r) => [p, ...r]); setP(undo[undo.length - 1]); setUndo((u) => u.slice(0, -1)); }}>Undo</button>
            <button className="btn btn-outline btn-sm" disabled={!redo.length} onClick={() => { setUndo((u) => [...u, p]); setP(redo[0]); setRedo((r) => r.slice(1)); }}>Redo</button>
            <button className="btn btn-outline btn-sm" disabled={!dirty} onClick={() => { commit(DEFAULTS); setAi([]); setCropOn(false); }}>Reset</button></div>
        </div>
        <div className="relative overflow-auto bg-charcoal/5" style={{ maxHeight: '62vh' }}>
          <div style={{ width: `${zoom * 100}%`, margin: '0 auto' }} className="relative">
            {mode === 'slider' && preview ? <BeforeAfter before={image.original_url} after={preview} alt={image.title} ratio={aspectRatio} fit="contain" />
              : mode === 'side' ? <div className="grid grid-cols-2 gap-1"><img src={image.original_url} alt="Original" className="w-full" /><img src={preview || image.display_url} alt="Enhanced" className="w-full" /></div>
              : <img src={mode === 'original' ? image.original_url : preview || image.display_url} alt={mode} className="w-full" />}
            {busy && <div className="absolute right-2 top-2 flex items-center gap-2 bg-charcoal/75 px-2.5 py-1 text-[11px] text-white"><Spinner className="!h-3 !w-3" />Rendering</div>}
          </div>
        </div>
        <ErrorNote message={err} />
        <p className="mt-2 text-xs text-charcoal/50">Enhancements are always applied to your untouched original, so nothing is lost. Intensity: {p.intensity}.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-solid btn-sm" disabled={saving || !dirty} onClick={() => save('copy')}>{saving ? <Spinner /> : 'Save as new image'}</button>
          <button className="btn btn-outline btn-sm" disabled={saving || !dirty} onClick={() => setConfirmReplace(true)}>Replace this image…</button>
          <button className="btn btn-outline btn-sm" disabled={saving} onClick={download}>Download enhanced</button>
          {image.history?.some((h: any) => h.action === 'replace') && <button className="btn btn-ghost btn-sm" onClick={async () => { try { await api.post(`/admin/gallery/${image.id}/revert`); toast('Reverted to original'); onReverted(); } catch (e) { toast(errorMessage(e), 'err'); } }}>Revert to original</button>}
        </div>
      </div>

      <div className="space-y-5 text-sm lg:max-h-[78vh] lg:overflow-y-auto lg:pr-1">
        <section><p className="label">Presets</p>
          <div className="flex flex-wrap gap-1.5">{presets.data?.map((pr) => (
            <span key={pr.id} className="inline-flex"><button className="border border-charcoal/20 bg-paper px-2.5 py-1 text-xs hover:border-gold" onClick={() => commit({ ...DEFAULTS, ...pr.params, rotate: p.rotate })}>{pr.name}</button>
              {!pr.built_in && <button aria-label={`Delete preset ${pr.name}`} className="border border-l-0 border-charcoal/20 px-1.5 text-xs text-rose" onClick={async () => { await api.del(`/admin/gallery/presets/${pr.id}`); presets.reload(); }}>✕</button>}</span>))}</div>
          <button className="mt-2 text-xs text-gold underline" onClick={savePreset}>Save current settings as preset</button></section>
        <section><p className="label">Intensity</p>
          <div className="grid grid-cols-4 gap-1">{(['subtle', 'natural', 'medium', 'strong'] as const).map((i) => <button key={i} onClick={() => commit({ ...p, intensity: i })} aria-pressed={p.intensity === i} className={`border py-1.5 text-[11px] capitalize ${p.intensity === i ? 'border-charcoal bg-charcoal text-paper' : 'border-charcoal/20 bg-paper'}`}>{i}</button>)}</div>
          <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={p.autoLevel} onChange={(e) => commit({ ...p, autoLevel: e.target.checked })} />Auto lighting & colour balance</label></section>
        <section><p className="label">Adjustments</p>
          <div className="space-y-2.5">{SLIDERS.map(([k, l]) => (
            <div key={k}><div className="flex justify-between text-xs"><label htmlFor={`s-${k}`}>{l}</label><span className="tabular-nums text-charcoal/55">{p[k] as number}</span></div>
              <input id={`s-${k}`} type="range" min={-100} max={100} value={p[k] as number} onPointerDown={() => setUndo((u) => [...u.slice(-49), p])} onChange={(e) => { setRedo([]); setP({ ...p, [k]: Number(e.target.value) }); }} onDoubleClick={() => setP({ ...p, [k]: 0 })} className="w-full accent-[rgb(var(--c-gold))]" /></div>))}
            <div><div className="flex justify-between text-xs"><label htmlFor="s-dn">Noise reduction</label><span className="text-charcoal/55">{p.denoise}</span></div><input id="s-dn" type="range" min={0} max={100} value={p.denoise} onChange={(e) => setP({ ...p, denoise: Number(e.target.value) })} className="w-full accent-[rgb(var(--c-gold))]" /></div></div></section>
        <section><p className="label">Rotate & crop</p>
          <div className="flex gap-1"><button className="btn btn-outline btn-sm" onClick={() => commit({ ...p, rotate: ((p.rotate + 270) % 360) as Params['rotate'] })}>↺ 90°</button><button className="btn btn-outline btn-sm" onClick={() => commit({ ...p, rotate: ((p.rotate + 90) % 360) as Params['rotate'] })}>↻ 90°</button><button className={`btn btn-sm ${cropOn ? 'btn-solid' : 'btn-outline'}`} onClick={() => setCropOn(!cropOn)}>Crop</button></div>
          {cropOn && (<div className="mt-2 space-y-2"><div className="flex flex-wrap gap-1">{ASPECTS.map(([l, a]) => <button key={l} onClick={() => setAspect(a)} aria-pressed={aspect === a} className={`border px-2 py-1 text-xs ${aspect === a ? 'border-charcoal bg-charcoal text-paper' : 'border-charcoal/20 bg-paper'}`}>{l}</button>)}</div>
            {([['zoom', 'Zoom', 1, 4, 0.05], ['px', 'Position X', 0, 1, 0.01], ['py', 'Position Y', 0, 1, 0.01]] as const).map(([k, l, mn, mx, st]) => <div key={k}><label className="text-xs" htmlFor={`c-${k}`}>{l}</label><input id={`c-${k}`} type="range" min={mn} max={mx} step={st} value={crop[k]} onChange={(e) => setCrop({ ...crop, [k]: Number(e.target.value) })} className="w-full accent-[rgb(var(--c-gold))]" /></div>)}</div>)}</section>
        <section><p className="label">AI enhancement</p>
          {!caps.data?.available ? <p className="bg-nude/60 p-3 text-xs leading-relaxed text-charcoal/70">AI provider not configured. Manual tools above work fully. Set <code>AI_PROVIDER</code> in the server environment to unlock the options below.</p> : null}
          <fieldset disabled={!caps.data?.available} className={`space-y-3 ${caps.data?.available ? '' : 'opacity-45'}`}>{AI_GROUPS.map(([g, list]) => (
            <div key={g}><p className="mb-1 text-[11px] uppercase tracking-widest text-charcoal/50">{g}</p><div className="grid gap-1">{list.map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={ai.includes(k)} onChange={() => setAi(ai.includes(k) ? ai.filter((x) => x !== k) : [...ai, k])} />{l}</label>)}</div></div>))}</fieldset>
          <p className="mt-2 text-[11px] text-charcoal/50">AI requests preserve identity, facial structure, natural skin texture and your makeup style.</p></section>
      </div>
      <Confirm open={confirmReplace} confirmLabel="Replace image" message="Replace the gallery image with this enhanced version? Your original is kept and you can revert at any time." onNo={() => setConfirmReplace(false)} onYes={() => save('replace')} />
    </div>
  );
}

/* ============================== image editor modal ============================== */
function ImageEditor({ id, categories, albums, onClose, onChanged }: { id: number; categories: any[]; albums: any[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data, reload, error } = useLoad<any>(`/admin/gallery/${id}`);
  const [tab, setTab] = useState<'details' | 'studio'>('details');
  const [v, setV] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setV({ ...data, category_id: data.category_id == null ? '' : String(data.category_id), album_id: data.album_id == null ? '' : String(data.album_id) }); }, [data]);
  if (error) return <ErrorNote message={error} />;
  if (!data || !v) return <PageLoader />;
  const fields: FieldDef[] = [
    { key: 'title', label: 'Title', half: true }, { key: 'alt_text', label: 'SEO alt text', half: true, help: 'Describe the image for search engines and screen readers' },
    { key: 'description', label: 'Description', type: 'textarea' }, { key: 'tags', label: 'Tags', type: 'tags' },
    { key: 'category_id', label: 'Category', type: 'select', half: true, options: [['', 'None'], ...categories.map((c) => [String(c.id), c.name] as [string, string])] },
    { key: 'album_id', label: 'Album', type: 'select', half: true, options: [['', 'None'], ...albums.map((c) => [String(c.id), c.title] as [string, string])] },
    { key: 'status', label: 'Status', type: 'select', half: true, options: [['published', 'Published'], ['hidden', 'Hidden'], ['archived', 'Archived']] },
    { key: 'featured', label: 'Featured', type: 'bool', half: true, help: 'Show in featured areas' }, { key: 'allow_download', label: 'Downloads', type: 'bool', half: true, help: 'Allow visitors to download' },
    { key: 'before_url', label: '"Before" photo (enables the before/after slider)', type: 'image' },
  ];
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/gallery/${id}`, { title: v.title, alt_text: v.alt_text, description: v.description, tags: v.tags, status: v.status, featured: v.featured, allow_download: v.allow_download, before_url: v.before_url ?? null, category_id: v.category_id === '' ? null : Number(v.category_id), album_id: v.album_id === '' ? null : Number(v.album_id) });
      toast('Saved'); onChanged(); reload();
    } catch (e) { toast(errorMessage(e), 'err'); } finally { setSaving(false); }
  };
  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-charcoal/10">{([['details', 'Details'], ['studio', 'Photo studio']] as const).map(([t, l]) => <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-4 py-2 text-xs uppercase tracking-widest ${tab === t ? 'border-gold' : 'border-transparent text-charcoal/50'}`}>{l}</button>)}</div>
      {tab === 'details' ? (
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <div><img src={data.display_url} alt={data.alt_text} className="w-full" /><p className="mt-2 text-xs text-charcoal/50">{data.width}×{data.height} · {data.views} views</p>{data.is_demo && <span className="badge mt-1">Demo image</span>}</div>
          <div><Fields fields={fields} value={v} onChange={setV} /><div className="mt-5 flex justify-end gap-2"><button className="btn btn-outline btn-sm" onClick={onClose}>Close</button><button className="btn btn-solid btn-sm" onClick={save} disabled={saving}>{saving ? <Spinner /> : 'Save'}</button></div></div>
        </div>
      ) : <PhotoStudio image={data} onSaved={() => { onChanged(); setTab('details'); reload(); }} onReverted={() => { onChanged(); reload(); }} />}
    </div>
  );
}

/* ============================== library ============================== */
function Library() {
  const toast = useToast();
  const cats = useLoad<any[]>('/admin/gallery-categories');
  const albums = useLoad<any[]>('/admin/albums');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams({ ...(dq && { q: dq }), ...(cat && { category: cat }), ...(status && { status }) }).toString();
  const { data, setData, loading, error, reload } = useLoad<any[]>(`/admin/gallery?${qs}`);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number; pct: number } | null>(null);
  const [upCat, setUpCat] = useState('');
  const [upAlbum, setUpAlbum] = useState('');
  const [drag, setDrag] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { edit, editor } = useUploadEditor();

  const upload = useCallback(async (files: File[]) => {
    const imgs = files.filter((f) => /^image\/(jpeg|png|webp|avif)$/.test(f.type));
    if (imgs.length < files.length) toast(`${files.length - imgs.length} file(s) skipped (JPEG, PNG, WebP, AVIF only)`, 'err');
    if (!imgs.length) return;
    const ready = await edit(imgs);
    if (!ready.length) return;
    const batches: File[][] = []; for (let i = 0; i < ready.length; i += 5) batches.push(ready.slice(i, i + 5));
    let done = 0; const errors: string[] = [];
    setUploading({ done: 0, total: imgs.length, pct: 0 });
    for (const b of batches) {
      try {
        const r = await api.upload('/admin/gallery/upload', b, { category_id: upCat || undefined, album_id: upAlbum || undefined }, (p) => setUploading({ done, total: imgs.length, pct: (done + p * b.length) / imgs.length }));
        r.errors?.forEach((e: any) => errors.push(`${e.file}: ${e.error}`));
      } catch (e) { errors.push(errorMessage(e)); }
      done += b.length; setUploading({ done, total: imgs.length, pct: done / imgs.length });
    }
    setUploading(null); reload();
    errors.length ? toast(errors.slice(0, 2).join(' | '), 'err') : toast(`${imgs.length} image(s) uploaded`);
  }, [upCat, upAlbum, reload, toast, edit]);

  const bulk = async (action: string, extra: object = {}) => {
    try { await api.post('/admin/gallery/bulk', { ids: [...sel], action, ...extra }); toast('Done'); setSel(new Set()); reload(); } catch (e) { toast(errorMessage(e), 'err'); }
  };
  const canReorder = !dq && !cat && !status;
  const dropOn = async (targetId: number) => {
    if (dragId == null || dragId === targetId || !data) return;
    const list = data.filter((x) => x.id !== dragId); const at = list.findIndex((x) => x.id === targetId);
    list.splice(at, 0, data.find((x) => x.id === dragId)!);
    setData(list); setDragId(null);
    try { await api.post('/admin/gallery/reorder', { ids: list.map((x) => x.id) }); } catch (e) { toast(errorMessage(e), 'err'); reload(); }
  };
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div>
      <div onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) upload(Array.from(e.dataTransfer.files)); }}
        className={`mb-5 border-2 border-dashed p-6 text-center transition-colors ${drag ? 'border-gold bg-gold/10' : 'border-charcoal/20 bg-paper'}`}>
        <input ref={fileRef} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e) => { upload(Array.from(e.target.files || [])); e.target.value = ''; }} />
        {uploading ? (<div role="status"><p className="text-sm">Uploading {Math.min(uploading.done + 1, uploading.total)} of {uploading.total}…</p><div className="mx-auto mt-3 h-1.5 max-w-sm overflow-hidden bg-nude"><motion.div className="h-full bg-gold" animate={{ width: `${uploading.pct * 100}%` }} /></div></div>) : (<>
          <p className="font-heading text-2xl">Drag & drop photos here</p><p className="mt-1 text-xs text-charcoal/55">JPEG, PNG, WebP or AVIF, up to 15MB each. Thumbnails and web versions are generated automatically; your original is preserved.</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2"><select aria-label="Upload into category" className="input !w-auto !py-1.5 text-xs" value={upCat} onChange={(e) => setUpCat(e.target.value)}><option value="">Category: none</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select aria-label="Upload into album" className="input !w-auto !py-1.5 text-xs" value={upAlbum} onChange={(e) => setUpAlbum(e.target.value)}><option value="">Album: none</option>{albums.data?.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
            <button className="btn btn-solid btn-sm" onClick={() => fileRef.current?.click()}>Choose files</button></div></>)}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input type="search" aria-label="Search gallery" placeholder="Search title, tags, alt text" className="input !w-60 !py-2" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-auto !py-2" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="input !w-auto !py-2" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option><option value="published">Published</option><option value="hidden">Hidden</option><option value="archived">Archived</option></select>
        {data && <button className="btn btn-ghost btn-sm" onClick={() => setSel(sel.size === data.length ? new Set() : new Set(data.map((d) => d.id)))}>{sel.size === data.length && data.length ? 'Clear selection' : 'Select all'}</button>}
        {!canReorder && <span className="text-xs text-charcoal/45">Clear filters to drag-reorder</span>}
      </div>
      {sel.size > 0 && (<div className="sticky top-14 z-20 mb-4 flex flex-wrap items-center gap-1.5 border border-gold/40 bg-paper p-2 text-xs lg:top-2"><strong className="px-2">{sel.size} selected</strong>
        {[['publish', 'Publish'], ['hide', 'Hide'], ['archive', 'Archive'], ['feature', 'Feature'], ['unfeature', 'Unfeature']].map(([a, l]) => <button key={a} className="btn btn-outline btn-sm" onClick={() => bulk(a)}>{l}</button>)}
        <select aria-label="Move to category" className="input !w-auto !py-1.5 text-xs" value="" onChange={(e) => e.target.value && bulk('category', { category_id: e.target.value === '0' ? null : Number(e.target.value) })}><option value="">Move to category…</option><option value="0">No category</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="btn btn-outline btn-sm !text-rose" onClick={() => setConfirmDel(true)}>Delete</button></div>)}
      <ErrorNote message={error} />
      {loading ? <PageLoader /> : !data?.length ? <div className="admin-card p-10 text-center text-charcoal/60">No images match. Drop some photos above to get started.</div> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {data.map((g) => (
            <motion.div layout key={g.id} draggable={canReorder} onDragStart={() => setDragId(g.id)} onDragOver={(e) => canReorder && dragId != null && e.preventDefault()} onDrop={(e) => { if (dragId != null) { e.stopPropagation(); dropOn(g.id); } }}
              className={`admin-card group relative overflow-hidden ${dragId === g.id ? 'opacity-40' : ''} ${sel.has(g.id) ? 'ring-2 ring-gold' : ''}`}>
              <button className="block w-full" onClick={() => setOpen(g.id)} aria-label={`Edit ${g.title}`}><img src={g.thumb_url} alt={g.alt_text || g.title} loading="lazy" className={`aspect-[4/5] w-full object-cover ${g.status !== 'published' ? 'opacity-55' : ''}`} /></button>
              <label className="absolute left-1.5 top-1.5 grid h-6 w-6 cursor-pointer place-items-center bg-paper/90"><input type="checkbox" checked={sel.has(g.id)} onChange={() => toggle(g.id)} aria-label={`Select ${g.title}`} /></label>
              <div className="absolute right-1.5 top-1.5 flex flex-col items-end gap-1">{g.featured && <span className="bg-gold px-1.5 text-[10px] text-paper">★</span>}{g.status !== 'published' && <span className="bg-charcoal/80 px-1.5 text-[10px] capitalize text-paper">{g.status}</span>}{g.is_demo && <span className="bg-paper/90 px-1.5 text-[10px]">Demo</span>}</div>
              <div className="p-2"><p className="truncate text-xs font-medium">{g.title || 'Untitled'}</p><p className="truncate text-[11px] text-charcoal/50">{g.category_name || 'No category'}</p></div>
            </motion.div>))}
        </div>)}
      <Modal open={open !== null} onClose={() => setOpen(null)} title="Image" wide>{open !== null && <ImageEditor id={open} categories={cats.data || []} albums={albums.data || []} onClose={() => setOpen(null)} onChanged={reload} />}</Modal>
      {editor}
      <Confirm open={confirmDel} message={`Delete ${sel.size} image(s) from the gallery?`} onNo={() => setConfirmDel(false)} onYes={() => { setConfirmDel(false); bulk('delete'); }} />
    </div>
  );
}

export default function GalleryAdmin() {
  const [tab, setTab] = useState<'images' | 'uploads' | 'categories' | 'albums'>('images');
  return (
    <div>
      <PageHeader title="Gallery & Photo Studio" sub="Open any image to edit its details or enhance it in the Photo studio." />
      <div className="mb-5 flex gap-1 border-b border-charcoal/10">{(['images', 'uploads', 'categories', 'albums'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-4 py-2 text-xs uppercase tracking-widest ${tab === t ? 'border-gold' : 'border-transparent text-charcoal/50'}`}>{t}</button>)}</div>
      {tab === 'images' && <Library />}
      {tab === 'uploads' && <UploadsTab />}
      {tab === 'categories' && <ResourceManager title="Category" endpoint="/admin/gallery-categories" reorderable blank={{ name: '', slug: '', visible: true }}
        fields={[{ key: 'name', label: 'Name', required: true, half: true }, { key: 'slug', label: 'URL slug', half: true }, { key: 'visible', label: 'Visibility', type: 'bool', help: 'Shown as a filter on the website' }]}
        columns={[{ label: 'Name', render: (r) => r.name }, { label: 'Visible', render: (r) => <Bool v={r.visible} /> }]} />}
      {tab === 'albums' && <ResourceManager title="Album" endpoint="/admin/albums" reorderable blank={{ title: '', slug: '', description: '', cover_url: null, visible: true }}
        fields={[{ key: 'title', label: 'Title', required: true, half: true }, { key: 'slug', label: 'URL slug', half: true }, { key: 'description', label: 'Description', type: 'textarea' }, { key: 'cover_url', label: 'Cover image', type: 'image' }, { key: 'visible', label: 'Visibility', type: 'bool', help: 'Shown on website' }]}
        columns={[{ label: 'Cover', render: (r) => r.cover_url ? <img src={r.cover_url} alt="" className="h-10 w-10 object-cover" /> : '-' }, { label: 'Title', render: (r) => r.title }, { label: 'Visible', render: (r) => <Bool v={r.visible} /> }]} />}
    </div>
  );
}

function UploadsTab() {
  const [open, setOpen] = useState(false);
  return (
    <div className="admin-card p-8 text-center">
      <p className="font-heading text-2xl">Uploaded images</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-charcoal/60">Images you upload for the hero, logo, services, offers and more are kept here. See what is in use and delete the ones you no longer need.</p>
      <button className="btn btn-solid btn-sm mt-5" onClick={() => setOpen(true)}>Open media library</button>
      <MediaLibrary open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

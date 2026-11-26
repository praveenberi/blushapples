import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { applyAdjust, autoAdjust, cropBox, isNeutral, NO_ADJUST, type Adjust } from '../lib/imageAdjust';
import { Spinner } from './ui';

const ASPECTS: [string, number | null][] = [['Original', null], ['Square 1:1', 1], ['Portrait 4:5', 4 / 5], ['Portrait 3:4', 3 / 4], ['Landscape 4:3', 4 / 3], ['Landscape 3:2', 3 / 2], ['Wide 16:9', 16 / 9]];
const SLIDERS: [keyof Adjust, string, number, number][] = [['brightness', 'Brightness', -50, 50], ['contrast', 'Contrast', -50, 50], ['saturation', 'Colour', -50, 50], ['warmth', 'Warmth', -50, 50], ['sharpen', 'Sharpness', 0, 100]];
const MAX_SOURCE = 4000, MAX_OUTPUT = 2400, PREVIEW_W = 720, PREVIEW_H = 460;

type Choice = { file: File; allOriginal?: boolean } | null; // null = cancelled

const canvasOf = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

function rotated(img: HTMLImageElement, turns: number) {
  const scale = Math.min(1, MAX_SOURCE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale, side = turns % 2 === 1;
  const c = canvasOf(side ? h : w, side ? w : h), x = c.getContext('2d')!;
  x.translate(c.width / 2, c.height / 2); x.rotate((turns * Math.PI) / 2); x.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

/** Draws the cropped, adjusted picture into `target` at the given size. */
function paint(target: HTMLCanvasElement, src: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number }, outW: number, outH: number, adj: Adjust) {
  target.width = Math.max(1, Math.round(outW)); target.height = Math.max(1, Math.round(outH));
  const x = target.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, target.width, target.height);
  if (!isNeutral(adj)) { const d = x.getImageData(0, 0, target.width, target.height); applyAdjust(d.data, target.width, target.height, adj); x.putImageData(d, 0, 0); }
}

function EditorDialog({ file, position, total, onDone }: { file: File; position: number; total: number; onDone: (c: Choice) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [turns, setTurns] = useState(0);
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  const [aspect, setAspect] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [centre, setCentre] = useState({ x: 0.5, y: 0.5 }); // fraction of the rotated image
  const [adj, setAdj] = useState<Adjust>(NO_ADJUST);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const view = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file), i = new Image();
    i.onload = () => setImg(i); i.onerror = () => setFailed(true); i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => { if (img) setSrc(rotated(img, turns)); }, [img, turns]);

  // Escape closes only this editor, not an admin dialog underneath it.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onDone(null); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onDone]);

  const box = src ? cropBox(src.width, src.height, ASPECTS[aspect][1], zoom, centre.x * src.width, centre.y * src.height) : null;
  const fit = box ? Math.min(PREVIEW_W / box.w, PREVIEW_H / box.h) : 1;

  useEffect(() => {
    if (!src || !box || !view.current) return;
    const frame = requestAnimationFrame(() => view.current && paint(view.current, src, box, box.w * fit, box.h * fit, compare ? NO_ADJUST : adj));
    return () => cancelAnimationFrame(frame);
  }, [src, box?.x, box?.y, box?.w, box?.h, fit, adj, compare]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current || !box || !src) return;
    const scale = box.w / e.currentTarget.clientWidth;
    const dx = (e.clientX - drag.current.x) * scale, dy = (e.clientY - drag.current.y) * scale;
    drag.current = { x: e.clientX, y: e.clientY };
    setCentre({ x: (box.x + box.w / 2 - dx) / src.width, y: (box.y + box.h / 2 - dy) / src.height });
  };

  const auto = () => {
    if (!src || !box) return;
    const c = canvasOf(1, 1); paint(c, src, box, 200, (200 * box.h) / box.w, NO_ADJUST);
    setAdj(autoAdjust(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data));
  };

  const reset = () => { setTurns(0); setAspect(0); setZoom(1); setCentre({ x: 0.5, y: 0.5 }); setAdj(NO_ADJUST); };
  const untouched = turns === 0 && aspect === 0 && zoom === 1 && isNeutral(adj);

  const apply = async () => {
    if (untouched || !src || !box) return onDone({ file });
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30)); // let the spinner show before the heavy work
    const scale = Math.min(1, MAX_OUTPUT / Math.max(box.w, box.h));
    const out = canvasOf(1, 1); paint(out, src, box, box.w * scale, box.h * scale, adj);
    // Keep transparency (logos) as PNG; everything else is saved as a compact JPEG.
    let alpha = false;
    if (file.type !== 'image/jpeg') {
      const d = out.getContext('2d')!.getImageData(0, 0, out.width, out.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { alpha = true; break; }
    }
    const type = alpha ? 'image/png' : 'image/jpeg';
    out.toBlob((blob) => {
      setBusy(false);
      if (!blob) return setFailed(true);
      onDone({ file: new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-edited.${alpha ? 'png' : 'jpg'}`, { type }) });
    }, type, 0.92);
  };

  const small = 'border px-3 py-1.5 text-xs transition-colors';
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-charcoal/70 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Crop and enhance image">
      <div className="flex max-h-[94vh] w-full flex-col bg-ivory text-left shadow-2xl sm:max-w-5xl">
        <div className="flex items-center justify-between border-b border-charcoal/10 px-4 py-3">
          <div className="min-w-0"><h3 className="font-heading text-2xl">Crop & enhance</h3><p className="truncate text-xs text-charcoal/55">{total > 1 ? `Image ${position} of ${total} · ` : ''}{file.name}</p></div>
          <button type="button" onClick={() => onDone(null)} aria-label="Cancel upload" className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-nude">✕</button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[1fr_280px]">
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 bg-charcoal/90 p-3">
            {failed ? <p className="p-6 text-center text-sm text-white">This image can't be edited in your browser. You can still use the original.</p>
              : !src ? <Spinner />
              : <canvas ref={view} className="max-h-[52vh] max-w-full cursor-move touch-none select-none" aria-label="Preview. Drag to reposition the crop."
                  onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }}
                  onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)} />}
            {src && <p className="text-[11px] text-white/60">Drag the photo to choose what stays in the frame.</p>}
          </div>
          <div className="space-y-4">
            <div><p className="label">Crop shape</p><div className="flex flex-wrap gap-1.5">{ASPECTS.map(([label], i) => <button key={label} type="button" aria-pressed={aspect === i} onClick={() => setAspect(i)} className={`${small} ${aspect === i ? 'border-charcoal bg-charcoal text-paper' : 'border-charcoal/20 bg-paper hover:border-gold'}`}>{label}</button>)}</div></div>
            <label className="block text-xs">Zoom<input type="range" min={1} max={4} step={0.02} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-[rgb(var(--c-gold))]" /></label>
            <button type="button" className={`${small} border-charcoal/20 bg-paper hover:border-gold`} onClick={() => { setTurns((t) => (t + 1) % 4); setCentre({ x: 0.5, y: 0.5 }); }}>↻ Rotate</button>
            <div className="border-t border-charcoal/10 pt-3">
              <div className="mb-2 flex items-center justify-between"><p className="label !mb-0">Enhance</p><button type="button" className="btn btn-gold btn-sm" onClick={auto} disabled={!src}>✨ Auto enhance</button></div>
              {SLIDERS.map(([key, label, min, max]) => <label key={key} className="block text-xs"><span className="flex justify-between"><span>{label}</span><span className="text-charcoal/50">{adj[key]}</span></span>
                <input type="range" min={min} max={max} value={adj[key]} onChange={(e) => setAdj((a) => ({ ...a, [key]: Number(e.target.value) }))} className="w-full accent-[rgb(var(--c-gold))]" /></label>)}
              <div className="mt-2 flex gap-1.5">
                <button type="button" className={`${small} border-charcoal/20 bg-paper`} onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)}>Hold to compare</button>
                <button type="button" className={`${small} border-charcoal/20 bg-paper hover:border-gold`} onClick={reset}>Reset</button>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-charcoal/10 px-4 py-3">
          <button type="button" className="btn btn-ghost btn-sm mr-auto" onClick={() => onDone(null)}>Cancel</button>
          {total - position > 0 && <button type="button" className="btn btn-outline btn-sm" onClick={() => onDone({ file, allOriginal: true })}>Use originals for the rest</button>}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onDone({ file })}>Use original</button>
          <button type="button" className="btn btn-solid btn-sm" onClick={apply} disabled={busy || failed || !src}>{busy ? <Spinner /> : 'Apply & use'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Loads an already-uploaded image back into a File so it can be edited again. */
export function urlToFile(url: string) {
  return new Promise<File>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => {
      const c = canvasOf(i.naturalWidth, i.naturalHeight); c.getContext('2d')!.drawImage(i, 0, 0);
      c.toBlob((b) => (b ? resolve(new File([b], url.split('/').pop()?.split('?')[0] || 'image.png', { type: 'image/png' })) : reject(new Error('Could not read this image'))), 'image/png');
    };
    i.onerror = () => reject(new Error('Could not load this image for editing'));
    // The extra parameter avoids reusing a cached copy that was fetched without cross-origin permission.
    i.src = url + (url.includes('?') ? '&' : '?') + 'edit=1';
  });
}

/**
 * Use before any upload: `const files = await edit(picked)`.
 * Each image opens in the editor in turn. An empty result means the person cancelled.
 * Render `editor` somewhere in the component.
 */
export function useUploadEditor(): { edit: (files: File[]) => Promise<File[]>; editor: ReactNode } {
  const [job, setJob] = useState<{ file: File; position: number; total: number; done: (c: Choice) => void } | null>(null);
  const edit = useCallback(async (files: File[]) => {
    const out: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const choice = await new Promise<Choice>((done) => setJob({ file: files[i], position: i + 1, total: files.length, done }));
      if (!choice) { setJob(null); return []; }
      if (choice.allOriginal) { out.push(...files.slice(i)); break; }
      out.push(choice.file);
    }
    setJob(null);
    return out;
  }, []);
  return { edit, editor: job ? <EditorDialog key={`${job.position}-${job.file.name}`} file={job.file} position={job.position} total={job.total} onDone={job.done} /> : null };
}

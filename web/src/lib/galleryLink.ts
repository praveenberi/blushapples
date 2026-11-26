import { useEffect, useState } from 'react';
import { api } from './api';

export type GalleryCat = { name: string; slug: string };

// Service categories and gallery categories are managed separately, so they are matched by name,
// ignoring the word "makeup": the "Bridal Makeup" service category matches the "Bridal" gallery.
const norm = (v: string) => v.toLowerCase().replace(/\bmakeup\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** The first name (most specific first) that matches a gallery category. */
export function matchGalleryCat(names: (string | undefined)[], cats: GalleryCat[]) {
  for (const n of names) {
    const key = n ? norm(n) : '';
    const hit = key && cats.find((c) => norm(c.name) === key);
    if (hit) return hit;
  }
  return undefined;
}

let cache: Promise<GalleryCat[]> | null = null;
/** Gallery categories that have at least one published image, so no button leads to an empty page. */
function loadCats() {
  cache ??= api.get('/public/gallery')
    .then((d: any) => {
      const used = new Set(d.items.map((i: any) => i.category_slug));
      return (d.categories as GalleryCat[]).filter((c) => used.has(c.slug));
    })
    .catch(() => { cache = null; return []; });
  return cache;
}

export function useGalleryCats() {
  const [cats, setCats] = useState<GalleryCat[]>([]);
  useEffect(() => { let live = true; loadCats().then((c) => live && setCats(c)); return () => { live = false; }; }, []);
  return cats;
}

export const galleryHref = (cat?: GalleryCat) => (cat ? `/portfolio?category=${cat.slug}` : '/portfolio');

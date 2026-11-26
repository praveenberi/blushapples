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
function loadCats() {
  cache ??= api.get('/public/gallery')
    .then((d: any) => d.categories as GalleryCat[])
    .catch(() => { cache = null; return []; });
  return cache;
}

export function useGalleryCats() {
  const [cats, setCats] = useState<GalleryCat[]>([]);
  useEffect(() => { let live = true; loadCats().then((c) => live && setCats(c)); return () => { live = false; }; }, []);
  return cats;
}

const slugify = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Always filtered to the selected category. With no matching gallery category the portfolio shows
 * "no photos yet" for it instead of every photo. Only with no category at all does it show everything.
 */
export const galleryHref = (cat?: GalleryCat, categoryName?: string) => {
  const slug = cat?.slug || slugify(categoryName || '');
  return slug ? `/portfolio?category=${slug}` : '/portfolio';
};

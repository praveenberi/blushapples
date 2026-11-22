CREATE TABLE media_assets (
  id serial PRIMARY KEY,
  url text NOT NULL,
  thumb_url text NOT NULL,
  original_url text,
  storage_key text NOT NULL,
  filename text NOT NULL DEFAULT '',
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX media_assets_url_idx ON media_assets(url);

-- backfill: images already used by home/about sections and brand settings, uploaded before this table existed
INSERT INTO media_assets(url, thumb_url, storage_key, filename)
SELECT DISTINCT u, replace(u, '.webp', '-thumb.webp'), regexp_replace(substring(u from 'assets/[^/.]+'), '\.$', ''), 'existing image'
FROM (
  SELECT content->>'image' AS u FROM page_sections
  UNION SELECT jsonb_array_elements_text(content->'images') FROM page_sections WHERE jsonb_typeof(content->'images') = 'array'
  UNION SELECT value->>'logo' FROM website_settings WHERE key = 'brand'
) t
WHERE u IS NOT NULL AND u <> '' AND u LIKE '%/assets/%' AND u LIKE '%.webp'
ON CONFLICT DO NOTHING

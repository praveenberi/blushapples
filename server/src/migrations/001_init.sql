-- Blush & Apples initial schema. Plain Postgres; runs on PGlite (dev/test) and pg (prod).

CREATE TABLE roles (
  id serial PRIMARY KEY,
  name text UNIQUE NOT NULL,
  label text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE users (
  id serial PRIMARY KEY,
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  role_id integer NOT NULL REFERENCES roles(id),
  active boolean NOT NULL DEFAULT true,
  reset_token_hash text,
  reset_expires timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- key/value site configuration (brand, theme, contact, booking, whatsapp, seo defaults, faqs, policies...)
CREATE TABLE website_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pages (
  id serial PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  seo_title text, seo_description text, seo_keywords text,
  og_image text, og_title text, og_description text,
  canonical_url text, robots text NOT NULL DEFAULT 'index,follow',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE page_sections (
  id serial PRIMARY KEY,
  page text NOT NULL,
  type text NOT NULL,
  name text NOT NULL DEFAULT '',
  content jsonb NOT NULL DEFAULT '{}',
  visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX page_sections_page_idx ON page_sections(page, sort_order);

CREATE TABLE navigation_items (
  id serial PRIMARY KEY,
  label text NOT NULL,
  href text NOT NULL,
  area text NOT NULL DEFAULT 'header',
  visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE service_categories (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text NOT NULL DEFAULT '',
  visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE services (
  id serial PRIMARY KEY,
  category_id integer REFERENCES service_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text NOT NULL DEFAULT '',
  price_cents integer NOT NULL DEFAULT 0,
  price_type text NOT NULL DEFAULT 'fixed' CHECK (price_type IN ('fixed','starting_from','custom')),
  duration_min integer NOT NULL DEFAULT 60,
  included jsonb NOT NULL DEFAULT '[]',
  image_url text,
  gallery jsonb NOT NULL DEFAULT '[]',
  available boolean NOT NULL DEFAULT true,
  bookable boolean NOT NULL DEFAULT true,
  featured boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX services_cat_idx ON services(category_id);

CREATE TABLE service_addons (
  id serial PRIMARY KEY,
  service_id integer NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  duration_min integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE gallery_categories (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE gallery_albums (
  id serial PRIMARY KEY,
  title text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text NOT NULL DEFAULT '',
  cover_url text,
  visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE gallery_images (
  id serial PRIMARY KEY,
  category_id integer REFERENCES gallery_categories(id) ON DELETE SET NULL,
  album_id integer REFERENCES gallery_albums(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  alt_text text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]',
  storage_key text NOT NULL,
  url text NOT NULL,
  display_url text NOT NULL,
  thumb_url text NOT NULL,
  original_url text NOT NULL,
  before_url text,
  width integer, height integer,
  featured boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden','archived')),
  allow_download boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  views integer NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX gallery_images_cat_idx ON gallery_images(category_id);
CREATE INDEX gallery_images_status_idx ON gallery_images(status, sort_order);

CREATE TABLE enhancement_presets (
  id serial PRIMARY KEY,
  name text UNIQUE NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  built_in boolean NOT NULL DEFAULT false
);

CREATE TABLE image_edits (
  id serial PRIMARY KEY,
  image_id integer NOT NULL REFERENCES gallery_images(id) ON DELETE CASCADE,
  result_image_id integer REFERENCES gallery_images(id) ON DELETE SET NULL,
  params jsonb NOT NULL DEFAULT '{}',
  provider text NOT NULL DEFAULT 'manual',
  mode text NOT NULL DEFAULT 'copy',
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE image_edit_history (
  id serial PRIMARY KEY,
  image_id integer NOT NULL REFERENCES gallery_images(id) ON DELETE CASCADE,
  action text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}',
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text,
  phone text,
  whatsapp text,
  tags jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX customers_email_idx ON customers(lower(email));
CREATE INDEX customers_phone_idx ON customers(phone);

CREATE TABLE customer_notes (
  id serial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id serial PRIMARY KEY,
  reference text UNIQUE NOT NULL,
  customer_id integer REFERENCES customers(id),
  status text NOT NULL DEFAULT 'new' CHECK (status IN
    ('new','pending_confirmation','confirmed','deposit_requested','deposit_paid','in_progress','completed','cancelled','rejected')),
  booking_date text NOT NULL,           -- YYYY-MM-DD in business timezone
  start_min integer NOT NULL,           -- minutes after midnight
  end_min integer NOT NULL,             -- service end
  block_end_min integer NOT NULL,       -- end including buffer/travel
  location_type text NOT NULL DEFAULT 'studio' CHECK (location_type IN ('studio','client_home','hotel','event_venue','other')),
  venue text NOT NULL DEFAULT '',
  people_count integer NOT NULL DEFAULT 1,
  hairstyling text NOT NULL DEFAULT '',
  special_requests text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  reference_images jsonb NOT NULL DEFAULT '[]',
  total_cents integer NOT NULL DEFAULT 0,
  promo_code text,
  assigned_to text NOT NULL DEFAULT '',
  internal_notes text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'website',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX bookings_date_idx ON bookings(booking_date, status);
CREATE INDEX bookings_customer_idx ON bookings(customer_id);

CREATE TABLE booking_services (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id integer REFERENCES services(id) ON DELETE SET NULL,
  name text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  duration_min integer NOT NULL DEFAULT 0
);

CREATE TABLE booking_addons (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  addon_id integer REFERENCES service_addons(id) ON DELETE SET NULL,
  name text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  duration_min integer NOT NULL DEFAULT 0
);

CREATE TABLE business_hours (
  weekday integer PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  closed boolean NOT NULL DEFAULT false,
  open_min integer NOT NULL DEFAULT 540,
  close_min integer NOT NULL DEFAULT 1080
);

CREATE TABLE blocked_dates (
  id serial PRIMARY KEY,
  date text NOT NULL,
  end_date text,
  reason text NOT NULL DEFAULT '',
  is_holiday boolean NOT NULL DEFAULT false
);

CREATE TABLE testimonials (
  id serial PRIMARY KEY,
  customer_name text NOT NULL,
  image_url text,
  review text NOT NULL,
  rating integer NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  service_category text NOT NULL DEFAULT '',
  review_date text,
  approved boolean NOT NULL DEFAULT false,
  featured boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE promotions (
  id serial PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  banner_url text,
  start_date text, end_date text,
  discount_type text NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','fixed','none')),
  discount_value integer NOT NULL DEFAULT 0,
  promo_code text,
  terms text NOT NULL DEFAULT '',
  cta_label text NOT NULL DEFAULT 'Book now',
  cta_href text NOT NULL DEFAULT '/book',
  visible boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE inquiries (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  service_interest text NOT NULL DEFAULT '',
  event_date text,
  message text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','replied','closed','spam')),
  internal_notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE social_links (
  id serial PRIMARY KEY,
  platform text NOT NULL,
  url text NOT NULL,
  username text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT '',
  visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE notification_templates (
  key text PRIMARY KEY,
  audience text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE notification_logs (
  id serial PRIMARY KEY,
  channel text NOT NULL,
  template_key text,
  recipient text,
  status text NOT NULL,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analytics_events (
  id bigserial PRIMARY KEY,
  type text NOT NULL,
  path text NOT NULL DEFAULT '',
  ref_id text,
  visitor text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_type_idx ON analytics_events(type, created_at);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  user_email text,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

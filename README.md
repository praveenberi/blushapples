# Blush & Apples: makeup artist portfolio, booking & CMS

React + TypeScript + Tailwind + Motion on the front end; Node/Express + TypeScript on the API; PostgreSQL.
Everything on the public site is driven from the admin dashboard.

## Quick start (no database install needed)

```powershell
npm install
npm run dev
```

- Website: http://localhost:5173
- Admin: http://localhost:5173/admin
- API: http://localhost:4000

On first start the server runs migrations, creates the admin user and seeds clearly-labelled **demo content**
(18 service categories, 12 services, 20 placeholder gallery images, 6 demo testimonials, 2 demo promotions, FAQs).

**Admin login:** the email is `ADMIN_EMAIL` (default `admin@example.com`). If `ADMIN_PASSWORD` is not set,
a strong random password is generated and **printed once** in the server log. Copy `.env.example` to `.env` to configure.
To start over: stop the server and delete `server/data` and `server/uploads`.

In development the database is embedded **PGlite** (real Postgres compiled to WASM, stored in `server/data/pglite`).
Setting `DATABASE_URL` switches to standard PostgreSQL with the same SQL and migrations.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (4000) + web (5173) with hot reload |
| `npm test` | API integration tests (19 tests, in-memory Postgres) |
| `npm run build` | Compile server, build web into `web/dist` |
| `npm start` | Run the compiled server; serves `web/dist` too |
| `npm run migrate` / `npm run seed` | Apply migrations / seed (idempotent) |

## What is implemented

**Public site**: home built from admin-ordered sections (hero with parallax, featured looks, services, before/after sliders,
story, testimonials, offers, Instagram/YouTube, contact), About, Services (category filter, price types, WhatsApp enquiry
per service with pre-filled message), Portfolio (categories, albums, search, sort, masonry, lazy images, lightbox with swipe,
share, optional download, before/after), Offers, Contact (validated form, reference photos, honeypot, rate limit, FAQ, hours, map),
policy pages. Floating WhatsApp button (position, colour, online indicator), sticky mobile book/call bar, click-to-call, click-to-WhatsApp.

**Booking**: 6-step flow (service, add-ons, date/time with live availability, details, event/location, review + promo code)
then confirmation. Availability honours working hours, blocked dates/holidays, lead time, max advance, buffer and travel time.
Double-booking is prevented inside a database transaction with a table lock (tested with concurrent requests).

**Admin**: dashboard; bookings (list, month/week/day calendar with drag-to-reschedule, status workflow, reschedule, change services,
internal notes, manual bookings); services (CRUD, add-ons, duplicate, hide, drag-reorder, categories); gallery (drag-drop bulk upload with progress,
categories, albums, tags, alt text, featured, bulk actions, drag-reorder, before photo); **Photo studio** (see below); website content
(home/about sections with reorder + visibility, navigation, brand, footer, FAQs, policies); testimonials; promotions with promo codes;
social links; inquiries; customers (history, tags, notes); analytics; users and roles; audit log; settings (contact, regional, theme with
desktop/tablet/mobile preview, booking rules, working hours, blocked dates, WhatsApp, email templates, SEO per page, GA4).

**Security**: bcrypt passwords, signed httpOnly session cookie, CSRF double-submit token on every state-changing admin request,
server-side permission checks per route (admin / editor / booking manager / gallery manager), rate-limited login/reset, parameterised SQL,
zod validation on every input, helmet + CSP, upload validation by decoding the image (not the declared type), audit log, secrets only in env.

## Photo studio

Open any gallery image, then **Photo studio**. Works on your untouched original, so nothing is ever lost.

- Always available (no AI key): exposure, brightness, contrast, highlights, shadows, saturation, temperature, tint, sharpness,
  noise reduction, auto levels, rotate, crop (aspect presets, zoom, position), 10 built-in presets + your own, 4 intensity levels,
  slider / side-by-side / original / enhanced comparison, zoom, undo/redo/reset.
- Save as a new (hidden) image, **replace after confirmation**, download full-resolution, or **revert to original**.
- AI features (skin, makeup, background...) are exposed through a provider abstraction (`server/src/lib/ai.ts`). Set `AI_PROVIDER=http`,
  `AI_PROVIDER_URL`, `AI_PROVIDER_KEY` to a service that accepts `{image(base64), options}` and returns an image. Every request carries
  identity-preservation / natural-skin constraints. Until configured, the AI checkboxes are disabled and explained in the UI.

## Configuration (see `.env.example`)

- **Images**: `STORAGE_PROVIDER=local` for development. Use `cloudinary` in production (signed server-side uploads, credentials never reach the browser).
  Add another provider by implementing `StorageProvider` in `server/src/lib/storage.ts`.
- **Email**: set `SMTP_*`. Without it, notifications are recorded in the delivery log as "skipped". Templates are editable in Admin > Settings > Notifications.
- **WhatsApp**: click-to-chat needs only the number in Admin > Settings. For admin alerts via the WhatsApp Cloud API set `WHATSAPP_*`.
- **Analytics**: first-party counts are built in. Enter a GA4 measurement ID in Admin > Settings > SEO & analytics.

## Deploying

Single service (API serves the built site): see `Dockerfile` and `render.yaml`. Required: `DATABASE_URL`, `JWT_SECRET` (32+ chars),
`PUBLIC_URL`, `STORAGE_PROVIDER=cloudinary` + Cloudinary keys (local disk is not durable on most hosts), plus `ADMIN_PASSWORD` for the first admin.
Migrations run automatically at startup. Set `PUBLIC_URL` to your real domain so the sitemap, emails and canonical URLs are right.

## Roles

| Role | Can manage |
|---|---|
| Administrator | everything, including users and settings |
| Editor | content, services, gallery, testimonials, promotions, social, SEO |
| Booking manager | bookings, customers, inquiries |
| Gallery manager | gallery and photo studio |

## Known gaps (not yet built)

Be aware of these before going live:

- **Prerendering**: the server injects per-page title, meta, Open Graph, canonical and JSON-LD plus a crawlable text summary into the built HTML (`server/src/lib/seoRender.ts`). Page bodies are still rendered by React in the browser, so full content is not in the initial HTML (the services list is).
- **S3 / Supabase storage** providers are not implemented (Cloudinary and local are).
- Google Reviews, Instagram live feed API, TikTok embeds (YouTube embeds work), optional watermark, deposit payment processing, and
  customer-facing reschedule/cancel links are not implemented.
- The Motion skill URL in the brief could not be fetched; animation follows standard Motion practice (variants, stagger, springs, `AnimatePresence`,
  layout animations, `MotionConfig reducedMotion="user"`).
- Only the API is covered by automated tests; the React UI was verified by hand in a browser, not by an automated suite.
- No Postgres-specific verification: tests run on PGlite. Run the suite against your production Postgres version before launch.

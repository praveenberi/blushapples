# API reference

Base path `/api`. JSON in and out. Errors: `{ "error": "message", "details": { field: [messages] } }` with 400 (validation), 401, 403, 404, 409 (conflict, e.g. slot taken), 429.

**Auth model**: `POST /auth/login` sets an httpOnly session cookie (`ba_session`) and a readable `ba_csrf` cookie. Every non-GET admin request must send the
`ba_csrf` value in an `x-csrf-token` header. Permissions are checked server-side per route (`bookings`, `services`, `gallery`, `content`, `settings`, `seo`,
`customers`, `inquiries`, `testimonials`, `promotions`, `social`, `analytics`, `users`; the admin role has all).

## Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{email,password}`, rate limited (10 / 15 min) |
| POST | `/auth/logout` | |
| GET | `/auth/me` | current user + refreshed CSRF token |
| POST | `/auth/forgot` | `{email}`; always 200, link emailed (logged in dev) |
| POST | `/auth/reset` | `{token,password}` (min 10 chars, letters + numbers) |
| POST | `/auth/change-password` | `{current,password}` |

## Public
| Method | Path | Notes |
|---|---|---|
| GET | `/public/site` | settings, nav, social, hours, categories, sections, testimonials, promotions, featured gallery/services, page SEO |
| GET | `/public/services` | |
| GET | `/public/gallery?category=&album=&q=&sort=newest\|featured` | |
| GET | `/public/availability?date=YYYY-MM-DD&serviceIds=1,2&addonIds=&location=studio` | free slots |
| GET | `/public/availability/month?month=YYYY-MM&serviceIds=` | dates with availability |
| POST | `/public/bookings` | see schema in `server/src/lib/booking.ts`; 409 if the slot was just taken |
| POST | `/public/inquiries` | rate limited |
| POST | `/public/upload` | multipart `file`, image only, 15MB |
| POST | `/public/track` | analytics beacon |
| GET | `/sitemap.xml`, `/robots.txt` | generated from live data |

## Admin (cookie + CSRF)
| Resource | Path | Permission |
|---|---|---|
| Services (+add-ons) | `/admin/services` (GET, POST, PUT/:id, DELETE/:id, POST `/:id/duplicate`, POST `/reorder`) | services |
| Service categories | `/admin/service-categories` | services |
| Gallery images | `/admin/gallery` (GET list, POST `/upload` multipart `files`, PUT/DELETE `/:id`, POST `/bulk`, POST `/reorder`) | gallery |
| Photo studio | `POST /admin/gallery/:id/edit/preview` (returns JPEG), `/edit/save` (`mode: copy\|replace`, replace needs `confirm:true`), `/edit/download`, `POST /:id/revert`, `GET /ai/capabilities`, presets at `/presets` | gallery |
| Asset upload | `POST /admin/gallery/asset` multipart `file` → `{url}` | any admin |
| Gallery categories / albums | `/admin/gallery-categories`, `/admin/albums` | gallery |
| Bookings | `/admin/bookings` (GET `?status=&q=&from=&to=`, POST manual, PUT `/:id`, POST `/:id/reschedule`, PUT `/:id/items`, GET `/slots`) | bookings |
| Blocked dates, hours | `/admin/blocked-dates`, `/admin/hours` | bookings |
| Customers | `/admin/customers`, `/:id`, POST `/:id/notes` | customers |
| Inquiries | `/admin/inquiries` | inquiries |
| Testimonials, promotions, social links | `/admin/testimonials`, `/admin/promotions`, `/admin/social-links` | matching permission |
| Navigation, page sections | `/admin/navigation`, `/admin/sections?page=home\|about` | content |
| Settings | `GET /admin/settings`, `PUT /admin/settings/:group` `{value}` (brand, contact, general, theme, whatsapp, booking, notifications, analytics, seo, footer, faqs, policies, instagram) | per group |
| SEO pages | `/admin/pages` | seo |
| Email templates | `/admin/templates`, `/admin/templates/logs/recent` | settings |
| Users, roles, audit | `/admin/users`, `/admin/roles`, `/admin/audit` | users |
| Dashboard, analytics | `/admin/dashboard`, `/admin/analytics?days=30` | any / analytics |

Simple resources share one validated CRUD factory: `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`, and `POST /reorder {ids:[]}` where the table is orderable.

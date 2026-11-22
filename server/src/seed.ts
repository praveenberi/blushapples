import crypto from 'crypto';
import sharp from 'sharp';
import { createDb, migrate, type Db } from './db';
import { config } from './config';
import { hashPassword } from './lib/auth';
import { storeImageVariants } from './lib/images';

const j = JSON.stringify;

export const ROLES = [
  { name: 'admin', label: 'Administrator', permissions: ['*'] },
  { name: 'editor', label: 'Editor', permissions: ['content', 'services', 'testimonials', 'promotions', 'social', 'seo', 'gallery'] },
  { name: 'booking_manager', label: 'Booking manager', permissions: ['bookings', 'customers', 'inquiries'] },
  { name: 'gallery_manager', label: 'Gallery manager', permissions: ['gallery'] },
];

const CATEGORIES = ['Bridal Makeup', 'Wedding Makeup', 'ROM Makeup', 'Engagement Makeup', 'Reception Makeup', 'Photoshoot Makeup', 'Party Makeup', 'Evening Makeup', 'Corporate Makeup',
  'Graduation Makeup', 'Fashion Makeup', 'Editorial Makeup', 'Special Events', 'Personal Makeup Lessons', 'Hairstyling', 'Hairdo', 'Makeup + Hairstyling Packages', 'Custom Packages'];
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// [name, category, price (units), type, minutes, description, included, addons]
const SERVICES: [string, string, number, string, number, string, string[], [string, number, number][]][] = [
  ['Signature Bridal Makeup', 'Bridal Makeup', 450, 'fixed', 120, 'A flawless, long-wear bridal look tailored to your features, outfit and venue lighting, with a full trial beforehand.', ['Skin prep & primer', 'Airbrush or HD foundation', 'Individual lashes', 'Touch-up kit', 'Bridal trial'], [['Second look change', 120, 45], ['Mother of the bride', 150, 60]]],
  ['Indian Bridal Makeup', 'Bridal Makeup', 520, 'starting_from', 150, 'Rich, jewel-toned artistry for traditional ceremonies, built to last through long rituals and photography.', ['Full-coverage base', 'Statement eyes', 'Lashes', 'Dupatta/saree setting', 'Touch-up kit'], [['Draping assistance', 80, 30]]],
  ['Wedding Guest Glam', 'Wedding Makeup', 140, 'fixed', 60, 'Polished, camera-ready makeup for bridesmaids and wedding guests.', ['Skin prep', 'Full glam makeup', 'Lashes'], [['Hair styling', 60, 30]]],
  ['ROM Makeup', 'ROM Makeup', 300, 'fixed', 90, 'Soft, radiant makeup for your registry of marriage ceremony.', ['Skin prep', 'Natural-glam makeup', 'Lashes', 'Touch-up kit'], []],
  ['Engagement Makeup', 'Engagement Makeup', 260, 'fixed', 90, 'Fresh, luminous makeup that photographs beautifully for your engagement day or shoot.', ['Skin prep', 'Makeup application', 'Lashes'], [['Hairstyling', 70, 40]]],
  ['Photoshoot Makeup', 'Photoshoot Makeup', 220, 'starting_from', 75, 'Camera-aware makeup for portraits, campaigns and portfolios, with on-set touch-ups available.', ['Skin prep', 'Makeup design', 'Lashes'], [['On-set touch-ups (per hour)', 90, 60]]],
  ['Soft Glam / Party Makeup', 'Party Makeup', 120, 'fixed', 60, 'Defined, polished makeup for parties, birthdays and nights out.', ['Skin prep', 'Makeup application', 'Lashes'], []],
  ['Evening Event Makeup', 'Evening Makeup', 150, 'fixed', 75, 'Elevated evening looks for galas, dinners and award nights.', ['Skin prep', 'Full glam', 'Lashes', 'Lip touch-up'], []],
  ['Editorial & Fashion Makeup', 'Editorial Makeup', 280, 'custom', 120, 'Concept-driven makeup for editorials, runway and creative direction. Quoted per project.', ['Mood-board consultation', 'Concept makeup', 'Lashes'], []],
  ['Personal Makeup Lesson', 'Personal Makeup Lessons', 180, 'fixed', 120, 'One-to-one tutorial on your own products and face shape, with a personalised face chart.', ['Skin analysis', 'Step-by-step tutorial', 'Face chart', 'Product recommendations'], []],
  ['Bridal Hairstyling', 'Hairstyling', 200, 'starting_from', 90, 'Soft waves, sleek updos and braided styles, secured to last all day.', ['Consultation', 'Styling', 'Accessory placement'], []],
  ['Bridal Makeup + Hair Package', 'Makeup + Hairstyling Packages', 620, 'fixed', 210, 'Our most popular package: complete bridal makeup and hair, with trial.', ['Bridal makeup', 'Bridal hairstyling', 'Trial session', 'Touch-up kit'], [['Bridesmaid makeup', 140, 60]]],
];

const GALLERY_CATS = ['Bridal', 'Indian Bridal', 'Natural Makeup', 'Glam Makeup', 'Party Makeup', 'ROM', 'Engagement', 'Reception', 'Photoshoot', 'Editorial', 'Hairstyling', 'Before & After'];
const PALETTES = [['#f3d9d4', '#d9a7a0'], ['#efe3d3', '#c9a96e'], ['#f6e7e4', '#b97a80'], ['#e9dccf', '#a98b73'], ['#f4e1dc', '#c28a86'], ['#ece1d8', '#8f6f5e']];

async function placeholder(i: number, label: string, mono = false) {
  const [a, b] = PALETTES[i % PALETTES.length];
  const cx = 300 + ((i * 97) % 400), r = 170 + (i % 4) * 25;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect width="1200" height="1500" fill="url(#g)"/><circle cx="${cx + 200}" cy="560" r="${r + 150}" fill="#fff" fill-opacity=".18"/>
    <ellipse cx="600" cy="1280" rx="520" ry="360" fill="#fff" fill-opacity=".22"/><circle cx="600" cy="640" r="${r}" fill="#fff" fill-opacity=".38"/>
    <rect x="0" y="0" width="1200" height="1500" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="24"/></svg>`;
  let img = sharp(Buffer.from(svg)).jpeg({ quality: 88 });
  if (mono) img = sharp(Buffer.from(svg)).modulate({ saturation: 0.15, brightness: 0.92 }).jpeg({ quality: 88 });
  void label;
  return img.toBuffer();
}

export interface SeedOptions { adminPassword?: string; adminEmail?: string; resetAdmin?: boolean; demo?: boolean; demoImages?: boolean }

/** Idempotent: safe to run on every start. Only the first run inserts demo content. */
export async function seed(db: Db, opts: SeedOptions = {}) {
  const q = db.q;
  for (const r of ROLES) await q(`INSERT INTO roles(name,label,permissions) VALUES ($1,$2,$3::jsonb) ON CONFLICT (name) DO UPDATE SET label=EXCLUDED.label, permissions=EXCLUDED.permissions`, [r.name, r.label, j(r.permissions)]);

  let generatedPassword: string | undefined;
  const [existingAdmin] = await q(`SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='admin' LIMIT 1`);
  if (!existingAdmin) {
    const pw = opts.adminPassword || config.seed.adminPassword || (generatedPassword = crypto.randomBytes(9).toString('base64url') + '7a');
    const [role] = await q<any>(`SELECT id FROM roles WHERE name='admin'`);
    await q('INSERT INTO users(email,name,password_hash,role_id) VALUES ($1,$2,$3,$4)', [opts.adminEmail || config.seed.adminEmail, 'Site Admin', await hashPassword(pw), role.id]);
  } else if (opts.resetAdmin ?? config.seed.resetAdmin) {
    // One-time recovery: set the first administrator's email and password from the environment.
    const pw = opts.adminPassword || config.seed.adminPassword;
    if (pw) {
      await q(`UPDATE users SET email=$1, password_hash=$2, active=true, deleted_at=NULL, updated_at=now()
        WHERE id=(SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='admin' ORDER BY u.id LIMIT 1)`, [opts.adminEmail || config.seed.adminEmail, await hashPassword(pw)]);
      console.log('Administrator account reset from ADMIN_EMAIL / ADMIN_PASSWORD. Remove RESET_ADMIN now.');
    }
  }

  const [initialised] = await q(`SELECT 1 FROM website_settings WHERE key='brand'`);
  if (initialised) return { generatedPassword, seededDemo: false };

  const S = (key: string, value: unknown) => q('INSERT INTO website_settings(key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO NOTHING', [key, j(value)]);
  await S('brand', { name: 'Blush & Apples', tagline: 'Luxury makeup artistry for your most beautiful moments', artistName: 'Your Name', artistTitle: 'Professional Makeup Artist', logo: '', favicon: '' });
  await S('contact', { phone: '+1 555 010 0199', whatsapp: '15550100199', email: 'hello@example.com', address: '123 Example Street, Your City', mapEmbed: '', mapLink: '', notes: 'Demo contact details: replace in Admin > Settings.' });
  await S('general', { currency: 'USD', timezone: 'America/New_York', locale: 'en-US' });
  await S('theme', {
    colors: { blush: '#f3d9d4', nude: '#e9dccf', gold: '#b8935a', ivory: '#fbf7f2', rose: '#b97a80', charcoal: '#2b2626', white: '#ffffff' },
    fonts: { heading: 'Cormorant Garamond', body: 'Jost' }, radius: 2, sectionSpacing: 112, buttonStyle: 'solid',
  });
  await S('whatsapp', {
    visible: true, position: 'right', color: '#25D366', greeting: 'Hi! I would like to enquire about your makeup services.',
    serviceTemplate: 'Hi, I would like to enquire about {{service}}.\nService: {{service}}\nPrice: {{price}}\nPreferred Date: {{date}}\nPlease let me know your availability and package details.\n{{url}}',
  });
  await S('booking', { slotIntervalMin: 30, bufferMin: 15, travelBufferMin: 45, leadTimeHours: 24, maxAdvanceDays: 365, depositPercent: 30, autoConfirm: false });
  await S('notifications', { adminEmail: '', reminderHoursBefore: 24 });
  await S('analytics', { ga4Id: '' });
  await S('seo', { siteName: 'Blush & Apples', defaultDescription: 'Professional makeup artist for bridal, editorial and event makeup.', businessType: 'MakeupArtist', priceRange: '$$', areaServed: '' });
  await S('footer', { blurb: 'Bespoke makeup artistry, crafted to look like you, only more radiant.', copyright: 'Blush & Apples. All rights reserved.' });
  await S('policies', {
    privacy: 'Demo privacy policy. Replace this text in Admin > Content.', terms: 'Demo terms. Replace this text in Admin > Content.',
    cancellation: 'A deposit secures your date. Cancellations made more than 14 days before your appointment are refunded in full minus processing fees.',
  });
  await S('instagram', { handle: '', embedUrls: [], youtubeUrls: [] });
  await S('faqs', [
    { q: 'How far in advance should I book bridal makeup?', a: 'Weddings book quickly, ideally 6 to 12 months ahead. Other events can often be accommodated with a few weeks notice.' },
    { q: 'Do you travel to my venue?', a: 'Yes. Travel to your home, hotel or venue is available. A travel buffer is built into the booking calendar.' },
    { q: 'Do you offer a bridal trial?', a: 'Trials are included in bridal packages and available as an add-on otherwise.' },
    { q: 'What is your cancellation policy?', a: 'See our cancellation policy in the footer. A deposit secures your date.' },
    { q: 'Which products do you use?', a: 'A curated kit of professional, skin-friendly brands. Tell us about allergies or preferences when you book.' },
  ]);

  for (const [k, title] of [['home', 'Home'], ['about', 'About'], ['services', 'Services'], ['portfolio', 'Portfolio'], ['book', 'Book an appointment'], ['contact', 'Contact'], ['promotions', 'Offers']]) {
    await q('INSERT INTO pages(slug,title,seo_title,seo_description) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING', [k, title, `${title} | Blush & Apples`, 'Professional makeup artist for bridal, editorial and event makeup.']);
  }
  const nav: [string, string, string][] = [['Home', '/', 'header'], ['Portfolio', '/portfolio', 'header'], ['Services', '/services', 'header'], ['About', '/about', 'header'], ['Offers', '/promotions', 'header'], ['Contact', '/contact', 'header'],
    ['Book now', '/book', 'footer'], ['Services', '/services', 'footer'], ['Portfolio', '/portfolio', 'footer'], ['About', '/about', 'footer'], ['Contact', '/contact', 'footer']];
  for (let i = 0; i < nav.length; i++) await q('INSERT INTO navigation_items(label,href,area,sort_order) VALUES ($1,$2,$3,$4)', [...nav[i], i + 1]);

  const hours = [[0, true], [1, false], [2, false], [3, false], [4, false], [5, false], [6, false]];
  for (const [d, closed] of hours) await q('INSERT INTO business_hours(weekday,closed,open_min,close_min) VALUES ($1,$2,540,1080) ON CONFLICT (weekday) DO NOTHING', [d, closed]);

  const tpl = (key: string, audience: string, subject: string, body: string) => q('INSERT INTO notification_templates(key,audience,subject,body) VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING', [key, audience, subject, body]);
  await tpl('booking_received', 'customer', 'We received your booking request ({{reference}})', 'Hi {{name}},\nThank you for booking with {{brand}}. We have received your request for {{services}} on {{date}} at {{time}}.\nReference: {{reference}}\nWe will confirm shortly.');
  await tpl('booking_confirmed', 'customer', 'Your booking is confirmed ({{reference}})', 'Hi {{name}},\nGreat news! Your booking for {{services}} on {{date}} at {{time}} is confirmed.\nTotal: {{total}}\nReference: {{reference}}');
  await tpl('booking_rescheduled', 'customer', 'Your booking has been rescheduled ({{reference}})', 'Hi {{name}},\nYour booking for {{services}} is now on {{date}} at {{time}}.\nReference: {{reference}}');
  await tpl('booking_cancelled', 'customer', 'Your booking was cancelled ({{reference}})', 'Hi {{name}},\nYour booking {{reference}} for {{date}} has been cancelled. Get in touch if you would like to rebook.');
  await tpl('inquiry_received', 'customer', 'Thanks for your enquiry', 'Hi {{name}},\nThank you for getting in touch. We have received your message and will reply soon.');
  await tpl('admin_new_booking', 'admin', 'New booking {{reference}}: {{name}}', 'New booking from {{name}}\n{{services}} on {{date}} at {{time}}\nVenue: {{venue}}\nTotal: {{total}}\nManage: {{link}}');
  await tpl('admin_new_inquiry', 'admin', 'New inquiry from {{name}}', 'Service: {{service}}\n{{message}}\nManage: {{link}}');
  await tpl('admin_booking_cancelled', 'admin', 'Booking cancelled {{reference}}', 'Booking {{reference}} ({{name}}, {{date}}) was cancelled.');
  await tpl('admin_password_reset', 'admin', 'Reset your password', 'Hi {{name}},\nUse this link to reset your password (valid for 1 hour): {{link}}');

  await q(`INSERT INTO enhancement_presets(name,params,built_in) VALUES
    ('Natural Beauty','{"intensity":"subtle","autoLevel":true,"brightness":4,"saturation":4,"sharpness":12}'::jsonb,true),
    ('Bridal Glow','{"intensity":"natural","autoLevel":true,"brightness":8,"contrast":-4,"temperature":8,"highlights":-6,"sharpness":10}'::jsonb,true),
    ('Soft Glam','{"intensity":"natural","brightness":6,"contrast":-6,"saturation":8,"temperature":5,"shadows":10}'::jsonb,true),
    ('Luxury Editorial','{"intensity":"medium","autoLevel":true,"contrast":14,"saturation":-6,"sharpness":28,"shadows":-8}'::jsonb,true),
    ('Studio Beauty','{"intensity":"natural","autoLevel":true,"brightness":5,"contrast":6,"sharpness":18,"temperature":-2}'::jsonb,true),
    ('Instagram Ready','{"intensity":"medium","brightness":6,"contrast":10,"saturation":16,"sharpness":22}'::jsonb,true),
    ('Professional Portfolio','{"intensity":"natural","autoLevel":true,"contrast":8,"sharpness":20,"denoise":30}'::jsonb,true),
    ('Warm Golden Glow','{"intensity":"natural","brightness":6,"temperature":22,"tint":4,"saturation":8,"highlights":-4}'::jsonb,true),
    ('Clean Beauty','{"intensity":"subtle","autoLevel":true,"brightness":8,"contrast":-2,"saturation":-4,"sharpness":8}'::jsonb,true),
    ('High Fashion','{"intensity":"strong","contrast":24,"saturation":-10,"sharpness":34,"shadows":-12,"highlights":6}'::jsonb,true)
    ON CONFLICT (name) DO NOTHING`);

  if (opts.demo === false) return { generatedPassword, seededDemo: false };

  /* ---- demo content (all flagged is_demo and editable/removable in the admin) ---- */
  const catIds: Record<string, number> = {};
  for (let i = 0; i < CATEGORIES.length; i++) {
    const [row] = await q<any>('INSERT INTO service_categories(name,slug,sort_order) VALUES ($1,$2,$3) RETURNING id', [CATEGORIES[i], slug(CATEGORIES[i]), i + 1]);
    catIds[CATEGORIES[i]] = row.id;
  }
  for (let i = 0; i < SERVICES.length; i++) {
    const [n, c, price, type, dur, desc, inc, addons] = SERVICES[i];
    const [s] = await q<any>(
      `INSERT INTO services(category_id,name,slug,description,price_cents,price_type,duration_min,included,featured,sort_order,is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,true) RETURNING id`,
      [catIds[c], n, slug(n), desc, price * 100, type, dur, j(inc), i < 4, i + 1]);
    for (let a = 0; a < addons.length; a++) await q('INSERT INTO service_addons(service_id,name,price_cents,duration_min,sort_order) VALUES ($1,$2,$3,$4,$5)', [s.id, addons[a][0], addons[a][1] * 100, addons[a][2], a + 1]);
  }
  const gcat: Record<string, number> = {};
  for (let i = 0; i < GALLERY_CATS.length; i++) {
    const [row] = await q<any>('INSERT INTO gallery_categories(name,slug,sort_order) VALUES ($1,$2,$3) RETURNING id', [GALLERY_CATS[i], slug(GALLERY_CATS[i]), i + 1]);
    gcat[GALLERY_CATS[i]] = row.id;
  }
  const [album] = await q<any>(`INSERT INTO gallery_albums(title,slug,description) VALUES ('Demo portfolio','demo-portfolio','Placeholder images. Replace with your own work.') RETURNING id`);

  if (opts.demoImages !== false) {
    const urls: string[] = [];
    for (let i = 0; i < 20; i++) {
      const cat = GALLERY_CATS[i % GALLERY_CATS.length];
      const buf = await placeholder(i, cat);
      const v = await storeImageVariants(buf, `demo-${slug(cat)}-${i + 1}`, 'demo');
      urls.push(v.displayUrl);
      let beforeUrl: string | null = null;
      if (cat === 'Before & After' || i % 7 === 0) {
        beforeUrl = (await storeImageVariants(await placeholder(i, cat, true), `demo-before-${i + 1}`, 'demo')).displayUrl;
      }
      await q(`INSERT INTO gallery_images(category_id,album_id,title,description,alt_text,tags,storage_key,url,display_url,thumb_url,original_url,before_url,width,height,featured,sort_order,is_demo)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,true)`,
      [gcat[cat], album.id, `${cat} look ${i + 1} (demo)`, 'Demo placeholder image: replace with your own photography.', `Demo placeholder: ${cat} makeup look`, j([slug(cat), 'demo']),
        v.storageKey, v.displayUrl, v.thumbUrl, v.originalUrl, beforeUrl, v.width, v.height, i < 8, i + 1]);
    }
    const svcs = await q<any>('SELECT id FROM services ORDER BY sort_order');
    for (let i = 0; i < svcs.length; i++) await q('UPDATE services SET image_url=$1 WHERE id=$2', [urls[i % urls.length], svcs[i].id]);
  }

  const reviews: [string, string, string][] = [
    ['Sample Client A', 'Bridal Makeup', 'Demo review: replace with a real client testimonial. The makeup lasted all day and looked beautiful in every photo.'],
    ['Sample Client B', 'Wedding Makeup', 'Demo review: calm, professional and so talented. Everyone asked who did my makeup.'],
    ['Sample Client C', 'Photoshoot Makeup', 'Demo review: understood the brief immediately and the results were exactly right for the camera.'],
    ['Sample Client D', 'Party Makeup', 'Demo review: I felt like the best version of myself. Booking was effortless.'],
    ['Sample Client E', 'Personal Makeup Lessons', 'Demo review: I finally understand what works for my face. Worth every minute.'],
    ['Sample Client F', 'Engagement Makeup', 'Demo review: natural, glowing and long lasting. Highly recommend.'],
  ];
  for (let i = 0; i < reviews.length; i++) await q('INSERT INTO testimonials(customer_name,review,rating,service_category,approved,featured,is_demo,sort_order) VALUES ($1,$3,5,$2,true,$4,true,$5)', [reviews[i][0], reviews[i][1], reviews[i][2], i < 3, i + 1]);

  await q(`INSERT INTO promotions(title,description,discount_type,discount_value,promo_code,terms,cta_label,is_demo,sort_order) VALUES
    ('Bridal Season Offer (demo)','Book your bridal makeup and hair package and enjoy a complimentary trial session.','none',0,'BRIDE-DEMO','Demo promotion. Edit or delete in Admin > Promotions.','Book bridal',true,1),
    ('Welcome 10% off (demo)','First-time clients receive 10% off any single service.','percent',10,'WELCOME10','Demo promotion. One use per client.','Book now',true,2)`);

  for (const [p, u, name] of [['Instagram', 'https://instagram.com/', '@yourhandle'], ['Facebook', 'https://facebook.com/', 'yourpage'], ['TikTok', 'https://tiktok.com/', '@yourhandle'], ['YouTube', 'https://youtube.com/', 'yourchannel'], ['Pinterest', 'https://pinterest.com/', 'yourboard']] as const) {
    await q('INSERT INTO social_links(platform,url,username,icon,sort_order) VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(sort_order),0)+1 FROM social_links))', [p, u, name, p.toLowerCase()]);
  }

  const sec = (page: string, type: string, name: string, content: object, order: number) =>
    q('INSERT INTO page_sections(page,type,name,content,sort_order) VALUES ($1,$2,$3,$4::jsonb,$5)', [page, type, name, j(content), order]);
  await sec('home', 'hero', 'Hero', { eyebrow: 'Professional Makeup Artist', heading: 'Beauty, beautifully told.', body: 'Bespoke bridal, editorial and event makeup that looks like you, only more radiant.', image: '', video: '', ctaLabel: 'Book an appointment', ctaHref: '/book', secondaryLabel: 'Explore portfolio', secondaryHref: '/portfolio', showWhatsapp: true }, 1);
  await sec('home', 'featured_gallery', 'Featured looks', { eyebrow: 'Portfolio', heading: 'Featured looks', body: 'A selection of recent work.' }, 2);
  await sec('home', 'services', 'Popular services', { eyebrow: 'Services', heading: 'Popular services', body: 'From natural glow to full glam.' }, 3);
  await sec('home', 'before_after', 'Transformations', { eyebrow: 'Transformations', heading: 'Before & after', body: 'Drag the slider to see the difference.' }, 4);
  await sec('home', 'story', 'Brand story', { eyebrow: 'The artist', heading: 'Artistry with intention', body: 'Demo biography: replace this with your story. Years of experience, a love of skin-first beauty and an eye for what makes each client shine.', image: '', ctaLabel: 'Read my story', ctaHref: '/about' }, 5);
  await sec('home', 'testimonials', 'Testimonials', { eyebrow: 'Kind words', heading: 'Loved by clients' }, 6);
  await sec('home', 'promotions', 'Offers', { eyebrow: 'Offers', heading: 'Current offers' }, 7);
  await sec('home', 'instagram', 'Instagram', { eyebrow: 'Follow along', heading: 'On Instagram' }, 8);
  await sec('home', 'contact', 'Contact', { eyebrow: 'Get in touch', heading: 'Let us plan your look', body: 'Message on WhatsApp, call, or send an enquiry.' }, 9);
  await sec('about', 'image_text', 'Introduction', { eyebrow: 'About', heading: 'Hello, I am your makeup artist', body: 'Demo biography: tell clients who you are, how you work and what they can expect.\n\nReplace this text, the photo and every section from Admin > Content.', image: '' }, 1);
  await sec('about', 'list', 'Qualifications', { heading: 'Qualifications & certifications', items: ['Professional makeup certification (demo)', 'Bridal & editorial masterclass (demo)', '10+ years experience (demo)'] }, 2);
  await sec('about', 'text', 'Philosophy', { heading: 'Makeup philosophy', body: 'Skin first, always. Makeup should feel like you, only more radiant (demo text).' }, 3);
  await sec('about', 'list', 'Awards', { heading: 'Awards & recognition', items: ['Demo award or feature', 'Demo publication'] }, 4);

  return { generatedPassword, seededDemo: true };
}

if (require.main === module) {
  (async () => {
    const db = await createDb();
    await migrate(db);
    const r = await seed(db);
    if (r.generatedPassword) console.log(`\nAdmin created: ${config.seed.adminEmail}\nGenerated password (shown once): ${r.generatedPassword}\n`);
    console.log(r.seededDemo ? 'Seeded demo content.' : 'Already initialised; nothing changed.');
    await db.close();
  })().catch((e) => { console.error(e); process.exit(1); });
}

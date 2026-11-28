import Feedback from './pages/Feedback';
import { MotionConfig } from 'framer-motion';
import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import { Layout } from './components/Layout';
import { PageLoader } from './components/ui';
import { SiteProvider, useSite } from './lib/site';
import { About, Home, NotFound, Policy, Portfolio, Promotions, Services } from './pages/Public';
import Book from './pages/Book';
import ContactPage from './pages/Contact';

const AdminApp = lazy(() => import('./admin/AdminApp'));

function PublicSite() {
  const { site, error } = useSite();
  if (error) return <div className="grid min-h-screen place-items-center p-8 text-center"><div><p className="font-heading text-3xl">We will be right back</p><p className="mt-2 text-sm text-charcoal/60">The site could not be loaded. Please refresh in a moment.</p></div></div>;
  if (!site) return <PageLoader />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} /><Route path="about" element={<About />} /><Route path="services" element={<Services />} /><Route path="portfolio" element={<Portfolio />} />
        <Route path="book" element={<Book />} /><Route path="contact" element={<ContactPage />} /><Route path="promotions" element={<Promotions />} /><Route path="feedback/:token" element={<Feedback />} /><Route path="policy/:key" element={<Policy />} /><Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  // reducedMotion="user": every animation honours the visitor's OS reduce-motion setting.
  <MotionConfig reducedMotion="user">
    <BrowserRouter>
      <SiteProvider>
        <Routes>
          <Route path="/admin/*" element={<Suspense fallback={<PageLoader />}><AdminApp /></Suspense>} />
          <Route path="/*" element={<PublicSite />} />
        </Routes>
      </SiteProvider>
    </BrowserRouter>
  </MotionConfig>,
);

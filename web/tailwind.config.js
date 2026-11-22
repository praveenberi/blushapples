const c = (n) => `rgb(var(--c-${n}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { blush: c('blush'), nude: c('nude'), gold: c('gold'), ivory: c('ivory'), rose: c('rose'), charcoal: c('charcoal'), paper: c('white') },
      fontFamily: { heading: ['var(--font-heading)', 'Georgia', 'serif'], body: ['var(--font-body)', 'system-ui', 'sans-serif'] },
      borderRadius: { theme: 'var(--radius)' },
      letterSpacing: { eyebrow: '0.22em' },
    },
  },
  plugins: [],
};

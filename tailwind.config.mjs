/** @type {import('tailwindcss').Config} */

// Every shade below resolves through a CSS custom property (see
// src/styles/global.css) so the whole app re-themes by flipping
// `data-theme` on <html> — no component needs a `dark:`/`light:` variant.
// The `rgb(var(--x) / <alpha-value>)` form is required (not a plain
// `var(--x)`) so Tailwind's opacity modifiers (e.g. `bg-slate-800/60`)
// keep working.
function cssVar(name) {
  return `rgb(var(${name}) / <alpha-value>)`;
}

export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,vue,svelte,md,mdx}'],
  theme: {
    extend: {
      colors: {
        // Overrides Tailwind's built-in slate scale. Role stays the same in
        // both themes (950/900 = backgrounds, 100/200 = primary text, etc.)
        // — only the actual color each role points to changes with the theme.
        slate: {
          50: cssVar('--slate-50'),
          100: cssVar('--slate-100'),
          200: cssVar('--slate-200'),
          300: cssVar('--slate-300'),
          400: cssVar('--slate-400'),
          500: cssVar('--slate-500'),
          600: cssVar('--slate-600'),
          700: cssVar('--slate-700'),
          800: cssVar('--slate-800'),
          900: cssVar('--slate-900'),
          950: cssVar('--slate-950'),
        },
        brand: {
          50: cssVar('--brand-50'),
          100: cssVar('--brand-100'),
          400: cssVar('--brand-400'),
          500: cssVar('--brand-500'),
          600: cssVar('--brand-600'),
          700: cssVar('--brand-700'),
        },
        // Semaphore colors for compliance status badges.
        status: {
          green: cssVar('--status-green'),
          yellow: cssVar('--status-yellow'),
          red: cssVar('--status-red'),
        },
        // Text/icon color for the Home page's per-area accent (purple,
        // amber, etc.) — only the foreground needs re-tuning per theme,
        // the translucent background/ring stay on the standard Tailwind
        // palette (low-opacity overlays read fine in both themes).
        accent: {
          purple: cssVar('--accent-purple'),
          amber: cssVar('--accent-amber'),
          emerald: cssVar('--accent-emerald'),
          orange: cssVar('--accent-orange'),
          teal: cssVar('--accent-teal'),
          cyan: cssVar('--accent-cyan'),
          rose: cssVar('--accent-rose'),
        },
      },
    },
  },
  plugins: [],
};

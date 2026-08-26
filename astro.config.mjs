import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';

// SSR mode: every request re-renders on the server so F5 always pulls
// fresh data from Odoo. Client islands (React) layer live filtering
// on top without full page reloads.
//
// Tailwind is wired via plain PostCSS (postcss.config.cjs + global.css),
// not @astrojs/tailwind — that integration is deprecated and doesn't
// support Astro 5+/7, so it's left out on purpose.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  server: {
    port: 4321,
  },
  vite: {
    ssr: {
      // keep Odoo client / node-only deps out of the client bundle
      noExternal: [],
    },
  },
});

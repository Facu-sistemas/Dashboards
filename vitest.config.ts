import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Tests de las reglas de negocio (funciones puras: no tocan Odoo ni Supabase). Se corren con `npm test`.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});

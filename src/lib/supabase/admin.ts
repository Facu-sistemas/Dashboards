import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client — bypasses RLS entirely. Only ever import
 * this from src/pages/api/admin/* endpoints, and only after checking
 * `Astro.locals.usuario.rol === 'dev'`. Never import from a client
 * component or a page: SUPABASE_SERVICE_ROLE_KEY has no PUBLIC_ prefix,
 * so Vite already keeps it out of client bundles (same guarantee env.ts
 * relies on for ODOO_API_KEY), but the module itself must still stay
 * server-only so that guarantee is never accidentally relied upon from
 * code that shouldn't need it in the first place.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var "${name}". Copy .env.example to .env and fill it in.`);
  }
  return value;
}

let cached: SupabaseClient | undefined;

export function getSupabaseAdminClient(): SupabaseClient {
  if (cached) return cached;

  cached = createClient(
    required('PUBLIC_SUPABASE_URL', import.meta.env.PUBLIC_SUPABASE_URL),
    required('SUPABASE_SERVICE_ROLE_KEY', import.meta.env.SUPABASE_SERVICE_ROLE_KEY),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return cached;
}

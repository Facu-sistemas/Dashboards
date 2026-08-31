import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client — only reads PUBLIC_ env vars (the ones Vite
 * inlines into the client bundle), same boundary as env.ts draws for
 * server-only Odoo config, just mirrored for what's safe client-side.
 * Used by the login form; every other page reads the session
 * server-side via src/lib/supabase/server.ts instead.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var "${name}". Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    required('PUBLIC_SUPABASE_URL', import.meta.env.PUBLIC_SUPABASE_URL),
    required('PUBLIC_SUPABASE_ANON_KEY', import.meta.env.PUBLIC_SUPABASE_ANON_KEY)
  );
}

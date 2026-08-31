import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { jsonResponse } from '../../../lib/api-helpers';

export const prerender = false;

// POST /api/auth/logout
export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClient(context);
  await supabase.auth.signOut();
  return jsonResponse({ ok: true });
};

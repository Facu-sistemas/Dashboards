import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { jsonResponse } from '../../../lib/api-helpers';
import { SESSION_STARTED_COOKIE } from '../../../lib/auth-constants';

export const prerender = false;

// POST /api/auth/logout
export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClient(context);
  await supabase.auth.signOut();
  context.cookies.delete(SESSION_STARTED_COOKIE, { path: '/' });
  return jsonResponse({ ok: true });
};

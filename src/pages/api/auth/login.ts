import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { jsonResponse } from '../../../lib/api-helpers';

export const prerender = false;

const bodySchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

// POST /api/auth/login — usernames map to the fixed "{username}@interno.com"
// shared-account convention (see plan-auth-permisos-supabase.md); the UI
// never mentions "email" so factory-floor users just see "usuario".
export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ ok: false, error: 'Usuario y contraseña son obligatorios' }, { status: 400 });
  }

  const email = `${parsed.data.username.toLowerCase()}@interno.com`;
  const supabase = createSupabaseServerClient(context);
  const { error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });

  if (error) {
    return jsonResponse({ ok: false, error: 'Usuario o contraseña incorrectos' }, { status: 401 });
  }

  return jsonResponse({ ok: true });
};

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { jsonResponse } from '../../../lib/api-helpers';
import { SESSION_STARTED_COOKIE } from '../../../lib/auth-constants';

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
  const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });

  if (error) {
    return jsonResponse({ ok: false, error: 'Usuario o contraseña incorrectos' }, { status: 401 });
  }

  // dev accounts have full admin power (create/delete any account, see
  // every area) — restrict them to one active machine at a time by
  // revoking every other session's refresh token on each new login.
  // `scope: 'others'` leaves the session we just created alone; any
  // other device gets logged out the next time its cookie is revalidated
  // (middleware calls getUser(), which re-checks against the Auth
  // server, so a revoked session doesn't linger until token expiry).
  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('id', signInData.user.id).single();
  if (perfil?.rol === 'dev') {
    await supabase.auth.signOut({ scope: 'others' });
  }

  // Marks when THIS login happened, independent of Supabase's own
  // session cookies — the middleware compares against this to enforce a
  // per-account auto-logout, since silent token refreshes never touch it.
  context.cookies.set(SESSION_STARTED_COOKIE, new Date().toISOString(), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
    maxAge: 60 * 60 * 24 * 400,
  });

  return jsonResponse({ ok: true });
};

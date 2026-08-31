import { defineMiddleware } from 'astro:middleware';
import { createSupabaseServerClient } from './lib/supabase/server';
import { AREA_SLUGS } from './lib/areas.config';
import { SESSION_STARTED_COOKIE } from './lib/auth-constants';

// Reachable without a session — everything else redirects to /login.
// Static assets (favicon, /_astro/* build output, etc.) are matched by
// isStaticAsset below instead of listed here.
const PUBLIC_PATHS = new Set(['/login', '/404', '/api/auth/login', '/api/auth/logout']);

function isStaticAsset(pathname: string): boolean {
  return /\.[a-zA-Z0-9]+$/.test(pathname);
}

// Postgres RLS is the real security boundary (see plan-auth-permisos-supabase.md,
// decision #6) — this middleware only decides what the UI renders/redirects to.
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (PUBLIC_PATHS.has(pathname) || isStaticAsset(pathname)) {
    return next();
  }

  const supabase = createSupabaseServerClient(context);
  // getUser() re-validates the JWT against Supabase's Auth server rather
  // than trusting whatever the cookie says — required for a server-side
  // gate (getSession() would let a tampered/stale cookie through).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const redirectTo = `${pathname}${context.url.search}`;
    return context.redirect(`/login?redirect=${encodeURIComponent(redirectTo)}`);
  }

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('id, username, rol, sesion_max_minutos')
    .eq('id', user.id)
    .single();

  // Auth user with no matching perfiles row is a misconfigured account
  // (or Fase 1's first-run edge case) — treat exactly like "not logged in"
  // rather than letting pages render with a missing Astro.locals.usuario.
  if (!perfil) {
    return context.redirect('/login');
  }

  // Per-account auto-logout (set from /admin/usuarios). Enforced here
  // instead of via the Supabase JWT's own expiry, because the refresh
  // token would otherwise keep renewing the session forever — elapsed
  // time is measured from the login timestamp in its own cookie, which
  // silent token refreshes never touch, unlike the access token's `iat`.
  if (perfil.sesion_max_minutos != null) {
    const startedAt = context.cookies.get(SESSION_STARTED_COOKIE)?.value;
    const startedAtMs = startedAt ? Date.parse(startedAt) : NaN;
    const elapsedMinutes = Number.isNaN(startedAtMs) ? Infinity : (Date.now() - startedAtMs) / 60_000;
    if (elapsedMinutes > perfil.sesion_max_minutos) {
      await supabase.auth.signOut();
      context.cookies.delete(SESSION_STARTED_COOKIE, { path: '/' });
      const redirectTo = `${pathname}${context.url.search}`;
      return context.redirect(`/login?redirect=${encodeURIComponent(redirectTo)}&expired=1`);
    }
  }

  const { data: permisos } = await supabase.from('permisos_modulo').select('area_slug').eq('user_id', user.id).eq('activo', true);

  context.locals.usuario = {
    id: perfil.id,
    username: perfil.username,
    rol: perfil.rol,
    // dev manages every area's permissions from /admin/usuarios, so it
    // wouldn't make sense for that same account to be locked out of the
    // areas it administers — everyone else gets exactly what's toggled on.
    areasPermitidas: perfil.rol === 'dev' ? AREA_SLUGS : (permisos ?? []).map((p) => p.area_slug),
  };

  return next();
});

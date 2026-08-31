import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { APIContext } from 'astro';

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var "${name}". Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/**
 * Per-request Supabase client bound to this request's cookies — reads
 * come from the incoming `Cookie` header, writes (session refresh,
 * sign-in, sign-out) go back out via `context.cookies.set`, so pages,
 * the middleware, and API routes all see the same auth state. Per
 * @supabase/ssr's own contract, a fresh client must be created for
 * every request — never cache/share one across requests.
 */
export function createSupabaseServerClient(context: Pick<APIContext, 'request' | 'cookies'>) {
  return createServerClient(
    required('PUBLIC_SUPABASE_URL', import.meta.env.PUBLIC_SUPABASE_URL),
    required('PUBLIC_SUPABASE_ANON_KEY', import.meta.env.PUBLIC_SUPABASE_ANON_KEY),
    {
      cookies: {
        getAll() {
          return parseCookieHeader(context.request.headers.get('Cookie') ?? '');
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            context.cookies.set(name, value, options);
          }
        },
      },
    }
  );
}

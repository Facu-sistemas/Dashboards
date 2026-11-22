import type { APIRoute } from 'astro';
import { EMPLEADO_COOKIE } from '@/lib/empleado-sesion';
import { jsonResponse } from '@/lib/api-helpers';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  context.cookies.delete(EMPLEADO_COOKIE, { path: '/' });
  return jsonResponse({ ok: true });
};

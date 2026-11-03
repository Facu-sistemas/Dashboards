import type { APIRoute } from 'astro';
import { z } from 'zod';
import { pedirRecarga } from '@/lib/supabase/fichaje-kioscos';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const bodySchema = z.object({ kiosco: z.string().min(1).max(100) });

// POST /api/admin/fichaje-kioscos-recargar — pide que el celular de un kiosco recargue la página (lo hace en su próxima señal de vida). Solo dev.
export const POST: APIRoute = async (context) => {
  if (context.locals.usuario?.rol !== 'dev') {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(async () => {
    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      throw new ApiValidationError('JSON inválido');
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    try {
      await pedirRecarga(parsed.data.kiosco);
    } catch (err) {
      throw new ApiValidationError(err instanceof Error ? err.message : 'No se pudo pedir la recarga');
    }
    return { ok: true };
  });
};

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { setUmbralesSeguimiento } from '@/lib/supabase/seguimiento-mo-umbrales';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const bodySchema = z
  .object({
    grupo: z.enum(['colchones', 'living']),
    amarilloDesde: z.number().int().min(1).max(365),
    rojoDesde: z.number().int().min(1).max(365),
  })
  .refine((v) => v.rojoDesde > v.amarilloDesde, { message: 'El rojo tiene que empezar después del amarillo' });

// POST /api/seguimiento-mo-umbrales — guarda el umbral de un grupo ({ grupo, amarilloDesde, rojoDesde }). Quien tenga acceso al módulo Producción (manufactura).
export const POST: APIRoute = async (context) => {
  if (!context.locals.usuario?.areasPermitidas.includes('manufactura')) {
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
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const { grupo, amarilloDesde, rojoDesde } = parsed.data;
    await setUmbralesSeguimiento(grupo, { amarilloDesde, rojoDesde }, context.locals.usuario!.username);
    return { grupo, amarilloDesde, rojoDesde };
  });
};

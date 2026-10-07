import type { APIRoute } from 'astro';
import { z } from 'zod';
import { setTarifasMes } from '../../lib/supabase/costo-devoluciones-tarifas';
import { handleApiRoute, jsonResponse, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const bodySchema = z.object({
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido'),
  costoHora: z.number().min(0).max(1e9),
  viajes: z.number().min(0).max(20),
  fletes: z.record(z.string().trim().min(1).max(100), z.number().min(0).max(1e9)),
});

// POST /api/costo-devoluciones-tarifas — guarda las tarifas de un mes
// ({ mes: "YYYY-MM", costoHora, viajes, fletes: { provincia: $ por viaje } }).
export const POST: APIRoute = async (context) => {
  if (!context.locals.usuario?.areasPermitidas.includes('gestion-calidad')) {
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
    const { mes, ...tarifas } = parsed.data;
    return setTarifasMes(mes, tarifas, context.locals.usuario!.username);
  });
};

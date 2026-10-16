import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getCncParametros, setCncParametro } from '@/lib/supabase/cnc-parametros';
import { PARAMETROS } from '@/components/calidad/calidad-demo-data';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const notas = PARAMETROS.map((p) => p.nota) as [string, ...string[]];

const bodySchema = z.object({
  nota: z.enum(notas),
  cuenta: z.boolean(),
  flete: z.boolean(),
  horas: z.number().min(0).max(1000),
  pct: z.number().min(0).max(1),
});

const AREA = 'gerencia-general';

// GET /api/cnc-parametros — parámetros guardados por nota ({ disponible, params })
export const GET: APIRoute = async (context) => {
  if (!context.locals.usuario?.areasPermitidas.includes(AREA)) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(() => getCncParametros());
};

// POST /api/cnc-parametros — guarda los parámetros de una nota ({ nota, cuenta, flete, horas, pct })
export const POST: APIRoute = async (context) => {
  if (!context.locals.usuario?.areasPermitidas.includes(AREA)) {
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
    const { nota, ...p } = parsed.data;
    await setCncParametro(nota, p, context.locals.usuario!.username);
    return { guardado: true };
  });
};

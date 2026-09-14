import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getConsensoUnidades, getTcAsumido, upsertConsensoUnidades, upsertTcAsumido } from '../../lib/supabase/presupuesto-inputs';
import { handleApiRoute, jsonResponse, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const yearQuerySchema = z.object({ year: z.coerce.number().int().min(2020).max(2100) });

const mesSchema = z.string().regex(/^\d{4}-\d{2}$/, 'mes debe tener formato YYYY-MM');

const consensoSchema = z.object({
  type: z.literal('consenso'),
  mes: mesSchema,
  unidadNegocio: z.enum(['colchones', 'living']),
  unidades: z.number().nonnegative(),
});

const tcSchema = z.object({
  type: z.literal('tc'),
  mes: mesSchema,
  tc: z.number().positive(),
});

const postSchema = z.union([consensoSchema, tcSchema]);

function requireComprasAccess(context: { locals: App.Locals }): Response | null {
  if (!context.locals.usuario?.areasPermitidas.includes('finanzas')) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return null;
}

// GET /api/presupuesto-dinamico-inputs?year=2026 — consenso de unidades y TC asumido cargados para el año.
export const GET: APIRoute = async (context) => {
  const denied = requireComprasAccess(context);
  if (denied) return denied;

  return handleApiRoute(async () => {
    const parsed = yearQuerySchema.safeParse(Object.fromEntries(context.url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const [consenso, tc] = await Promise.all([getConsensoUnidades(parsed.data.year), getTcAsumido(parsed.data.year)]);
    return { consenso, tc };
  });
};

// POST /api/presupuesto-dinamico-inputs — carga/edita un valor de consenso de unidades o de TC asumido.
export const POST: APIRoute = async (context) => {
  const denied = requireComprasAccess(context);
  if (denied) return denied;

  return handleApiRoute(async () => {
    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      throw new ApiValidationError('JSON inválido');
    }

    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }

    const userId = context.locals.usuario!.id;
    if (parsed.data.type === 'consenso') {
      await upsertConsensoUnidades(userId, parsed.data.mes, parsed.data.unidadNegocio, parsed.data.unidades);
    } else {
      await upsertTcAsumido(userId, parsed.data.mes, parsed.data.tc);
    }
    return { saved: true };
  });
};

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getLineaFamilias } from '../../lib/odoo/linea-resorte';
import { getConfigLinea, setMesaActiva, setReglaTap } from '../../lib/supabase/linea-config';
import { MESA_CODIGOS, REGLAS_DEFAULT } from '../../lib/linea-config';
import { handleApiRoute, jsonResponse, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

function requireProduccionAccess(context: { locals: App.Locals }): Response | null {
  if (!context.locals.usuario?.areasPermitidas.includes('produccion')) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return null;
}

// GET /api/linea-config — mesas inactivas, reglas guardadas + default, y las
// familias de TAP detectadas en Odoo (para que aparezcan aunque no tengan regla).
export const GET: APIRoute = async () => {
  return handleApiRoute(async () => {
    const [config, familias] = await Promise.all([getConfigLinea(), getLineaFamilias()]);
    return { ...config, reglasDefault: REGLAS_DEFAULT, familias };
  });
};

const mesaCodigo = z.string().refine((c) => MESA_CODIGOS.includes(c), 'Mesa desconocida');

const bodySchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('mesa'), codigo: mesaCodigo, activa: z.boolean() }),
  z.object({
    tipo: z.literal('regla'),
    familia: z.string().trim().min(1).max(100),
    regla: z
      .object({
        modo: z.enum(['paralelo', 'serie', 'excluido']),
        mesas: z.array(mesaCodigo),
        prioridad: z.number().int().min(1).max(99),
      })
      .nullable(),
  }),
]);

// POST /api/linea-config — { tipo: 'mesa', codigo, activa } o
// { tipo: 'regla', familia, regla } (regla null = volver a la default).
export const POST: APIRoute = async (context) => {
  const denied = requireProduccionAccess(context);
  if (denied) return denied;

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

    const usuario = context.locals.usuario!.username;
    const data = parsed.data;
    if (data.tipo === 'mesa') {
      await setMesaActiva(data.codigo, data.activa, usuario);
    } else {
      if (data.regla && data.regla.modo !== 'excluido' && data.regla.mesas.length === 0) {
        throw new ApiValidationError('Elegí al menos una mesa');
      }
      await setReglaTap(data.familia.toUpperCase(), data.regla, usuario);
    }
    return { saved: true };
  });
};

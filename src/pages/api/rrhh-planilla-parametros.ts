import type { APIRoute } from 'astro';
import { z } from 'zod';
import { CAMPOS_PARAMETRO, guardarParametro } from '@/lib/supabase/rrhh-planilla-parametros';
import { puedeAdministrarRrhh } from '@/lib/rrhh-permisos';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const bodySchema = z
  .object({
    desde: fecha,
    hasta: fecha,
    // 0 = encabezado (toda la columna); si no, hr.employee.id.
    empleadoId: z.number().int().min(0),
    campo: z.enum(CAMPOS_PARAMETRO),
    // null = borrar (vuelve al valor del encabezado o al de Odoo).
    valor: z.number().min(0).max(400).nullable(),
  })
  .refine((b) => b.hasta >= b.desde, { message: 'La fecha "hasta" es anterior a "desde"' })
  .refine((b) => b.campo !== 'viaticoDias' || b.valor === null || Number.isInteger(b.valor), { message: 'El viático va en días enteros' });

// POST /api/rrhh-planilla-parametros — guarda (o borra) un parámetro de la quincena de RRHH > Planilla: el valor de la columna
// (encabezado) o el ajuste de una persona. Solo Supabase: no escribe en Odoo. Solo dev y la cuenta rrhh.
export const POST: APIRoute = async (context) => {
  const usuario = context.locals.usuario;
  if (!puedeAdministrarRrhh(usuario)) return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
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
      await guardarParametro({ ...parsed.data, usuario: usuario!.username });
    } catch (err) {
      console.error('[rrhh-planilla-parametros]', err);
      throw new ApiValidationError(
        `No se pudo guardar (${err instanceof Error ? err.message : 'error desconocido'}). ¿Se corrió el SQL de la tabla rrhh_planilla_parametros en Supabase?`
      );
    }
    return { guardado: true };
  });
};

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { descartarNovedad, descartarNovedades, restaurarNovedad } from '@/lib/supabase/rrhh-novedades-descartadas';
import { puedeAdministrarRrhh } from '@/lib/rrhh-permisos';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const TIPOS = ['horas-faltantes', 'sin-salida', 'marca-incompleta', 'sin-fichada', 'horas-extra', 'cambio-horario'] as const;

const itemSchema = z.object({
  empleadoId: z.number().int().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipo: z.enum(TIPOS),
});

const descartarSchema = itemSchema.extend({ motivo: z.string().trim().max(200).optional() });

// Descarte masivo: varias novedades con el mismo motivo.
const descartarVariasSchema = z.object({
  items: z.array(itemSchema).min(1).max(300),
  motivo: z.string().trim().max(200).optional(),
});

const restaurarSchema = z.object({ clave: z.string().regex(/^\d+\|\d{4}-\d{2}-\d{2}\|[a-z-]+$/) });

function noAutorizado(): Response {
  return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
}

async function leerBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiValidationError('JSON inválido');
  }
}

// POST /api/rrhh-novedades-descartar — marca una novedad como descartada (no escribe en Odoo). Solo dev y la cuenta rrhh.
// La clave se arma acá a partir de empleado, fecha y tipo: el navegador no manda una clave arbitraria.
export const POST: APIRoute = async (context) => {
  const usuario = context.locals.usuario;
  if (!puedeAdministrarRrhh(usuario)) return noAutorizado();
  return handleApiRoute(async () => {
    const body = await leerBody(context.request);
    if (body && typeof body === 'object' && 'items' in body) {
      const varias = descartarVariasSchema.safeParse(body);
      if (!varias.success) throw new ApiValidationError(varias.error.issues.map((i) => i.message).join('; '));
      const items = varias.data.items.map((i) => ({ ...i, clave: `${i.empleadoId}|${i.fecha}|${i.tipo}` }));
      try {
        await descartarNovedades(items, usuario!.username, varias.data.motivo);
      } catch (err) {
        console.error('[rrhh-novedades-descartar]', err);
        throw new ApiValidationError(
          `No se pudo guardar (${err instanceof Error ? err.message : 'error desconocido'}). ¿Se corrió el SQL de la tabla rrhh_novedades_descartadas en Supabase?`
        );
      }
      return { cantidad: items.length };
    }
    const parsed = descartarSchema.safeParse(body);
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    const { empleadoId, fecha, tipo, motivo } = parsed.data;
    const clave = `${empleadoId}|${fecha}|${tipo}`;
    try {
      await descartarNovedad({ clave, empleadoId, fecha, tipo, motivo, usuario: usuario!.username });
    } catch (err) {
      console.error('[rrhh-novedades-descartar]', err);
      throw new ApiValidationError(
        `No se pudo guardar (${err instanceof Error ? err.message : 'error desconocido'}). ¿Se corrió el SQL de la tabla rrhh_novedades_descartadas en Supabase?`
      );
    }
    return { clave };
  });
};

// DELETE /api/rrhh-novedades-descartar — vuelve a mostrar una novedad descartada.
export const DELETE: APIRoute = async (context) => {
  if (!puedeAdministrarRrhh(context.locals.usuario)) return noAutorizado();
  return handleApiRoute(async () => {
    const parsed = restaurarSchema.safeParse(await leerBody(context.request));
    if (!parsed.success) throw new ApiValidationError('Clave inválida');
    try {
      await restaurarNovedad(parsed.data.clave);
    } catch (err) {
      console.error('[rrhh-novedades-descartar]', err);
      throw new ApiValidationError(`No se pudo restaurar (${err instanceof Error ? err.message : 'error desconocido'}).`);
    }
    return { clave: parsed.data.clave };
  });
};

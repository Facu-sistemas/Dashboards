import type { APIRoute } from 'astro';
import { z } from 'zod';
import { acreditarHorasExtra, cargarAusenciaDiaCompleto, cargarAusenciaPorHoras, corregirFichada } from '@/lib/odoo/novedades-write';
import { puedeAdministrarRrhh } from '@/lib/rrhh-permisos';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const base = {
  empleadoId: z.number().int().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nota: z.string().trim().max(200).optional(),
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

// Una variante por tipo de novedad: cada una llama a UNA operación acotada de novedades-write.ts.
const bodySchema = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('horas'), ...base, tipoId: z.number().int().positive(), horas: z.number().positive() }),
  z.object({ accion: z.literal('dia'), ...base, tipoId: z.number().int().positive() }),
  z.object({ accion: z.literal('banco'), ...base, horas: z.number().positive() }),
  z.object({ accion: z.literal('fichada'), ...base, tipo: z.enum(['sin-salida', 'marca-incompleta']), entrada: hhmm.optional(), salida: hhmm }),
]);

// POST /api/rrhh-novedades-cargar — resuelve una novedad ESCRIBIENDO en Odoo (ausencia por horas, ausencia de día completo,
// horas al banco o corrección de una fichada). Solo dev y la cuenta rrhh (mismo control que el resto de la administración de RRHH).
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
    const datos = parsed.data;
    const aprobadoPor = usuario!.username;
    switch (datos.accion) {
      case 'horas':
        return cargarAusenciaPorHoras({ ...datos, aprobadoPor });
      case 'dia':
        return cargarAusenciaDiaCompleto({ ...datos, aprobadoPor });
      case 'banco':
        return acreditarHorasExtra({ ...datos, aprobadoPor });
      case 'fichada':
        return corregirFichada({ ...datos, aprobadoPor });
    }
  });
};

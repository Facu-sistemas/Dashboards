import type { APIRoute } from 'astro';
import { z } from 'zod';
import { marcarAsistencia } from '../../lib/odoo/asistencia-write';
import { handleApiRoute, jsonResponse, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const bodySchema = z.object({ empleadoId: z.number().int().positive() });

// POST /api/fichaje-marcar — registra entrada o salida (la decide Odoo) del
// empleado reconocido. Única ruta del proyecto que escribe en Odoo.
export const POST: APIRoute = async (context) => {
  if (!context.locals.usuario?.areasPermitidas.includes('test')) {
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
    return marcarAsistencia(parsed.data.empleadoId);
  });
};

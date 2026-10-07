import type { APIRoute } from 'astro';
import { z } from 'zod';
import { borrarCarasDeEmpleado } from '../../../lib/supabase/fichaje-caras';
import { handleApiRoute, jsonResponse, ApiValidationError } from '../../../lib/api-helpers';

export const prerender = false;

const deleteSchema = z.object({ empleadoId: z.number().int().positive() });

// DELETE /api/admin/fichaje-caras — elimina el registro facial de un empleado. Solo dev: es la única ruta que
// borra caras, así una cuenta de quiosco no puede dar de baja a nadie.
export const DELETE: APIRoute = async (context) => {
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
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    await borrarCarasDeEmpleado(parsed.data.empleadoId);
    return { ok: true };
  });
};

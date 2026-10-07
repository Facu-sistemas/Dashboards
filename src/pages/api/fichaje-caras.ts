import type { APIRoute } from 'astro';
import { z } from 'zod';
import { listCaras, listCarasResumen, crearCaras, borrarCarasDeEmpleado, empleadoTieneCaras } from '../../lib/supabase/fichaje-caras';
import { handleApiRoute, jsonResponse, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const descriptorSchema = z.array(z.number().finite()).length(128);

const postSchema = z.object({
  empleadoId: z.number().int().positive(),
  empleadoNombre: z.string().trim().min(1),
  descriptores: z.array(descriptorSchema).min(1).max(10),
});

function requireFichajeAccess(context: { locals: App.Locals }): Response | null {
  if (!context.locals.usuario?.areasPermitidas.includes('fichaje')) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return null;
}

// GET /api/fichaje-caras — todos los descriptores registrados (el reconocimiento se hace en el navegador).
// Con ?resumen=1 devuelve solo una fila por empleado, sin los vectores.
export const GET: APIRoute = async (context) => {
  const denied = requireFichajeAccess(context);
  if (denied) return denied;
  const resumen = context.url.searchParams.get('resumen') === '1';
  return handleApiRoute(() => (resumen ? listCarasResumen() : listCaras()));
};

// POST /api/fichaje-caras — registra la cara de un empleado. Quien no es admin no puede pisar una cara ya
// registrada (sería equivalente a borrarla); el reemplazo y la baja los hace el admin.
// No hay DELETE acá a propósito: eliminar registros faciales está en /api/admin/fichaje-caras (solo dev).
export const POST: APIRoute = async (context) => {
  const denied = requireFichajeAccess(context);
  if (denied) return denied;
  return handleApiRoute(async () => {
    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      throw new ApiValidationError('JSON inválido');
    }
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    const { empleadoId, empleadoNombre, descriptores } = parsed.data;

    if (context.locals.usuario?.rol !== 'dev' && (await empleadoTieneCaras(empleadoId))) {
      throw new ApiValidationError('Ese empleado ya tiene la cara registrada. Solo un administrador puede reemplazarla o eliminarla.');
    }

    await borrarCarasDeEmpleado(empleadoId);
    await crearCaras(empleadoId, empleadoNombre, descriptores);
    return { guardados: descriptores.length };
  });
};

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { listCaras, crearCaras, borrarCarasDeEmpleado } from '../../lib/supabase/fichaje-caras';
import { handleApiRoute, jsonResponse, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const descriptorSchema = z.array(z.number().finite()).length(128);

const postSchema = z.object({
  empleadoId: z.number().int().positive(),
  empleadoNombre: z.string().trim().min(1),
  descriptores: z.array(descriptorSchema).min(1).max(10),
});

const deleteSchema = z.object({ empleadoId: z.number().int().positive() });

function requireTestAccess(context: { locals: App.Locals }): Response | null {
  if (!context.locals.usuario?.areasPermitidas.includes('test')) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return null;
}

async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiValidationError('JSON inválido');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
  return parsed.data;
}

// GET /api/fichaje-caras — todos los descriptores registrados (el reconocimiento se hace en el navegador).
export const GET: APIRoute = async (context) => {
  const denied = requireTestAccess(context);
  if (denied) return denied;
  return handleApiRoute(() => listCaras());
};

// POST /api/fichaje-caras — registra una cara nueva; reemplaza las anteriores del mismo empleado.
export const POST: APIRoute = async (context) => {
  const denied = requireTestAccess(context);
  if (denied) return denied;
  return handleApiRoute(async () => {
    const { empleadoId, empleadoNombre, descriptores } = await readBody(context.request, postSchema);
    await borrarCarasDeEmpleado(empleadoId);
    await crearCaras(empleadoId, empleadoNombre, descriptores);
    return { guardados: descriptores.length };
  });
};

// DELETE /api/fichaje-caras — elimina el registro facial de un empleado.
export const DELETE: APIRoute = async (context) => {
  const denied = requireTestAccess(context);
  if (denied) return denied;
  return handleApiRoute(async () => {
    const { empleadoId } = await readBody(context.request, deleteSchema);
    await borrarCarasDeEmpleado(empleadoId);
    return { ok: true };
  });
};

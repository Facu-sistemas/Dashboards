import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getRrhhVacaciones } from '@/lib/odoo/rrhh-vacaciones';
import { guardarEstadoResumen, listEstadosResumen } from '@/lib/supabase/rrhh-resumen-estado';
import { puedeAdministrarRrhh } from '@/lib/rrhh-permisos';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const putSchema = z.object({
  empleadoId: z.number().int().positive(),
  empleadoNombre: z.string().trim().min(1).max(200),
  estado: z.enum(['normal', 'reporte_perfecto', 'ignorar']),
});

function noAutorizado(): Response {
  return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
}

// GET /api/rrhh-resumen-estados — todos los empleados activos con su estado en el Resumen. Solo dev y la cuenta rrhh.
// `tablaLista: false` avisa que falta correr el SQL de la tabla en Supabase (el panel muestra cómo).
export const GET: APIRoute = async (context) => {
  if (!puedeAdministrarRrhh(context.locals.usuario)) return noAutorizado();
  return handleApiRoute(async () => {
    const [resultado, tabla] = await Promise.all([
      getRrhhVacaciones(),
      listEstadosResumen().then(
        () => ({ lista: true as const, error: null }),
        (err: unknown) => ({ lista: false as const, error: err instanceof Error ? err.message : String(err) })
      ),
    ]);
    return {
      tablaLista: tabla.lista,
      errorTabla: tabla.error,
      empleados: resultado.rows
        .map((r) => ({ id: r.id, nombre: r.nombre, departamento: r.departamento, puesto: r.puesto, estado: r.estadoResumen }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    };
  });
};

// PUT /api/rrhh-resumen-estados — cambia el estado de un empleado en el Resumen. `normal` borra la fila.
export const PUT: APIRoute = async (context) => {
  const usuario = context.locals.usuario;
  if (!puedeAdministrarRrhh(usuario)) return noAutorizado();
  return handleApiRoute(async () => {
    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      throw new ApiValidationError('JSON inválido');
    }
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    const { empleadoId, empleadoNombre, estado } = parsed.data;
    try {
      await guardarEstadoResumen(empleadoId, empleadoNombre, estado, usuario!.username);
    } catch (err) {
      console.error('[rrhh-resumen-estados]', err);
      throw new ApiValidationError(
        `No se pudo guardar (${err instanceof Error ? err.message : 'error desconocido'}). ¿Se corrió el SQL de la tabla rrhh_resumen_estado en Supabase?`
      );
    }
    return { empleadoId, estado };
  });
};

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { borrarCarasDeEmpleado, listCaras } from '@/lib/supabase/fichaje-caras';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const deleteSchema = z.object({ empleadoId: z.number().int().positive() });

// Qué motor generó los vectores del backup: si algún día cambia (otro modelo, otro detector), los vectores viejos dejan de ser
// comparables, y este dato avisa con qué hay que restaurarlos. Mantener en sync con loadFaceApi() en fichaje-shared.ts.
const MOTOR_RECONOCIMIENTO = 'face-api (@vladmandic/face-api): detector SSD MobileNet v1, landmarks 68 completos, red de reconocimiento de 128 dimensiones';

// GET /api/admin/fichaje-caras — backup de todas las plantillas faciales en JSON (se descarga como archivo). Solo dev.
// Es un dato biométrico: el archivo hay que guardarlo con el mismo cuidado que la base (acceso restringido, sin mandarlo por mail).
export const GET: APIRoute = async (context) => {
  const usuario = context.locals.usuario;
  if (usuario?.rol !== 'dev') {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  try {
    const caras = await listCaras();
    const porEmpleado = new Map<number, { empleadoId: number; empleadoNombre: string; muestras: { creadoEn: string; descriptor: number[] }[] }>();
    for (const c of caras) {
      const persona = porEmpleado.get(c.empleadoId) ?? { empleadoId: c.empleadoId, empleadoNombre: c.empleadoNombre, muestras: [] };
      persona.muestras.push({ creadoEn: c.creadoEn, descriptor: c.descriptor });
      porEmpleado.set(c.empleadoId, persona);
    }
    const personas = [...porEmpleado.values()].sort((a, b) => a.empleadoNombre.localeCompare(b.empleadoNombre, 'es'));
    const ahora = new Date();
    const backup = {
      formato: 'fichaje-caras-backup',
      version: 1,
      generadoEn: ahora.toISOString(),
      generadoPor: usuario.username,
      motor: MOTOR_RECONOCIMIENTO,
      dimensionVector: 128,
      totalPersonas: personas.length,
      totalMuestras: caras.length,
      personas,
    };
    return new Response(JSON.stringify(backup), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="fichaje-caras-backup-${ahora.toISOString().slice(0, 10)}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[admin/fichaje-caras] backup', err);
    return jsonResponse({ ok: false, error: 'No se pudo generar el backup' }, { status: 500 });
  }
};

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

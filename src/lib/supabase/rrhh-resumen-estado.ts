import { getSupabaseAdminClient } from './admin';
import type { EstadoResumen, EstadoResumenGuardado } from '@/lib/rrhh-resumen-estado';

/**
 * Estados especiales de empleados en el Resumen de RRHH. Tabla `rrhh_resumen_estado` — se crea a mano en el SQL editor
 * de Supabase (no hay migraciones en el repo). RLS default-deny: único acceso vía estas funciones desde /api routes y
 * desde el servidor, mismo patrón que fichaje-caras.ts. Quien NO tiene fila está en estado "normal".
 *
 *   create table if not exists public.rrhh_resumen_estado (
 *     empleado_id integer primary key,                                   -- hr.employee.id en Odoo
 *     estado text not null check (estado in ('reporte_perfecto', 'ignorar')),
 *     empleado_nombre text,                                              -- solo de referencia
 *     actualizado_por text,                                              -- usuario de la web del último cambio
 *     actualizado_en timestamptz not null default now()
 *   );
 *   alter table public.rrhh_resumen_estado enable row level security;
 *   revoke all on public.rrhh_resumen_estado from anon, authenticated;
 *   grant all on public.rrhh_resumen_estado to service_role;
 */

/** Lectura que usa el Resumen: si la tabla todavía no existe o falla, devuelve vacío y el Resumen se ve como siempre. */
export async function getEstadosResumen(): Promise<Map<number, EstadoResumenGuardado>> {
  try {
    return await listEstadosResumen();
  } catch (err) {
    console.warn('[rrhh-resumen-estado] no se pudieron leer los estados, el Resumen se muestra sin ellos:', err instanceof Error ? err.message : err);
    return new Map();
  }
}

/** Lectura estricta (el panel de administración necesita saber si la tabla falta). */
export async function listEstadosResumen(): Promise<Map<number, EstadoResumenGuardado>> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.from('rrhh_resumen_estado').select('empleado_id, estado');
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [r.empleado_id as number, r.estado as EstadoResumenGuardado]));
}

/** `normal` borra la fila (es el estado por defecto); los otros estados la crean o actualizan. */
export async function guardarEstadoResumen(empleadoId: number, empleadoNombre: string, estado: EstadoResumen, usuario: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  if (estado === 'normal') {
    const { error } = await admin.from('rrhh_resumen_estado').delete().eq('empleado_id', empleadoId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await admin.from('rrhh_resumen_estado').upsert(
    { empleado_id: empleadoId, estado, empleado_nombre: empleadoNombre, actualizado_por: usuario, actualizado_en: new Date().toISOString() },
    { onConflict: 'empleado_id' }
  );
  if (error) throw new Error(error.message);
}

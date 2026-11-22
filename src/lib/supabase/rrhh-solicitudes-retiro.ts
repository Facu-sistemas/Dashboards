import { getSupabaseAdminClient } from './admin';
import type { EstadoSolicitud, SolicitudRetiro } from '@/lib/rrhh-solicitudes';

/**
 * Solicitudes de retiro anticipado. Tabla `rrhh_solicitudes_retiro` — SQL en docs/rrhh-solicitudes-retiro.sql, se corre a
 * mano en Supabase. RLS default-deny: único acceso vía estas funciones desde /api routes (mismo patrón que fichaje-caras.ts).
 */

const COLUMNAS = 'id, empleado_id, empleado_nombre, fecha, hora_retiro, motivo, estado, creada_en, resuelta_por, resuelta_en, comentario_rrhh, visto_empleado_en';

type Fila = {
  id: string;
  empleado_id: number;
  empleado_nombre: string;
  fecha: string;
  hora_retiro: string;
  motivo: string;
  estado: EstadoSolicitud;
  creada_en: string;
  resuelta_por: string | null;
  resuelta_en: string | null;
  comentario_rrhh: string | null;
  visto_empleado_en: string | null;
};

function aSolicitud(r: Fila): SolicitudRetiro {
  return {
    id: r.id,
    empleadoId: r.empleado_id,
    empleadoNombre: r.empleado_nombre,
    fecha: r.fecha,
    horaRetiro: r.hora_retiro,
    motivo: r.motivo,
    estado: r.estado,
    creadaEn: r.creada_en,
    resueltaPor: r.resuelta_por,
    resueltaEn: r.resuelta_en,
    comentarioRrhh: r.comentario_rrhh,
    vistaPorEmpleado: r.visto_empleado_en !== null,
  };
}

export async function listSolicitudes(): Promise<SolicitudRetiro[]> {
  const { data, error } = await getSupabaseAdminClient().from('rrhh_solicitudes_retiro').select(COLUMNAS).order('creada_en', { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Fila[]).map(aSolicitud);
}

export async function listSolicitudesDeEmpleado(empleadoId: number): Promise<SolicitudRetiro[]> {
  const { data, error } = await getSupabaseAdminClient()
    .from('rrhh_solicitudes_retiro')
    .select(COLUMNAS)
    .eq('empleado_id', empleadoId)
    .order('creada_en', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Fila[]).map(aSolicitud);
}

export async function crearSolicitud(s: { empleadoId: number; empleadoNombre: string; fecha: string; horaRetiro: string; motivo: string }): Promise<void> {
  const { error } = await getSupabaseAdminClient().from('rrhh_solicitudes_retiro').insert({
    empleado_id: s.empleadoId,
    empleado_nombre: s.empleadoNombre,
    fecha: s.fecha,
    hora_retiro: s.horaRetiro,
    motivo: s.motivo,
  });
  if (error) throw new Error(error.message);
}

/** Hay otra pendiente del mismo empleado para ese día. */
export async function tienePendienteEseDia(empleadoId: number, fecha: string): Promise<boolean> {
  const { count, error } = await getSupabaseAdminClient()
    .from('rrhh_solicitudes_retiro')
    .select('id', { count: 'exact', head: true })
    .eq('empleado_id', empleadoId)
    .eq('fecha', fecha)
    .eq('estado', 'pendiente');
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/** Resuelve solo si sigue pendiente (así dos clics o dos personas no la pisan). Devuelve false si ya estaba resuelta. */
export async function resolverSolicitud(id: string, estado: 'aprobada' | 'rechazada', usuario: string, comentario: string | null): Promise<boolean> {
  const { data, error } = await getSupabaseAdminClient()
    .from('rrhh_solicitudes_retiro')
    .update({ estado, resuelta_por: usuario, resuelta_en: new Date().toISOString(), comentario_rrhh: comentario })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** El empleado cancela una solicitud propia mientras sigue pendiente. Devuelve false si ya no se puede (resuelta, ajena o inexistente). */
export async function cancelarSolicitud(id: string, empleadoId: number): Promise<boolean> {
  const { data, error } = await getSupabaseAdminClient()
    .from('rrhh_solicitudes_retiro')
    .update({ estado: 'cancelada', resuelta_en: new Date().toISOString(), resuelta_por: 'empleado' })
    .eq('id', id)
    .eq('empleado_id', empleadoId)
    .eq('estado', 'pendiente')
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** El empleado abrió su pestaña de solicitudes: sus respuestas pendientes de ver quedan como vistas. */
export async function marcarVistasPorEmpleado(empleadoId: number): Promise<void> {
  const { error } = await getSupabaseAdminClient()
    .from('rrhh_solicitudes_retiro')
    .update({ visto_empleado_en: new Date().toISOString() })
    .eq('empleado_id', empleadoId)
    .in('estado', ['aprobada', 'rechazada'])
    .is('visto_empleado_en', null);
  if (error) throw new Error(error.message);
}

/** Cuántas esperan respuesta de RRHH (globito de la pestaña). Si la tabla falta o falla, 0: no tiene que romper el menú. */
export async function contarPendientes(): Promise<number> {
  try {
    const { count, error } = await getSupabaseAdminClient().from('rrhh_solicitudes_retiro').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Borra la solicitud definitivamente (solo la usa RRHH/dev). Devuelve false si no existía. */
export async function eliminarSolicitud(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdminClient().from('rrhh_solicitudes_retiro').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

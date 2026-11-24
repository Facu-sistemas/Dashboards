import { getSupabaseAdminClient } from './admin';
import type { EstadoSolicitud, SolicitudRetiro } from '@/lib/rrhh-solicitudes';

/**
 * Solicitudes de retiro anticipado. Tabla `rrhh_solicitudes_retiro` — SQL en docs/rrhh-solicitudes-retiro.sql, se corre a
 * mano en Supabase. RLS default-deny: único acceso vía estas funciones desde /api routes (mismo patrón que fichaje-caras.ts).
 */

const COLUMNAS = 'id, empleado_id, empleado_nombre, fecha, hora_retiro, motivo, estado, creada_en, resuelta_por, resuelta_en, comentario_rrhh, visto_empleado_en, aprobo_rrhh_por, aprobo_rrhh_en, aprobo_lider_por, aprobo_lider_en, comentario_lider';

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
  aprobo_rrhh_por: string | null;
  aprobo_rrhh_en: string | null;
  aprobo_lider_por: string | null;
  aprobo_lider_en: string | null;
  comentario_lider: string | null;
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
    aproboRrhhPor: r.aprobo_rrhh_por,
    aproboRrhhEn: r.aprobo_rrhh_en,
    aproboLiderPor: r.aprobo_lider_por,
    aproboLiderEn: r.aprobo_lider_en,
    comentarioLider: r.comentario_lider,
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

/**
 * Rechaza (cualquiera de los dos pasos alcanza para rechazar) solo si sigue pendiente, así dos clics o dos personas no la pisan.
 * El comentario va al campo del paso que rechaza. Devuelve false si ya estaba resuelta.
 */
export async function resolverSolicitud(id: string, estado: 'aprobada' | 'rechazada', usuario: string, comentario: string | null, paso: 'rrhh' | 'lider' = 'rrhh'): Promise<boolean> {
  const { data, error } = await getSupabaseAdminClient()
    .from('rrhh_solicitudes_retiro')
    .update({ estado, resuelta_por: usuario, resuelta_en: new Date().toISOString(), ...(paso === 'lider' ? { comentario_lider: comentario } : { comentario_rrhh: comentario }) })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export type ResultadoAprobacion = 'registrada' | 'aprobada-final' | 'ya-resuelta' | 'paso-ya-dado' | 'misma-persona';

/**
 * Da uno de los dos checks de la doble aprobación. La solicitud pasa a "aprobada" recién cuando están los dos, de dos personas
 * distintas (una misma cuenta no puede dar los dos checks, ni siquiera el dev).
 */
export async function aprobarPaso(id: string, paso: 'rrhh' | 'lider', usuario: string, comentario: string | null): Promise<ResultadoAprobacion> {
  const db = getSupabaseAdminClient();
  const { data: actual, error: errLeer } = await db.from('rrhh_solicitudes_retiro').select(COLUMNAS).eq('id', id).maybeSingle();
  if (errLeer) throw new Error(errLeer.message);
  const fila = actual as Fila | null;
  if (!fila || fila.estado !== 'pendiente') return 'ya-resuelta';
  const otro = paso === 'rrhh' ? fila.aprobo_lider_por : fila.aprobo_rrhh_por;
  if (otro && otro.trim().toLowerCase() === usuario.trim().toLowerCase()) return 'misma-persona';
  const yaDado = paso === 'rrhh' ? fila.aprobo_rrhh_por : fila.aprobo_lider_por;
  if (yaDado) return 'paso-ya-dado';

  const ahora = new Date().toISOString();
  const campos = paso === 'rrhh'
    ? { aprobo_rrhh_por: usuario, aprobo_rrhh_en: ahora, ...(comentario ? { comentario_rrhh: comentario } : {}) }
    : { aprobo_lider_por: usuario, aprobo_lider_en: ahora, ...(comentario ? { comentario_lider: comentario } : {}) };
  const { data: upd, error } = await db
    .from('rrhh_solicitudes_retiro')
    .update(campos)
    .eq('id', id)
    .eq('estado', 'pendiente')
    .is(paso === 'rrhh' ? 'aprobo_rrhh_por' : 'aprobo_lider_por', null)
    .select(COLUMNAS);
  if (error) throw new Error(error.message);
  const nueva = ((upd ?? []) as Fila[])[0];
  if (!nueva) return 'paso-ya-dado';

  if (nueva.aprobo_rrhh_por && nueva.aprobo_lider_por) {
    const { error: errFinal } = await db
      .from('rrhh_solicitudes_retiro')
      .update({ estado: 'aprobada', resuelta_por: `${nueva.aprobo_rrhh_por} y ${nueva.aprobo_lider_por}`, resuelta_en: ahora })
      .eq('id', id)
      .eq('estado', 'pendiente');
    if (errFinal) throw new Error(errFinal.message);
    return 'aprobada-final';
  }
  return 'registrada';
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
    return await contarPendientesOError();
  } catch {
    return 0;
  }
}

export interface EstadoSolicitudes {
  pendientes: number;
  /** Cuándo se creó la solicitud más reciente (de cualquier estado); null si no hay ninguna. */
  ultima: string | null;
  /** Pendientes creadas después de `desde` (0 si no se pasó). */
  nuevas: number;
}

/**
 * Estado para el aviso en vivo. Se avisa por "hay solicitudes pendientes creadas después de la última que vio esta pantalla" y no por
 * "subió la cantidad": así no se pierde una nueva cuando justo se resolvió otra, y al volver a una pestaña dormida se avisa lo que llegó mientras tanto.
 */
export async function estadoSolicitudes(desde?: string): Promise<EstadoSolicitudes> {
  const db = getSupabaseAdminClient();
  const [pend, ult, nue] = await Promise.all([
    db.from('rrhh_solicitudes_retiro').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
    db.from('rrhh_solicitudes_retiro').select('creada_en').order('creada_en', { ascending: false }).limit(1),
    desde
      ? db.from('rrhh_solicitudes_retiro').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente').gt('creada_en', desde)
      : Promise.resolve({ count: 0, error: null }),
  ]);
  const error = pend.error ?? ult.error ?? nue.error;
  if (error) throw new Error(error.message);
  return { pendientes: pend.count ?? 0, ultima: (ult.data?.[0]?.creada_en as string | undefined) ?? null, nuevas: nue.count ?? 0 };
}

/** Igual pero tira el error: el aviso en vivo no tiene que confundir una falla con "0 pendientes". */
export async function contarPendientesOError(): Promise<number> {
  const { count, error } = await getSupabaseAdminClient().from('rrhh_solicitudes_retiro').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Borra la solicitud definitivamente (solo la usa RRHH/dev). Devuelve false si no existía. */
export async function eliminarSolicitud(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdminClient().from('rrhh_solicitudes_retiro').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

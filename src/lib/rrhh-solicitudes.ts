/** Tipos compartidos (servidor y navegador) de las solicitudes de retiro anticipado. */
export type EstadoSolicitud = 'pendiente' | 'aprobada' | 'rechazada' | 'cancelada';

export interface SolicitudRetiro {
  id: string;
  empleadoId: number;
  empleadoNombre: string;
  fecha: string; // YYYY-MM-DD
  horaRetiro: string; // HH:MM
  motivo: string;
  estado: EstadoSolicitud;
  creadaEn: string;
  resueltaPor: string | null;
  resueltaEn: string | null;
  comentarioRrhh: string | null;
  /** El empleado ya vio la respuesta de RRHH. */
  vistaPorEmpleado: boolean;
  /** Doble aprobación: hace falta el check de RRHH y el de un líder (o dev), de dos personas distintas. */
  aproboRrhhPor: string | null;
  aproboRrhhEn: string | null;
  aproboLiderPor: string | null;
  aproboLiderEn: string | null;
  comentarioLider: string | null;
}

export const ESTADO_SOLICITUD_TEXTO: Record<EstadoSolicitud, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
};

export type PasoAprobacion = 'rrhh' | 'lider';

/** Qué pasos de la doble aprobación faltan en una solicitud pendiente. */
export function pasosFaltantes(s: Pick<SolicitudRetiro, 'estado' | 'aproboRrhhPor' | 'aproboLiderPor'>): PasoAprobacion[] {
  if (s.estado !== 'pendiente') return [];
  const faltan: PasoAprobacion[] = [];
  if (!s.aproboRrhhPor) faltan.push('rrhh');
  if (!s.aproboLiderPor) faltan.push('lider');
  return faltan;
}

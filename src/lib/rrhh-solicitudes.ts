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
}

export const ESTADO_SOLICITUD_TEXTO: Record<EstadoSolicitud, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
};

import { getOdooConfig } from '../env';
import { OdooError } from './types';

/**
 * ÚNICO módulo del proyecto que escribe en Odoo — separado a propósito de
 * `client.ts`, que es de solo lectura (ver el comentario de ese archivo).
 *
 * Solo expone `marcarAsistencia`, que llama al mismo método que usa el
 * quiosco de Odoo (`hr.employee.attendance_manual`). Odoo decide solo si
 * corresponde entrada o salida según si el empleado tiene una asistencia
 * abierta. No hay un `create`/`write`/`unlink` genérico acá: agregar uno
 * rompería la razón de existir de este archivo.
 */

interface JsonRpcResponse<T> {
  result?: T;
  error?: { message: string; data?: { message?: string } };
}

async function rpc<T>(url: string, service: string, method: string, args: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: 1 }),
    });
  } catch (err) {
    throw new OdooError(`Network error contacting Odoo at ${url}`, err);
  }
  if (!res.ok) throw new OdooError(`Odoo HTTP error ${res.status} ${res.statusText}`);
  const payload = (await res.json()) as JsonRpcResponse<T>;
  if (payload.error) throw new OdooError(`Odoo RPC error: ${payload.error.data?.message ?? payload.error.message}`, payload.error);
  if (payload.result === undefined) throw new OdooError('Odoo RPC returned no result');
  return payload.result;
}

async function getUid(): Promise<number> {
  const config = getOdooConfig();
  if (config.uid) return config.uid;
  const uid = await rpc<number | false>(config.url, 'common', 'authenticate', [config.db, config.userEmail, config.apiKey, {}]);
  if (!uid) throw new OdooError('Odoo authentication failed: invalid DB, email, or API key');
  return uid;
}

type EstadoAsistencia = 'checked_in' | 'checked_out';

export interface ResultadoFichaje {
  empleado: string;
  /** Lo que se registró: entrada si antes estaba afuera, salida si estaba adentro. */
  accion: 'entrada' | 'salida';
  /** Hora real registrada en Odoo, ISO UTC. */
  hora: string | null;
}

interface EmpleadoAsistencia {
  [key: string]: unknown;
  name: string;
  attendance_state: EstadoAsistencia;
  last_attendance_id: [number, string] | false;
}

export async function marcarAsistencia(empleadoId: number): Promise<ResultadoFichaje> {
  const config = getOdooConfig();
  const uid = await getUid();
  const call = <T>(model: string, method: string, args: unknown[]) =>
    rpc<T>(config.url, 'object', 'execute_kw', [config.db, uid, config.apiKey, model, method, args, { context: { lang: 'es_AR' } }]);

  const [antes] = await call<EmpleadoAsistencia[]>('hr.employee', 'read', [[empleadoId], ['name', 'attendance_state', 'last_attendance_id']]);
  if (!antes) throw new OdooError(`Empleado ${empleadoId} no encontrado en Odoo`);

  const respuesta = await call<{ warning?: string }>('hr.employee', 'attendance_manual', [
    [empleadoId],
    'hr_attendance.hr_attendance_action_my_attendances',
  ]);
  if (respuesta.warning) throw new OdooError(`Odoo rechazó el fichaje: ${respuesta.warning}`);

  // Confirmación: releer el estado. Si no cambió, Odoo no registró nada.
  const [despues] = await call<EmpleadoAsistencia[]>('hr.employee', 'read', [[empleadoId], ['attendance_state', 'last_attendance_id']]);
  if (!despues || despues.attendance_state === antes.attendance_state) {
    throw new OdooError('Odoo no registró el fichaje (el estado de asistencia no cambió)');
  }

  const accion = despues.attendance_state === 'checked_in' ? 'entrada' : 'salida';
  let hora: string | null = null;
  if (despues.last_attendance_id) {
    const [att] = await call<{ check_in: string; check_out: string | false }[]>('hr.attendance', 'read', [
      [despues.last_attendance_id[0]],
      ['check_in', 'check_out'],
    ]);
    const crudo = accion === 'entrada' ? att?.check_in : att?.check_out;
    // Odoo devuelve "YYYY-MM-DD HH:MM:SS" en UTC.
    hora = crudo ? `${crudo.replace(' ', 'T')}Z` : null;
  }

  return { empleado: antes.name, accion, hora };
}

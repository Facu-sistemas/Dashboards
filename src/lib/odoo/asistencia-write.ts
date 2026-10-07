import { getOdooConfig } from '../env';
import { OdooError } from './types';

/**
 * ÚNICO módulo del proyecto que escribe en Odoo — separado a propósito de
 * `client.ts`, que es de solo lectura (ver el comentario de ese archivo).
 *
 * Solo expone `marcarAsistencia`, que replica lo que hace el quiosco de
 * Odoo 17: si el empleado está afuera crea una `hr.attendance` con
 * `check_in`; si está adentro cierra la abierta con `check_out`. (Odoo 17 no
 * tiene un método RPC tipo `attendance_manual`: la lógica del quiosco vive en
 * un controlador web.) No hay un `create`/`write`/`unlink` genérico acá:
 * agregar uno rompería la razón de existir de este archivo.
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

/** Odoo guarda los datetime en UTC con formato "YYYY-MM-DD HH:MM:SS". */
function ahoraOdoo(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export async function marcarAsistencia(empleadoId: number): Promise<ResultadoFichaje> {
  const config = getOdooConfig();
  const uid = await getUid();
  const call = <T>(model: string, method: string, args: unknown[]) =>
    rpc<T>(config.url, 'object', 'execute_kw', [config.db, uid, config.apiKey, model, method, args, { context: { lang: 'es_AR' } }]);

  const [empleado] = await call<EmpleadoAsistencia[]>('hr.employee', 'read', [[empleadoId], ['name', 'attendance_state', 'last_attendance_id']]);
  if (!empleado) throw new OdooError(`Empleado ${empleadoId} no encontrado en Odoo`);

  const hora = ahoraOdoo();

  if (empleado.attendance_state === 'checked_out') {
    await call<number>('hr.attendance', 'create', [[{ employee_id: empleadoId, check_in: hora, in_mode: 'kiosk' }]]);
    return { empleado: empleado.name, accion: 'entrada', hora: `${hora.replace(' ', 'T')}Z` };
  }

  const [abierta] = await call<{ id: number }[]>('hr.attendance', 'search_read', [
    [['employee_id', '=', empleadoId], ['check_out', '=', false]],
    ['id'],
    0,
    1,
    'check_in desc',
  ]);
  if (!abierta) throw new OdooError('El empleado figura adentro pero no tiene una asistencia abierta en Odoo');
  await call<boolean>('hr.attendance', 'write', [[abierta.id], { check_out: hora, out_mode: 'kiosk' }]);
  return { empleado: empleado.name, accion: 'salida', hora: `${hora.replace(' ', 'T')}Z` };
}

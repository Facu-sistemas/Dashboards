import { getOdooConfig } from '@/lib/env';
import { OdooError } from './types';
import { getEstadosResumen } from '@/lib/supabase/rrhh-resumen-estado';

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

/** Minuto del día (hora Argentina, UTC-3) a partir del cual una primera fichada ya no cuenta como entrada: 10:30. */
const CORTE_ENTRADA_MIN = 10 * 60 + 30;
const OFFSET_ARG_MS = 3 * 60 * 60 * 1000;

/** `hora` en formato Odoo (UTC). ¿Son las 10:30 o más en Argentina? */
export function esPrimeraFichadaTardia(hora: string): boolean {
  const local = new Date(Date.parse(`${hora.replace(' ', 'T')}Z`) - OFFSET_ARG_MS);
  return local.getUTCHours() * 60 + local.getUTCMinutes() >= CORTE_ENTRADA_MIN;
}

/** Ventana UTC del día argentino de `hora`: arranca a las 03:00 UTC. */
export function diaLocalUtc(hora: string): { inicio: string; fin: string } {
  const local = new Date(Date.parse(`${hora.replace(' ', 'T')}Z`) - OFFSET_ARG_MS);
  const dia = local.toISOString().slice(0, 10);
  const siguiente = new Date(Date.parse(`${dia}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { inicio: `${dia} 03:00:00`, fin: `${siguiente} 03:00:00` };
}

/** Los ignorados y los de "reporte perfecto" (RRHH > Administración) fichan como siempre: sin corte de las 10:30. Si no se puede consultar, no se exceptúa a nadie. */
async function estaExceptuado(empleadoId: number): Promise<boolean> {
  try {
    return (await getEstadosResumen()).has(empleadoId);
  } catch (err) {
    console.error('[asistencia-write] no se pudo leer el estado de RRHH del empleado', err);
    return false;
  }
}

/** Pasa un ISO a "YYYY-MM-DD HH:MM:SS" en UTC. */
function aFormatoOdoo(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * `horaIso` solo se usa para fichadas diferidas (el celular se quedó sin internet y las manda al volver): se registra
 * con la hora en que se tocó, no con la de llegada. Se corrige para no pisar las asistencias vecinas (Odoo rechaza
 * solapamientos): una entrada no puede ser anterior al cierre de la asistencia previa ni una salida anterior a su entrada.
 */
export async function marcarAsistencia(empleadoId: number, horaIso?: string): Promise<ResultadoFichaje> {
  const config = getOdooConfig();
  const uid = await getUid();
  const call = <T>(model: string, method: string, args: unknown[]) =>
    rpc<T>(config.url, 'object', 'execute_kw', [config.db, uid, config.apiKey, model, method, args, { context: { lang: 'es_AR' } }]);

  const [empleado] = await call<EmpleadoAsistencia[]>('hr.employee', 'read', [[empleadoId], ['name', 'attendance_state', 'last_attendance_id']]);
  if (!empleado) throw new OdooError(`Empleado ${empleadoId} no encontrado en Odoo`);

  let hora = horaIso ? aFormatoOdoo(horaIso) : ahoraOdoo();

  if (empleado.attendance_state === 'checked_out') {
    if (horaIso && empleado.last_attendance_id) {
      const [ultima] = await call<{ check_out: string | false }[]>('hr.attendance', 'read', [[empleado.last_attendance_id[0]], ['check_out']]);
      if (ultima && typeof ultima.check_out === 'string' && ultima.check_out > hora) hora = ultima.check_out;
    }

    // Jornada de 6:00 a 14:18: pasadas las 10:30 una primera fichada del día no puede ser la entrada, es una salida cuya entrada no se
    // fichó. Odoo no admite una salida sin entrada, así que se guarda una marca de 0 hs (entrada = salida) que la bandeja de novedades
    // muestra como "Marca incompleta" para que RRHH cargue la hora real. No se aplica a quienes RRHH ignora o tiene en "reporte perfecto".
    if (esPrimeraFichadaTardia(hora) && !(await estaExceptuado(empleadoId))) {
      const dia = diaLocalUtc(hora);
      const delDia = await call<{ id: number }[]>('hr.attendance', 'search_read', [
        [['employee_id', '=', empleadoId], ['check_in', '>=', dia.inicio], ['check_in', '<', dia.fin]],
        ['id'],
        0,
        1,
      ]);
      if (delDia.length === 0) {
        await call<number>('hr.attendance', 'create', [[{ employee_id: empleadoId, check_in: hora, check_out: hora, in_mode: 'kiosk', out_mode: 'kiosk' }]]);
        return { empleado: empleado.name, accion: 'salida', hora: `${hora.replace(' ', 'T')}Z` };
      }
    }
    await call<number>('hr.attendance', 'create', [[{ employee_id: empleadoId, check_in: hora, in_mode: 'kiosk' }]]);
    return { empleado: empleado.name, accion: 'entrada', hora: `${hora.replace(' ', 'T')}Z` };
  }

  const [abierta] = await call<{ id: number; check_in: string }[]>('hr.attendance', 'search_read', [
    [['employee_id', '=', empleadoId], ['check_out', '=', false]],
    ['id', 'check_in'],
    0,
    1,
    'check_in desc',
  ]);
  if (!abierta) throw new OdooError('El empleado figura adentro pero no tiene una asistencia abierta en Odoo');
  if (horaIso && abierta.check_in > hora) hora = abierta.check_in;
  await call<boolean>('hr.attendance', 'write', [[abierta.id], { check_out: hora, out_mode: 'kiosk' }]);
  return { empleado: empleado.name, accion: 'salida', hora: `${hora.replace(' ', 'T')}Z` };
}

import { getOdooConfig } from '@/lib/env';
import { ApiValidationError } from '@/lib/api-helpers';
import { addDaysIso } from '@/lib/date';
import { OdooError } from './types';
import { getArgentinaTodayIso } from './oee';
import { esFinDeSemana } from './rrhh-quincena';
import {
  BANCO_HORAS_TIPO_ID,
  HORAS_DIA_ASIGNACION,
  MAX_HORAS_AUSENCIA,
  MAX_HORAS_EXTRA,
  TIPOS_AUSENCIA_CARGABLES,
  TIPOS_AUSENCIA_DIA_COMPLETO,
} from '@/lib/rrhh-novedades-tipos';

/**
 * Segundo (y último) módulo del proyecto que escribe en Odoo, junto a `asistencia-write.ts` — separado a propósito de
 * `client.ts`, que es de solo lectura. Autorizado por el usuario el 2026-11-16 SOLO para la bandeja de Novedades de RRHH
 * (Horas > Por día): resolver una anomalía de asistencia cuando RRHH decide qué fue. Cuatro operaciones acotadas, cada
 * una para un tipo de novedad:
 *
 *  - `cargarAusenciaPorHoras`     horas faltantes   → ausencia (`hr.leave`) por horas, aprobada.
 *  - `cargarAusenciaDiaCompleto`  sin fichada       → ausencia (`hr.leave`) de día completo, aprobada.
 *  - `acreditarHorasExtra`        horas extra       → asignación (`hr.leave.allocation`) al banco de horas, aprobada.
 *  - `corregirFichada`            sin salida / marca incompleta → corrige UNA fichada (`hr.attendance`) existente.
 *
 * No hay un `create`/`write`/`unlink` genérico acá y NO se borra nada: si algo sale a medias queda una ausencia o
 * asignación sin aprobar que RRHH ve y resuelve en Odoo. Todo lo cargado dice en la descripción que vino de la web y
 * quién lo aprobó.
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

type Call = <T>(model: string, method: string, args: unknown[], kwargs?: Record<string, unknown>) => Promise<T>;

async function conectar(): Promise<Call> {
  const config = getOdooConfig();
  const uid = await getUid();
  return <T>(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}) =>
    rpc<T>(config.url, 'object', 'execute_kw', [config.db, uid, config.apiKey, model, method, args, { context: { lang: 'es_AR' }, ...kwargs }]);
}

/** Lo que devuelve cada operación: un texto listo para mostrar y un aviso si algo quedó a medias. */
export interface ResultadoEscritura {
  id: number;
  empleado: string;
  fecha: string;
  /** Texto para el cartel de la pantalla. */
  resumen: string;
  /** `true` si quedó aprobada / aplicada. */
  aprobada: boolean;
  /** Si no es null, algo quedó a medias y RRHH tiene que mirarlo en Odoo. */
  aviso: string | null;
  /** Horas que quedaron en Odoo (se lee de vuelta, no se asume). */
  horas?: number;
  estado?: string;
}

const ESTADOS_VIVOS = ['confirm', 'validate1', 'validate'];

const fechaCorta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const horasComa = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');
const redondear2 = (v: number) => Math.round(v * 100) / 100;

/** Solo se cargan novedades de días ya cerrados y no más viejos que 93 días (más atrás se hace directo en Odoo). */
function validarDiaCerrado(fecha: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ApiValidationError('Fecha inválida (usar YYYY-MM-DD)');
  const hoy = getArgentinaTodayIso();
  if (fecha >= hoy) throw new ApiValidationError('Solo se cargan novedades de días ya cerrados (anteriores a hoy).');
  if (fecha < addDaysIso(hoy, -93)) throw new ApiValidationError('La novedad es de hace más de 93 días: cargala directo en Odoo.');
}

async function leerEmpleado(call: Call, empleadoId: number): Promise<{ id: number; name: string }> {
  const [empleado] = await call<{ id: number; name: string; active: boolean }[]>('hr.employee', 'read', [[empleadoId], ['name', 'active']]);
  if (!empleado || !empleado.active) throw new ApiValidationError('El empleado no existe o no está activo en Odoo.');
  return empleado;
}

type LeaveRead = { state: string; number_of_hours_display: number; number_of_days: number; request_unit_hours: boolean };

/** Aprueba una ausencia recién creada: los tipos con doble validación pasan por `validate1` antes de quedar aprobados. */
async function aprobarAusencia(call: Call, id: number): Promise<{ actual: LeaveRead; aviso: string | null }> {
  const leer = async () => (await call<LeaveRead[]>('hr.leave', 'read', [[id], ['state', 'number_of_hours_display', 'number_of_days', 'request_unit_hours']]))[0]!;
  let aviso: string | null = null;
  let actual = await leer();
  try {
    if (actual.state === 'confirm') {
      await call<unknown>('hr.leave', 'action_approve', [[id]]);
      actual = await leer();
    }
    if (actual.state === 'validate1') {
      await call<unknown>('hr.leave', 'action_validate', [[id]]);
      actual = await leer();
    }
  } catch (err) {
    aviso = `La ausencia se creó (n.º ${id}) pero no se pudo aprobar: ${err instanceof OdooError ? err.message : 'error desconocido'}. Aprobala en Odoo.`;
    actual = await leer();
  }
  return { actual, aviso };
}

/** Falla si el empleado ya tiene una ausencia viva ese día (cualquier tipo): evita duplicar y los solapamientos que Odoo rechaza. */
async function exigirDiaLibre(call: Call, empleadoId: number, fecha: string) {
  const existentes = await call<{ id: number; holiday_status_id: [number, string]; number_of_hours_display: number }[]>('hr.leave', 'search_read', [
    [
      ['employee_id', '=', empleadoId],
      ['state', 'in', ESTADOS_VIVOS],
      ['request_date_from', '<=', fecha],
      ['request_date_to', '>=', fecha],
    ],
    ['holiday_status_id', 'number_of_hours_display'],
  ]);
  if (existentes.length > 0) {
    const l = existentes[0]!;
    throw new ApiValidationError(
      `Ese día ya tiene una ausencia cargada (${l.holiday_status_id[1]}, ${horasComa(l.number_of_hours_display)} hs, n.º ${l.id}). Revisala en Odoo antes de cargar otra.`
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. Horas faltantes → ausencia por horas
// ---------------------------------------------------------------------------------------------------------------------

export interface CargarAusenciaInput {
  empleadoId: number;
  /** Día de la novedad (ISO). Tiene que ser anterior a hoy. */
  fecha: string;
  tipoId: number;
  /** Horas a cargar, entre 0,1 y 8,3. */
  horas: number;
  /** Texto libre que RRHH quiera dejar en la ausencia. */
  nota?: string;
  /** Usuario de la web que aprueba: queda en la descripción para saber quién la cargó. */
  aprobadoPor: string;
}

export async function cargarAusenciaPorHoras(input: CargarAusenciaInput): Promise<ResultadoEscritura> {
  const { empleadoId, fecha, tipoId, aprobadoPor } = input;
  const horas = redondear2(input.horas);

  validarDiaCerrado(fecha);
  const tipo = TIPOS_AUSENCIA_CARGABLES.find((t) => t.id === tipoId);
  if (!tipo) throw new ApiValidationError('Ese tipo de ausencia no se puede cargar desde la web.');
  if (!Number.isFinite(horas) || horas < 0.1 || horas > MAX_HORAS_AUSENCIA) {
    throw new ApiValidationError(`Las horas tienen que estar entre 0,1 y ${String(MAX_HORAS_AUSENCIA).replace('.', ',')}.`);
  }

  const call = await conectar();
  const empleado = await leerEmpleado(call, empleadoId);

  // No duplicar: nada del mismo tipo ese día, ni una ausencia de día completo que ya lo cubra.
  const existentes = await call<{ id: number; holiday_status_id: [number, string]; request_unit_hours: boolean; number_of_hours_display: number }[]>(
    'hr.leave',
    'search_read',
    [
      [
        ['employee_id', '=', empleadoId],
        ['state', 'in', ESTADOS_VIVOS],
        ['request_date_from', '<=', fecha],
        ['request_date_to', '>=', fecha],
      ],
      ['holiday_status_id', 'request_unit_hours', 'number_of_hours_display'],
    ]
  );
  const mismoTipo = existentes.find((l) => l.holiday_status_id[0] === tipoId);
  if (mismoTipo) {
    throw new ApiValidationError(`Ya hay una ausencia de ${tipo.nombre} ese día (n.º ${mismoTipo.id}, ${horasComa(mismoTipo.number_of_hours_display)} hs). Revisala en Odoo antes de cargar otra.`);
  }
  const diaCompleto = existentes.find((l) => !l.request_unit_hours);
  if (diaCompleto) {
    throw new ApiValidationError(`Ese día ya tiene una ausencia de día completo (${diaCompleto.holiday_status_id[1]}, n.º ${diaCompleto.id}).`);
  }

  const descripcion = `${input.nota?.trim() || 'Novedad de asistencia'} (cargada desde la web por ${aprobadoPor})`.slice(0, 300);
  // Se carga con el intervalo real, dentro de la jornada del calendario (06:00–14:18 = 09:00–17:18 UTC), arrancando a las 06:00
  // y durando `horas` (en minutos enteros): Odoo calcula `number_of_hours` con el calendario. Escribir las horas a mano no
  // sirve (Odoo las descarta y queda en 0, y no deja aprobar), ni tampoco un día feriado o fuera del calendario (cuenta 0 hs).
  const minutos = Math.round(horas * 60);
  const inicioUtc = `${fecha} 09:00:00`;
  const finUtc = `${fecha} ${String(9 + Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}:00`;
  const id = await call<number>('hr.leave', 'create', [
    {
      employee_id: empleadoId,
      holiday_status_id: tipoId,
      name: descripcion,
      request_date_from: fecha,
      request_date_to: fecha,
      request_unit_hours: true,
      date_from: inicioUtc,
      date_to: finUtc,
      // Los campos de Studio quedan iguales a las fechas para que la acción automática "Banco de horas" no las toque.
      x_studio_fecha_inicio: inicioUtc,
      x_studio_fecha_fin: finUtc,
    },
  ]);

  const { actual, aviso: avisoAprobacion } = await aprobarAusencia(call, id);
  let aviso = avisoAprobacion;
  if (!aviso && Math.abs(actual.number_of_hours_display - minutos / 60) > 0.02) {
    aviso = `Odoo guardó ${horasComa(actual.number_of_hours_display)} hs en lugar de las ${horasComa(horas)} hs pedidas. Revisá la ausencia n.º ${id} en Odoo.`;
  }
  const aprobada = actual.state === 'validate';
  return {
    id,
    empleado: empleado.name,
    fecha,
    horas: redondear2(actual.number_of_hours_display),
    estado: actual.state,
    aprobada,
    aviso,
    resumen: `Cargada en Odoo${aprobada ? ' y aprobada' : ''}: ${tipo.nombre}, ${horasComa(actual.number_of_hours_display)} hs, ${empleado.name}, ${fechaCorta(fecha)} (n.º ${id}).`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Sin fichada → ausencia de día completo
// ---------------------------------------------------------------------------------------------------------------------

export interface CargarDiaCompletoInput {
  empleadoId: number;
  fecha: string;
  tipoId: number;
  nota?: string;
  aprobadoPor: string;
}

export async function cargarAusenciaDiaCompleto(input: CargarDiaCompletoInput): Promise<ResultadoEscritura> {
  const { empleadoId, fecha, tipoId, aprobadoPor } = input;

  validarDiaCerrado(fecha);
  if (esFinDeSemana(fecha)) throw new ApiValidationError('Ese día es fin de semana: no corresponde una ausencia.');
  const tipo = TIPOS_AUSENCIA_DIA_COMPLETO.find((t) => t.id === tipoId);
  if (!tipo) throw new ApiValidationError('Ese tipo de ausencia no se puede cargar como día completo desde la web.');

  const call = await conectar();
  const empleado = await leerEmpleado(call, empleadoId);
  await exigirDiaLibre(call, empleadoId, fecha);

  const descripcion = `${input.nota?.trim() || 'Novedad de asistencia: día sin fichada'} (cargada desde la web por ${aprobadoPor})`.slice(0, 300);
  // Modo "días" estándar de Odoo: sin horas personalizadas ni medio día. Las fechas las calcula Odoo con el calendario.
  const id = await call<number>('hr.leave', 'create', [
    {
      employee_id: empleadoId,
      holiday_status_id: tipoId,
      name: descripcion,
      request_date_from: fecha,
      request_date_to: fecha,
      request_unit_hours: false,
      request_unit_half: false,
    },
  ]);

  const { actual, aviso: avisoAprobacion } = await aprobarAusencia(call, id);
  let aviso = avisoAprobacion;
  if (!aviso && actual.number_of_days <= 0) {
    aviso = `Odoo guardó 0 días en la ausencia n.º ${id}: ese día puede ser feriado o no laborable en el calendario. Revisala en Odoo.`;
  }
  const aprobada = actual.state === 'validate';
  return {
    id,
    empleado: empleado.name,
    fecha,
    horas: redondear2(actual.number_of_hours_display),
    estado: actual.state,
    aprobada,
    aviso,
    resumen: `Cargada en Odoo${aprobada ? ' y aprobada' : ''}: ${tipo.nombre}, día completo, ${empleado.name}, ${fechaCorta(fecha)} (n.º ${id}).`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Horas extra → asignación al banco de horas
// ---------------------------------------------------------------------------------------------------------------------

export interface AcreditarHorasInput {
  empleadoId: number;
  fecha: string;
  horas: number;
  nota?: string;
  aprobadoPor: string;
}

export async function acreditarHorasExtra(input: AcreditarHorasInput): Promise<ResultadoEscritura> {
  const { empleadoId, fecha, aprobadoPor } = input;
  const horas = redondear2(input.horas);

  validarDiaCerrado(fecha);
  if (!Number.isFinite(horas) || horas < 0.1 || horas > MAX_HORAS_EXTRA) {
    throw new ApiValidationError(`Las horas a acreditar tienen que estar entre 0,1 y ${MAX_HORAS_EXTRA}.`);
  }

  const call = await conectar();
  const empleado = await leerEmpleado(call, empleadoId);

  // No acreditar dos veces el mismo día: cualquier asignación de banco de horas con fecha de ese día ya cuenta (la bandeja
  // también deja de mostrar la novedad por eso).
  const previas = await call<{ id: number; name: string | false; number_of_hours_display: number }[]>('hr.leave.allocation', 'search_read', [
    [
      ['employee_id', '=', empleadoId],
      ['holiday_status_id', '=', BANCO_HORAS_TIPO_ID],
      ['state', 'in', ['confirm', 'validate', 'validate1']],
      ['date_from', '=', fecha],
    ],
    ['name', 'number_of_hours_display'],
  ]);
  if (previas.length > 0) {
    const p = previas[0]!;
    throw new ApiValidationError(
      `Ese día ya tiene horas acreditadas al banco (n.º ${p.id}, ${horasComa(p.number_of_hours_display)} hs${p.name ? `, «${p.name}»` : ''}). Revisala en Odoo.`
    );
  }

  const nombre = `Horas extra ${fecha}: ${input.nota?.trim() || 'novedad de asistencia'} (cargada desde la web por ${aprobadoPor})`.slice(0, 300);
  // Igual que las asignaciones que carga RRHH: la duración va en días (horas / 8,3) y Odoo la muestra en horas.
  const id = await call<number>('hr.leave.allocation', 'create', [
    {
      name: nombre,
      employee_id: empleadoId,
      holiday_status_id: BANCO_HORAS_TIPO_ID,
      date_from: fecha,
      number_of_days: horas / HORAS_DIA_ASIGNACION,
    },
  ]);

  const leer = async () => (await call<{ state: string; number_of_hours_display: number }[]>('hr.leave.allocation', 'read', [[id], ['state', 'number_of_hours_display']]))[0]!;
  let aviso: string | null = null;
  let actual = await leer();
  try {
    if (actual.state === 'confirm') {
      await call<unknown>('hr.leave.allocation', 'action_validate', [[id]]);
      actual = await leer();
    }
  } catch (err) {
    aviso = `La asignación se creó (n.º ${id}) pero no se pudo aprobar: ${err instanceof OdooError ? err.message : 'error desconocido'}. Aprobala en Odoo.`;
    actual = await leer();
  }
  if (!aviso && Math.abs(actual.number_of_hours_display - horas) > 0.02) {
    aviso = `Odoo guardó ${horasComa(actual.number_of_hours_display)} hs en lugar de las ${horasComa(horas)} hs pedidas. Revisá la asignación n.º ${id} en Odoo.`;
  }
  const aprobada = actual.state === 'validate';
  return {
    id,
    empleado: empleado.name,
    fecha,
    horas: redondear2(actual.number_of_hours_display),
    estado: actual.state,
    aprobada,
    aviso,
    resumen: `Acreditadas al banco de horas${aprobada ? ' y aprobadas' : ''}: ${horasComa(actual.number_of_hours_display)} hs para ${empleado.name}, ${fechaCorta(fecha)} (asignación n.º ${id}).`,
  };
}

/**
 * Deja constancia en el chatter de la fichada: hr.attendance no tiene ningún campo de texto, así que la nota de RRHH y quién
 * la cargó quedan como mensaje interno del registro. Si falla no se deshace la fichada: se avisa.
 */
async function dejarConstancia(call: Call, fichadaId: number, accion: string, aprobadoPor: string, nota?: string): Promise<string | null> {
  // Odoo trata el texto plano como texto y lo escapa solo: no hay que escaparlo acá.
  const cuerpo = `${accion} desde la web por ${aprobadoPor}.${nota?.trim() ? ` Nota: ${nota.trim()}` : ''}`;
  try {
    await call<unknown>('hr.attendance', 'message_post', [[fichadaId]], { body: cuerpo, message_type: 'comment', subtype_xmlid: 'mail.mt_note' });
    return null;
  } catch {
    return `La fichada quedó bien (n.º ${fichadaId}) pero no se pudo dejar la nota en Odoo.`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Sin salida / marca incompleta → corregir una fichada
// ---------------------------------------------------------------------------------------------------------------------

export interface CorregirFichadaInput {
  empleadoId: number;
  fecha: string;
  tipo: 'sin-salida' | 'marca-incompleta';
  /** "HH:MM" hora argentina. Obligatoria en marca incompleta; en sin salida la entrada ya existe. */
  entrada?: string;
  /** "HH:MM" hora argentina. */
  salida: string;
  nota?: string;
  aprobadoPor: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Una marca más corta que esto es la "marca incompleta" que detecta la bandeja (mismo umbral que rrhh-novedades.ts). */
const MARCA_MINIMA_HS = 0.25;
const MAX_JORNADA_FICHADA_HS = 16;

/** "YYYY-MM-DD" + "HH:MM" en hora argentina (UTC-3) → "YYYY-MM-DD HH:MM:SS" en UTC, como guarda Odoo. */
function localAUtc(fecha: string, hhmm: string): string {
  return new Date(Date.parse(`${fecha}T${hhmm}:00Z`) + 3 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

export async function corregirFichada(input: CorregirFichadaInput): Promise<ResultadoEscritura> {
  const { empleadoId, fecha, tipo, aprobadoPor } = input;

  validarDiaCerrado(fecha);
  if (tipo !== 'sin-salida' && tipo !== 'marca-incompleta') throw new ApiValidationError('Ese tipo de novedad no es una fichada a corregir.');
  if (!HHMM.test(input.salida)) throw new ApiValidationError('La hora de salida tiene que ser HH:MM.');
  if (tipo === 'marca-incompleta' && !(input.entrada && HHMM.test(input.entrada))) throw new ApiValidationError('La hora de entrada tiene que ser HH:MM.');

  const call = await conectar();
  const empleado = await leerEmpleado(call, empleadoId);

  // Las fichadas de ese día argentino: el día local arranca a las 03:00 UTC.
  const inicioDia = `${fecha} 03:00:00`;
  const finDia = `${addDaysIso(fecha, 1)} 03:00:00`;
  const marcas = await call<{ id: number; check_in: string; check_out: string | false; worked_hours: number }[]>('hr.attendance', 'search_read', [
    [
      ['employee_id', '=', empleadoId],
      ['check_in', '>=', inicioDia],
      ['check_in', '<', finDia],
    ],
    ['check_in', 'check_out', 'worked_hours'],
  ]);

  // En "sin salida" también entra la fichada "partida": duraba más que una jornada porque la del día siguiente la cerró (ver rrhh-novedades.ts).
  const candidatas =
    tipo === 'sin-salida' ? marcas.filter((m) => !m.check_out || m.worked_hours > MAX_JORNADA_FICHADA_HS) : marcas.filter((m) => m.check_out && m.worked_hours < MARCA_MINIMA_HS);
  if (candidatas.length === 0) {
    throw new ApiValidationError('No se encontró la fichada a corregir: puede que ya la hayan corregido. Actualizá la pantalla.');
  }
  if (candidatas.length > 1) {
    throw new ApiValidationError('Ese día hay más de una fichada para corregir: corregilas directo en Odoo.');
  }
  const marca = candidatas[0]!;

  const entradaUtc = tipo === 'marca-incompleta' ? localAUtc(fecha, input.entrada!) : marca.check_in;
  const salidaUtc = localAUtc(fecha, input.salida);
  if (salidaUtc <= entradaUtc) throw new ApiValidationError('La salida tiene que ser posterior a la entrada.');
  if (entradaUtc < inicioDia || salidaUtc >= finDia) throw new ApiValidationError('La entrada y la salida tienen que ser del mismo día.');
  if ((Date.parse(`${salidaUtc.replace(' ', 'T')}Z`) - Date.parse(`${entradaUtc.replace(' ', 'T')}Z`)) / 3_600_000 > MAX_JORNADA_FICHADA_HS) {
    throw new ApiValidationError(`Entre la entrada y la salida hay más de ${MAX_JORNADA_FICHADA_HS} hs: revisá las horas.`);
  }

  // Se corrige la fichada que ya existe (no se crea otra) y se marca como manual para que se vea que no la tomó el quiosco.
  const valores: Record<string, unknown> = { check_out: salidaUtc, out_mode: 'manual' };
  if (tipo === 'marca-incompleta') {
    valores.check_in = entradaUtc;
    valores.in_mode = 'manual';
  }
  const cierreOriginal = marca.check_out && marca.worked_hours > MAX_JORNADA_FICHADA_HS ? marca.check_out : null;
  // Si la salida real estaba absorbida por la fichada del día siguiente, esa fichada es la entrada de ese día: hay que dejarla
  // como entrada. Solo se puede si ese día no tiene otras fichadas (Odoo no deja solapar ni abrir dos).
  let entradaSiguiente: string | null = null;
  if (cierreOriginal) {
    const diaCierre = new Date(Date.parse(`${cierreOriginal.replace(' ', 'T')}Z`) - 3 * 3_600_000).toISOString().slice(0, 10);
    const otras = await call<{ id: number }[]>('hr.attendance', 'search_read', [
      [
        ['employee_id', '=', empleadoId],
        ['check_in', '>=', `${diaCierre} 03:00:00`],
        ['check_in', '<', `${addDaysIso(diaCierre, 1)} 03:00:00`],
        ['id', '!=', marca.id],
      ],
      ['id'],
    ]);
    if (otras.length === 0) entradaSiguiente = cierreOriginal;
  }
  await call<boolean>('hr.attendance', 'write', [[marca.id], valores]);
  let avisoSiguiente: string | null = null;
  if (cierreOriginal) {
    if (entradaSiguiente) {
      await call<number>('hr.attendance', 'create', [{ employee_id: empleadoId, check_in: entradaSiguiente, in_mode: 'manual' }]);
    } else {
      avisoSiguiente = 'La fichada del día siguiente cerraba este registro, pero ese día ya tiene otras fichadas: revisalas en Odoo.';
    }
  }

  const [despues] = await call<{ check_in: string; check_out: string | false; worked_hours: number }[]>('hr.attendance', 'read', [[marca.id], ['check_in', 'check_out', 'worked_hours']]);
  const horas = redondear2(despues?.worked_hours ?? 0);
  const avisoNota = await dejarConstancia(call, marca.id, 'Fichada corregida', aprobadoPor, input.nota);
  return {
    id: marca.id,
    empleado: empleado.name,
    fecha,
    horas,
    aprobada: true,
    aviso: [avisoNota, avisoSiguiente].filter(Boolean).join(' ') || null,
    resumen: `Fichada corregida en Odoo${entradaSiguiente ? ' (la entrada del día siguiente quedó cargada)' : ''}: ${empleado.name}, ${fechaCorta(fecha)}, ${tipo === 'marca-incompleta' ? input.entrada : 'entrada original'} a ${input.salida} (${horasComa(horas)} hs, fichada n.º ${marca.id}).`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Sin fichada → cargar la fichada del día (por si trabajó y no fichó)
// ---------------------------------------------------------------------------------------------------------------------

export interface CrearFichadaInput {
  empleadoId: number;
  fecha: string;
  /** "HH:MM" hora argentina. */
  entrada: string;
  /** "HH:MM" hora argentina. */
  salida: string;
  nota?: string;
  aprobadoPor: string;
}

/** Crea UNA fichada completa (entrada y salida) en un día que no tiene ninguna. Si ese día ya hay fichadas no hace nada. */
export async function crearFichada(input: CrearFichadaInput): Promise<ResultadoEscritura> {
  const { empleadoId, fecha, aprobadoPor } = input;

  validarDiaCerrado(fecha);
  if (!HHMM.test(input.entrada) || !HHMM.test(input.salida)) throw new ApiValidationError('La entrada y la salida tienen que ser HH:MM.');

  const entradaUtc = localAUtc(fecha, input.entrada);
  const salidaUtc = localAUtc(fecha, input.salida);
  if (salidaUtc <= entradaUtc) throw new ApiValidationError('La salida tiene que ser posterior a la entrada.');
  const horasPedidas = (Date.parse(`${salidaUtc.replace(' ', 'T')}Z`) - Date.parse(`${entradaUtc.replace(' ', 'T')}Z`)) / 3_600_000;
  if (horasPedidas > MAX_JORNADA_FICHADA_HS) throw new ApiValidationError(`Entre la entrada y la salida hay más de ${MAX_JORNADA_FICHADA_HS} hs: revisá las horas.`);

  const call = await conectar();
  const empleado = await leerEmpleado(call, empleadoId);

  const inicioDia = `${fecha} 03:00:00`;
  const finDia = `${addDaysIso(fecha, 1)} 03:00:00`;
  const existentes = await call<{ id: number }[]>('hr.attendance', 'search_read', [
    [
      ['employee_id', '=', empleadoId],
      ['check_in', '>=', inicioDia],
      ['check_in', '<', finDia],
    ],
    ['id'],
  ]);
  if (existentes.length > 0) throw new ApiValidationError('Ese día ya tiene fichadas: actualizá la pantalla (si hay que corregirlas, usá "Corregir fichada").');

  // Se marca como manual para que se vea que no la tomó el quiosco.
  const id = await call<number>('hr.attendance', 'create', [{ employee_id: empleadoId, check_in: entradaUtc, check_out: salidaUtc, in_mode: 'manual', out_mode: 'manual' }]);

  const [despues] = await call<{ worked_hours: number }[]>('hr.attendance', 'read', [[id], ['worked_hours']]);
  const horas = redondear2(despues?.worked_hours ?? 0);
  const avisoNota = await dejarConstancia(call, id, 'Fichada cargada', aprobadoPor, input.nota);
  return {
    id,
    empleado: empleado.name,
    fecha,
    horas,
    aprobada: true,
    aviso: avisoNota,
    resumen: `Fichada cargada en Odoo: ${empleado.name}, ${fechaCorta(fecha)}, ${input.entrada} a ${input.salida} (${horasComa(horas)} hs, fichada n.º ${id}, cargada por ${aprobadoPor}).`,
  };
}

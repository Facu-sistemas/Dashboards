import { searchReadAll } from './client';
import { addDaysIso } from '@/lib/date';
import { getArgentinaTodayIso } from './oee';
import { ApiValidationError } from '@/lib/api-helpers';
import { BANCO_HORAS_TYPE_ID, esFinDeSemana, fechaArgentina, HORAS_DIA, OFFSET_ARG_MS } from './rrhh-quincena';
import { listNovedadesDescartadas, type NovedadDescartada } from '@/lib/supabase/rrhh-novedades-descartadas';

/**
 * Bandeja de novedades: recorre día por día las fichadas de Odoo y lista lo que se sale de la jornada, para que RRHH
 * decida qué fue (banco de horas, enfermedad, trámite…). SOLO LECTURA: acá no se crea ni se aprueba nada.
 *
 * Qué se marca (por empleado y día hábil, sin feriados, hasta ayer):
 *  - `horas-faltantes`: trabajó menos de la jornada y no hay licencia aprobada que cubra la diferencia (ej. se fue antes).
 *  - `sin-salida`: tiene una entrada sin salida (se olvidó de fichar al irse).
 *  - `marca-incompleta`: solo hay una marca "de un minuto" (entrada y salida casi iguales, ej. 14:39–14:39): se olvidó de
 *    fichar al entrar o al salir.
 *  - `sin-fichada`: ese día no fichó y no tiene licencia aprobada que lo cubra.
 *  - `horas-extra`: trabajó bastante más que la jornada y no se le acreditaron horas al banco ese día.
 */

/** Jornada que se ficha: de 6:00 a 14:18. Se computan 8,80 hs porque la media hora de descanso se paga (ver rrhh-quincena.ts). */
export const JORNADA_FICHADA_HS = 8.3;
/** Diferencia que se tolera antes de marcar horas faltantes (15 min: fichar un rato más tarde o antes es normal). */
export const TOLERANCIA_FALTANTE_HS = 0.25;
/**
 * Las horas de más se marcan recién pasada una hora sobre la jornada fichada (≈ después de las 15:20). Se probó con 0,5 hs
 * y llenaba la bandeja de gente que simplemente sale a las 14:40.
 */
export const TOLERANCIA_EXTRA_HS = 1;
/** Una marca más corta que esto (entrada y salida casi en el mismo minuto) no es trabajo real: es un fichaje olvidado. */
export const MARCA_MINIMA_HS = 0.25;

const MAX_DIAS_RANGO = 93;

export type NovedadTipo = 'horas-faltantes' | 'sin-salida' | 'marca-incompleta' | 'sin-fichada' | 'horas-extra';

export interface NovedadLicenciaDia {
  id: number;
  tipo: string;
  estado: 'confirm' | 'validate1' | 'validate';
  /** Horas de esa licencia que caen en este día. */
  horas: number;
}

export interface NovedadRow {
  /** Identifica la novedad de forma estable: empleado|fecha|tipo. */
  clave: string;
  empleadoId: number;
  empleado: string;
  legajo: string | null;
  departamento: string | null;
  fecha: string; // ISO
  tipo: NovedadTipo;
  /** Hora de la primera entrada y de la última salida del día (hora argentina, "HH:MM"). */
  entrada: string | null;
  salida: string | null;
  fichadoHs: number;
  /** Horas que quedan sin explicar: faltan (horas-faltantes, sin-fichada) o sobran (horas-extra). */
  horasAResolver: number;
  /** Licencias aprobadas que ya cubren parte del día. */
  cubiertoHs: number;
  /** Licencias sin aprobar que cubrirían el resto: RRHH tiene que aprobarlas en Odoo. */
  pendienteHs: number;
  licencias: NovedadLicenciaDia[];
  saldoBanco: number;
  detalle: string;
  /** Si RRHH la descartó (no hay que cargar nada): quién, por qué y cuándo. La pantalla la oculta salvo que pidan verlas. */
  descartada: NovedadDescartada | null;
}

export interface RrhhNovedadesResult {
  generatedAt: string;
  desde: string;
  hasta: string;
  /** Último día evaluado: hoy no se evalúa porque todavía puede estar trabajando. */
  evaluadoHasta: string;
  jornadaHs: number;
  fichadasTotal: number;
  /** `false` si falta crear la tabla de descartes en Supabase: la bandeja funciona igual pero "Descartar" no guarda. */
  descartesDisponibles: boolean;
  totales: {
    novedades: number;
    empleados: number;
    porTipo: Record<NovedadTipo, number>;
    horasFaltantes: number;
    horasExtra: number;
  };
  rows: NovedadRow[];
}

export type M2o = [number, string] | false;

type EmployeeRow = {
  id: number;
  name: string;
  department_id: M2o;
  resource_calendar_id: M2o;
  barcode: string | false;
  x_studio_fecha_ingreso: string | false;
  x_studio_saldo_banco_horas: number;
};

type AttendanceRow = {
  employee_id: M2o;
  check_in: string;
  check_out: string | false;
  worked_hours: number;
};

export type LeaveRow = {
  id: number;
  employee_id: M2o;
  holiday_status_id: M2o;
  request_date_from: string;
  request_date_to: string;
  number_of_hours_display: number;
  number_of_days: number;
  request_unit_hours: boolean;
  state: 'confirm' | 'validate1' | 'validate';
};

type GlobalLeaveRow = { calendar_id: M2o; date_from: string; date_to: string };

type AllocationRow = { employee_id: M2o; date_from: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Datetime de Odoo (UTC) -> "HH:MM" en hora argentina. */
export function horaArgentina(utc: string): string {
  const ms = Date.parse(`${utc.replace(' ', 'T')}Z`) - OFFSET_ARG_MS;
  return new Date(ms).toISOString().slice(11, 16);
}

function validarRango(desde: string, hasta: string) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(desde) || !iso.test(hasta)) throw new ApiValidationError('Fechas inválidas (usar YYYY-MM-DD)');
  if (hasta < desde) throw new ApiValidationError('La fecha "hasta" es anterior a "desde"');
  if (addDaysIso(desde, MAX_DIAS_RANGO) < hasta) throw new ApiValidationError(`El rango no puede superar ${MAX_DIAS_RANGO} días`);
}

/** Horas de una licencia que caen en el día `d` (0 si no lo toca). Las de varios días cubren la jornada completa. */
export function horasDeLicenciaEnDia(l: LeaveRow, d: string): number {
  if (d < l.request_date_from || d > l.request_date_to) return 0;
  if (l.request_unit_hours) return l.number_of_hours_display;
  if (l.request_date_from === l.request_date_to) return Math.min(HORAS_DIA, l.number_of_days * HORAS_DIA);
  return HORAS_DIA;
}

export async function getRrhhNovedades(desde: string, hasta: string): Promise<RrhhNovedadesResult> {
  validarRango(desde, hasta);

  const hoy = getArgentinaTodayIso();
  const evaluadoHasta = hasta < hoy ? hasta : addDaysIso(hoy, -1);

  const [employees, attendance, leaves, globalLeaves, acreditaciones] = await Promise.all([
    searchReadAll<EmployeeRow>({
      model: 'hr.employee',
      domain: [['active', '=', true]],
      fields: ['name', 'department_id', 'resource_calendar_id', 'barcode', 'x_studio_fecha_ingreso', 'x_studio_saldo_banco_horas'],
      order: 'name asc',
    }),
    searchReadAll<AttendanceRow>({
      model: 'hr.attendance',
      // Los check_in vienen en UTC y Argentina es UTC-3: el día local arranca a las 03:00 UTC.
      domain: [
        ['check_in', '>=', `${desde} 03:00:00`],
        ['check_in', '<', `${addDaysIso(hasta, 1)} 03:00:00`],
      ],
      fields: ['employee_id', 'check_in', 'check_out', 'worked_hours'],
      order: 'check_in asc',
    }),
    searchReadAll<LeaveRow>({
      model: 'hr.leave',
      domain: [
        ['state', 'in', ['confirm', 'validate1', 'validate']],
        ['request_date_from', '<=', hasta],
        ['request_date_to', '>=', desde],
      ],
      fields: [
        'employee_id',
        'holiday_status_id',
        'request_date_from',
        'request_date_to',
        'number_of_hours_display',
        'number_of_days',
        'request_unit_hours',
        'state',
      ],
    }),
    searchReadAll<GlobalLeaveRow>({
      model: 'resource.calendar.leaves',
      domain: [
        ['resource_id', '=', false],
        ['date_from', '<=', `${addDaysIso(hasta, 1)} 23:59:59`],
        ['date_to', '>=', `${desde} 00:00:00`],
      ],
      fields: ['calendar_id', 'date_from', 'date_to'],
    }),
    // Horas extra ya acreditadas al banco de horas: una asignación con fecha de ese día resuelve la novedad de horas extra.
    searchReadAll<AllocationRow>({
      model: 'hr.leave.allocation',
      domain: [
        ['holiday_status_id', '=', BANCO_HORAS_TYPE_ID],
        ['state', 'in', ['confirm', 'validate1', 'validate']],
        ['date_from', '>=', desde],
        ['date_from', '<=', hasta],
      ],
      fields: ['employee_id', 'date_from'],
    }),
  ]);

  const acreditado = new Set<string>();
  for (const a of acreditaciones) if (a.employee_id) acreditado.add(`${a.employee_id[0]}|${String(a.date_from).slice(0, 10)}`);

  const feriadosPorCalendario = new Map<number, Set<string>>();
  for (const g of globalLeaves) {
    if (!g.calendar_id) continue;
    const dias = feriadosPorCalendario.get(g.calendar_id[0]) ?? new Set<string>();
    for (let d = fechaArgentina(g.date_from); d <= fechaArgentina(g.date_to); d = addDaysIso(d, 1)) dias.add(d);
    feriadosPorCalendario.set(g.calendar_id[0], dias);
  }

  // empleado -> día -> fichadas
  const fichadas = new Map<number, Map<string, AttendanceRow[]>>();
  for (const a of attendance) {
    if (!a.employee_id) continue;
    const porDia = fichadas.get(a.employee_id[0]) ?? new Map<string, AttendanceRow[]>();
    const dia = fechaArgentina(a.check_in);
    const lista = porDia.get(dia) ?? [];
    lista.push(a);
    porDia.set(dia, lista);
    fichadas.set(a.employee_id[0], porDia);
  }

  const licenciasPorEmpleado = new Map<number, LeaveRow[]>();
  for (const l of leaves) {
    if (!l.employee_id) continue;
    const lista = licenciasPorEmpleado.get(l.employee_id[0]) ?? [];
    lista.push(l);
    licenciasPorEmpleado.set(l.employee_id[0], lista);
  }

  const detectadas: Omit<NovedadRow, 'descartada'>[] = [];

  for (const e of employees) {
    const porDia = fichadas.get(e.id);
    // Sin ninguna fichada en el rango no se puede saber si faltó o si todavía no usaba el kiosco.
    if (!porDia || porDia.size === 0) continue;
    const primeraFichada = [...porDia.keys()].sort()[0]!;
    const feriados = (e.resource_calendar_id ? feriadosPorCalendario.get(e.resource_calendar_id[0]) : undefined) ?? new Set<string>();
    const ingreso = e.x_studio_fecha_ingreso || null;
    const inicio = [desde, primeraFichada, ingreso ?? ''].reduce((max, v) => (v > max ? v : max));
    const licencias = licenciasPorEmpleado.get(e.id) ?? [];

    for (let d = inicio; d <= evaluadoHasta; d = addDaysIso(d, 1)) {
      if (esFinDeSemana(d) || feriados.has(d)) continue;

      const delDia: NovedadLicenciaDia[] = licencias
        .map((l) => ({
          id: l.id,
          tipo: l.holiday_status_id ? l.holiday_status_id[1] : 'Sin tipo',
          estado: l.state,
          horas: round2(horasDeLicenciaEnDia(l, d)),
        }))
        .filter((l) => l.horas > 0);
      const cubiertoHs = delDia.filter((l) => l.estado === 'validate').reduce((s, l) => s + l.horas, 0);
      const pendienteHs = delDia.filter((l) => l.estado !== 'validate').reduce((s, l) => s + l.horas, 0);

      // Día cubierto entero por licencias aprobadas (vacaciones, enfermedad, banco de horas de día completo…): nada que revisar.
      if (cubiertoHs >= HORAS_DIA - TOLERANCIA_FALTANTE_HS) continue;

      const marcas = porDia.get(d) ?? [];
      const base = {
        empleadoId: e.id,
        empleado: e.name,
        legajo: e.barcode || null,
        departamento: e.department_id ? e.department_id[1] : null,
        fecha: d,
        licencias: delDia,
        cubiertoHs: round2(cubiertoHs),
        pendienteHs: round2(pendienteHs),
        saldoBanco: round2(e.x_studio_saldo_banco_horas ?? 0),
      };

      if (marcas.length === 0) {
        detectadas.push({
          ...base,
          clave: `${e.id}|${d}|sin-fichada`,
          tipo: 'sin-fichada',
          entrada: null,
          salida: null,
          fichadoHs: 0,
          horasAResolver: round2(HORAS_DIA - cubiertoHs),
          detalle: 'No fichó en todo el día y no tiene una licencia aprobada que lo cubra.',
        });
        continue;
      }

      const entrada = horaArgentina(marcas[0]!.check_in);
      const cerradas = marcas.filter((m) => m.check_out);
      const ultimaSalida = cerradas.length > 0 ? cerradas[cerradas.length - 1]!.check_out : false;
      const salida = ultimaSalida ? horaArgentina(ultimaSalida) : null;
      const fichadoHs = round2(marcas.reduce((s, m) => s + (m.check_out ? m.worked_hours : 0), 0));

      if (marcas.some((m) => !m.check_out)) {
        detectadas.push({
          ...base,
          clave: `${e.id}|${d}|sin-salida`,
          tipo: 'sin-salida',
          entrada,
          salida,
          fichadoHs,
          horasAResolver: 0,
          detalle: `Fichó la entrada a las ${entrada} y no fichó la salida: hay que corregir el horario real.`,
        });
        continue;
      }

      if (fichadoHs < MARCA_MINIMA_HS) {
        detectadas.push({
          ...base,
          clave: `${e.id}|${d}|marca-incompleta`,
          tipo: 'marca-incompleta',
          entrada,
          salida,
          fichadoHs,
          horasAResolver: round2(Math.max(0, HORAS_DIA - cubiertoHs)),
          detalle: `Solo hay una marca de ${entrada}${salida && salida !== entrada ? ` a ${salida}` : ''} (${fichadoHs} hs): probablemente se olvidó de fichar al entrar o al salir.`,
        });
        continue;
      }

      const faltan = JORNADA_FICHADA_HS - fichadoHs - cubiertoHs;
      if (faltan > TOLERANCIA_FALTANTE_HS) {
        detectadas.push({
          ...base,
          clave: `${e.id}|${d}|horas-faltantes`,
          tipo: 'horas-faltantes',
          entrada,
          salida,
          fichadoHs,
          horasAResolver: round2(faltan),
          detalle: `Trabajó de ${entrada} a ${salida} (${fichadoHs} hs) y le faltan ${round2(faltan)} hs para completar la jornada.`,
        });
      } else if (cubiertoHs === 0 && !acreditado.has(`${e.id}|${d}`) && fichadoHs - JORNADA_FICHADA_HS > TOLERANCIA_EXTRA_HS) {
        const sobran = fichadoHs - JORNADA_FICHADA_HS;
        detectadas.push({
          ...base,
          clave: `${e.id}|${d}|horas-extra`,
          tipo: 'horas-extra',
          entrada,
          salida,
          fichadoHs,
          horasAResolver: round2(sobran),
          detalle: `Trabajó de ${entrada} a ${salida} (${fichadoHs} hs): ${round2(sobran)} hs más que la jornada.`,
        });
      }
    }
  }

  // Lo más reciente primero; dentro del día, por nombre.
  detectadas.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.empleado.localeCompare(b.empleado, 'es')));

  // Las que RRHH ya descartó se devuelven marcadas (la pantalla las oculta) y no suman en los totales.
  const descartes = await listNovedadesDescartadas(desde, hasta);
  const todas: NovedadRow[] = detectadas.map((r) => ({ ...r, descartada: descartes.map.get(r.clave) ?? null }));
  const rows = todas.filter((r) => !r.descartada);

  const porTipo: Record<NovedadTipo, number> = { 'horas-faltantes': 0, 'sin-salida': 0, 'marca-incompleta': 0, 'sin-fichada': 0, 'horas-extra': 0 };
  for (const r of rows) porTipo[r.tipo] += 1;

  return {
    generatedAt: hoy,
    desde,
    hasta,
    evaluadoHasta,
    jornadaHs: JORNADA_FICHADA_HS,
    fichadasTotal: attendance.length,
    descartesDisponibles: descartes.lista,
    totales: {
      novedades: rows.length,
      empleados: new Set(rows.map((r) => r.empleadoId)).size,
      porTipo,
      horasFaltantes: round2(rows.filter((r) => r.tipo === 'horas-faltantes' || r.tipo === 'sin-fichada').reduce((s, r) => s + r.horasAResolver, 0)),
      horasExtra: round2(rows.filter((r) => r.tipo === 'horas-extra').reduce((s, r) => s + r.horasAResolver, 0)),
    },
    rows: todas,
  };
}

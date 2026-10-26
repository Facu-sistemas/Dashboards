import { searchReadAll } from './client';
import { addDaysIso } from '@/lib/date';
import { getArgentinaTodayIso } from './oee';
import { ApiValidationError } from '@/lib/api-helpers';

/** `hr.leave.type` id de "Banco de horas" — fijo, mismo criterio que VACACIONES_TYPE_ID en rrhh-vacaciones.ts. */
const BANCO_HORAS_TYPE_ID = 6;

/**
 * Horas que computa RRHH por día trabajado, igual para todos: se ficha de 6:00 a 14:18 (8,30 hs) pero se computa
 * hasta las 14:48 (8,80 hs) porque la media hora de descanso se paga. La liquidación está armada sobre 8,80 hs/día
 * (96,80 hs en una quincena de 11 días hábiles), por eso no se usa la jornada del calendario de Odoo (8,3).
 */
const HORAS_DIA = 8.8;

/** Diferencia que se tolera antes de marcar un descuadre (Odoo guarda horas con decimales largos). */
const TOLERANCIA_HS = 0.1;

const MAX_DIAS_RANGO = 93;

/** Argentina no tiene horario de verano: los datetime de Odoo (UTC) están 3 horas adelantados. */
const OFFSET_ARG_MS = 3 * 60 * 60 * 1000;

export type QuincenaAlertaTipo = 'banco-descuadre' | 'superpuestas' | 'exceso' | 'pendiente' | 'banco-negativo';
export type QuincenaAlertaNivel = 'error' | 'aviso';

export interface QuincenaAlerta {
  tipo: QuincenaAlertaTipo;
  nivel: QuincenaAlertaNivel;
  detalle: string;
}

export interface QuincenaLicenciaRow {
  id: number;
  tipo: string;
  estado: 'confirm' | 'validate1' | 'validate';
  desde: string; // ISO date
  hasta: string; // ISO date
  /** Horas de la licencia completa, según Odoo. */
  horasLicencia: number;
  /** Horas de esa licencia que caen dentro de la quincena (las que cuentan en esta pantalla). */
  horasEnQuincena: number;
}

export interface QuincenaTipoHoras {
  tipo: string;
  horas: number;
}

export interface QuincenaEmpleadoRow {
  id: number;
  nombre: string;
  /** Número de legajo (credencial de Odoo, ej. "01/0602"). */
  legajo: string | null;
  cuil: string | null;
  convenio: string | null;
  centroCosto: string | null;
  supervisor: string | null;
  departamento: string | null;
  horasPorDia: number;
  diasHabiles: number;
  horasEsperadas: number;
  feriadosHs: number;
  tiempoPersonalHs: number;
  porTipo: QuincenaTipoHoras[];
  horasATrabajar: number;
  fichadasHs: number;
  bancoSaldo: number;
  bancoAcreditado: number;
  bancoUsado: number;
  pendientesHs: number;
  licencias: QuincenaLicenciaRow[];
  alertas: QuincenaAlerta[];
}

export interface RrhhQuincenaResult {
  generatedAt: string;
  desde: string;
  hasta: string;
  /** Días de lunes a viernes del rango, sin descontar feriados. */
  diasHabiles: number;
  feriados: string[];
  /** Cantidad de marcas de hr.attendance en el rango (hoy son pocas: el fichaje es nuevo). */
  fichadasTotal: number;
  totales: {
    empleados: number;
    horasEsperadas: number;
    feriadosHs: number;
    tiempoPersonalHs: number;
    horasATrabajar: number;
    bancoUsado: number;
    bancoAcreditado: number;
    conAlertas: number;
    conErrores: number;
  };
  porTipo: (QuincenaTipoHoras & { empleados: number })[];
  rows: QuincenaEmpleadoRow[];
}

type M2o = [number, string] | false;

type EmployeeRow = {
  id: number;
  name: string;
  department_id: M2o;
  resource_calendar_id: M2o;
  barcode: string | false;
  identification_id: string | false;
  parent_id: M2o;
  x_studio_centro_de_costo: M2o;
  x_studio_categora_de_convenio: M2o;
  x_studio_fecha_ingreso: string | false;
  x_studio_saldo_banco_horas: number;
};

type GlobalLeaveRow = { calendar_id: M2o; date_from: string; date_to: string };

type LeaveRow = {
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

type HoursRow = { employee_id: M2o; number_of_hours_display: number; date_from?: string | false };

type AttendanceRow = { employee_id: M2o; worked_hours: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

function esFinDeSemana(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Días de lunes a viernes entre dos fechas ISO (inclusive) que no están en `excluir`. */
function contarDiasHabiles(desde: string, hasta: string, excluir?: Set<string>): number {
  let count = 0;
  for (let d = desde; d <= hasta; d = addDaysIso(d, 1)) {
    if (!esFinDeSemana(d) && !excluir?.has(d)) count += 1;
  }
  return count;
}

/** Datetime de Odoo (UTC, "YYYY-MM-DD HH:mm:ss") -> fecha ISO en hora argentina. */
function fechaArgentina(utc: string): string {
  const ms = Date.parse(`${utc.replace(' ', 'T')}Z`) - OFFSET_ARG_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

function validarRango(desde: string, hasta: string) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(desde) || !iso.test(hasta)) throw new ApiValidationError('Fechas inválidas (usar YYYY-MM-DD)');
  if (hasta < desde) throw new ApiValidationError('La fecha "hasta" es anterior a "desde"');
  if (addDaysIso(desde, MAX_DIAS_RANGO) < hasta) throw new ApiValidationError(`El rango no puede superar ${MAX_DIAS_RANGO} días`);
}

function sumar(map: Map<number, number>, id: number, v: number) {
  map.set(id, (map.get(id) ?? 0) + v);
}

/**
 * Conciliación de una quincena (o cualquier rango corto): por empleado, las horas
 * que le corresponden por jornada, los feriados del calendario de la empresa, el
 * tiempo personal (licencias aprobadas en Odoo, recortadas a la quincena) y el
 * movimiento del banco de horas, con las alertas de lo que no cierra.
 *
 * El tiempo personal se calcula desde `hr.leave` y no desde la hoja de horas
 * (`account.analytic.line`): Odoo no genera hoja de horas para Vacaciones ni para
 * las licencias por hora, así que ahí faltarían licencias reales.
 */
export async function getRrhhQuincena(desde: string, hasta: string): Promise<RrhhQuincenaResult> {
  validarRango(desde, hasta);

  const [employees, leaves, bancoAsignaciones, bancoLicencias, attendance] = await Promise.all([
    searchReadAll<EmployeeRow>({
      model: 'hr.employee',
      domain: [['active', '=', true]],
      fields: [
        'name',
        'department_id',
        'resource_calendar_id',
        'barcode',
        'identification_id',
        'parent_id',
        'x_studio_centro_de_costo',
        'x_studio_categora_de_convenio',
        'x_studio_fecha_ingreso',
        'x_studio_saldo_banco_horas',
      ],
      order: 'name asc',
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
      order: 'request_date_from asc',
    }),
    searchReadAll<HoursRow>({
      model: 'hr.leave.allocation',
      domain: [
        ['holiday_status_id', '=', BANCO_HORAS_TYPE_ID],
        ['state', '=', 'validate'],
      ],
      fields: ['employee_id', 'number_of_hours_display', 'date_from'],
    }),
    searchReadAll<HoursRow>({
      model: 'hr.leave',
      domain: [
        ['holiday_status_id', '=', BANCO_HORAS_TYPE_ID],
        ['state', '=', 'validate'],
      ],
      fields: ['employee_id', 'number_of_hours_display'],
    }),
    searchReadAll<AttendanceRow>({
      model: 'hr.attendance',
      // Los check_in vienen en UTC y Argentina es UTC-3: el día local arranca a las 03:00 UTC.
      domain: [
        ['check_in', '>=', `${desde} 03:00:00`],
        ['check_in', '<', `${addDaysIso(hasta, 1)} 03:00:00`],
      ],
      fields: ['employee_id', 'worked_hours'],
    }),
  ]);

  // Feriados por calendario: una licencia que cruza la quincena se recorta con ellos, por eso se piden desde el inicio de la licencia más vieja.
  const inicioFeriados = leaves.reduce((min, l) => (l.request_date_from < min ? l.request_date_from : min), desde);
  const finFeriados = leaves.reduce((max, l) => (l.request_date_to > max ? l.request_date_to : max), hasta);
  const globalLeaves = await searchReadAll<GlobalLeaveRow>({
    model: 'resource.calendar.leaves',
    domain: [
      ['resource_id', '=', false],
      ['date_from', '<=', `${addDaysIso(finFeriados, 1)} 23:59:59`],
      ['date_to', '>=', `${inicioFeriados} 00:00:00`],
    ],
    fields: ['calendar_id', 'date_from', 'date_to'],
  });
  const feriadosPorCalendario = new Map<number, Set<string>>();
  for (const g of globalLeaves) {
    if (!g.calendar_id) continue;
    const dias = feriadosPorCalendario.get(g.calendar_id[0]) ?? new Set<string>();
    for (let d = fechaArgentina(g.date_from); d <= fechaArgentina(g.date_to); d = addDaysIso(d, 1)) dias.add(d);
    feriadosPorCalendario.set(g.calendar_id[0], dias);
  }

  const diasHabilesRango = contarDiasHabiles(desde, hasta);

  const asignadoTotal = new Map<number, number>();
  const bancoAcreditado = new Map<number, number>();
  for (const a of bancoAsignaciones) {
    if (!a.employee_id) continue;
    sumar(asignadoTotal, a.employee_id[0], a.number_of_hours_display);
    const fecha = a.date_from ? a.date_from.slice(0, 10) : '';
    if (fecha >= desde && fecha <= hasta) sumar(bancoAcreditado, a.employee_id[0], a.number_of_hours_display);
  }
  const tomadoTotal = new Map<number, number>();
  for (const l of bancoLicencias) if (l.employee_id) sumar(tomadoTotal, l.employee_id[0], l.number_of_hours_display);

  const fichadasHs = new Map<number, number>();
  for (const a of attendance) if (a.employee_id) sumar(fichadasHs, a.employee_id[0], a.worked_hours);

  const licenciasPorEmpleado = new Map<number, LeaveRow[]>();
  for (const l of leaves) {
    if (!l.employee_id) continue;
    const list = licenciasPorEmpleado.get(l.employee_id[0]) ?? [];
    list.push(l);
    licenciasPorEmpleado.set(l.employee_id[0], list);
  }

  const feriadosEnRango = new Set<string>();

  const rows: QuincenaEmpleadoRow[] = employees.map((e) => {
    const calendarId = e.resource_calendar_id ? e.resource_calendar_id[0] : null;
    const horasPorDia = HORAS_DIA;
    const feriados = (calendarId !== null ? feriadosPorCalendario.get(calendarId) : undefined) ?? new Set<string>();
    const ingreso = e.x_studio_fecha_ingreso || null;
    const inicio = ingreso && ingreso > desde ? ingreso : desde;

    const diasHabiles = inicio > hasta ? 0 : contarDiasHabiles(inicio, hasta);
    const diasFeriado = inicio > hasta ? 0 : contarDiasHabiles(inicio, hasta) - contarDiasHabiles(inicio, hasta, feriados);
    for (let d = desde; d <= hasta; d = addDaysIso(d, 1)) if (feriados.has(d) && !esFinDeSemana(d)) feriadosEnRango.add(d);
    const horasEsperadas = diasHabiles * horasPorDia;
    const feriadosHs = diasFeriado * horasPorDia;

    const tipoHoras = new Map<string, number>();
    const licencias: QuincenaLicenciaRow[] = (licenciasPorEmpleado.get(e.id) ?? []).map((l) => {
      // Una licencia por hora cae entera en un día; las de días se reparten por días hábiles (sin feriados) si cruzan la quincena.
      const totalDias = contarDiasHabiles(l.request_date_from, l.request_date_to, feriados);
      const enRangoDesde = l.request_date_from > desde ? l.request_date_from : desde;
      const enRangoHasta = l.request_date_to < hasta ? l.request_date_to : hasta;
      const diasEnRango = enRangoDesde > enRangoHasta ? 0 : contarDiasHabiles(enRangoDesde, enRangoHasta, feriados);
      const contenida = l.request_date_from >= desde && l.request_date_to <= hasta;
      // Las licencias por días valen 8,80 hs por día (Odoo las guarda con 8,3); las por hora se respetan tal cual.
      const total = l.request_unit_hours ? l.number_of_hours_display : l.number_of_days * HORAS_DIA;
      const horasEnQuincena = contenida ? total : totalDias > 0 ? (total * diasEnRango) / totalDias : 0;
      const tipo = l.holiday_status_id ? l.holiday_status_id[1] : 'Sin tipo';
      if (l.state === 'validate') tipoHoras.set(tipo, (tipoHoras.get(tipo) ?? 0) + horasEnQuincena);
      return {
        id: l.id,
        tipo,
        estado: l.state,
        desde: l.request_date_from,
        hasta: l.request_date_to,
        horasLicencia: round2(total),
        horasEnQuincena: round2(horasEnQuincena),
      };
    });

    const porTipo = [...tipoHoras.entries()]
      .map(([tipo, horas]) => ({ tipo, horas: round2(horas) }))
      .filter((t) => t.horas > 0)
      .sort((a, b) => b.horas - a.horas);
    const tiempoPersonalHs = porTipo.reduce((s, t) => s + t.horas, 0);

    const pendientes = licencias.filter((l) => l.estado !== 'validate');
    const pendientesHs = pendientes.reduce((s, l) => s + l.horasEnQuincena, 0);

    const saldo = e.x_studio_saldo_banco_horas ?? 0;
    const saldoCalculado = (asignadoTotal.get(e.id) ?? 0) - (tomadoTotal.get(e.id) ?? 0);
    const bancoUsado = tipoHoras.get('Banco de horas') ?? 0;

    const alertas: QuincenaAlerta[] = [];
    if (Math.abs(saldo - saldoCalculado) > TOLERANCIA_HS) {
      alertas.push({
        tipo: 'banco-descuadre',
        nivel: 'error',
        detalle: `El saldo de banco de horas (${round2(saldo)} hs) no coincide con lo asignado menos lo tomado (${round2(saldoCalculado)} hs).`,
      });
    }

    // Dos licencias aprobadas de días completos que se pisan en el mismo día descuentan el día dos veces.
    const diasCompletos = licencias.filter((l) => l.estado === 'validate' && !(leaves.find((x) => x.id === l.id)?.request_unit_hours ?? false));
    const superpuestas = new Set<string>();
    for (let i = 0; i < diasCompletos.length; i++) {
      for (let j = i + 1; j < diasCompletos.length; j++) {
        const a = diasCompletos[i]!;
        const b = diasCompletos[j]!;
        const ini = a.desde > b.desde ? a.desde : b.desde;
        const fin = a.hasta < b.hasta ? a.hasta : b.hasta;
        if (ini <= fin && contarDiasHabiles(ini, fin, feriados) > 0) superpuestas.add(`${a.tipo} y ${b.tipo} el ${ini}`);
      }
    }
    if (superpuestas.size > 0) {
      alertas.push({
        tipo: 'superpuestas',
        nivel: 'error',
        detalle: `Licencias aprobadas que se pisan: ${[...superpuestas].join('; ')}.`,
      });
    }

    if (feriadosHs + tiempoPersonalHs > horasEsperadas + TOLERANCIA_HS) {
      alertas.push({
        tipo: 'exceso',
        nivel: 'error',
        detalle: `Feriados y tiempo personal (${round2(feriadosHs + tiempoPersonalHs)} hs) superan las horas de la quincena (${round2(horasEsperadas)} hs).`,
      });
    }
    if (pendientes.length > 0) {
      alertas.push({
        tipo: 'pendiente',
        nivel: 'aviso',
        detalle: `${pendientes.length} ${pendientes.length === 1 ? 'licencia' : 'licencias'} sin aprobar en el período (${round2(pendientesHs)} hs): todavía no suman al tiempo personal.`,
      });
    }
    if (saldo < -TOLERANCIA_HS) {
      alertas.push({ tipo: 'banco-negativo', nivel: 'aviso', detalle: `Saldo de banco de horas negativo (${round2(saldo)} hs).` });
    }

    return {
      id: e.id,
      nombre: e.name,
      legajo: e.barcode || null,
      cuil: e.identification_id || null,
      convenio: e.x_studio_categora_de_convenio ? e.x_studio_categora_de_convenio[1] : null,
      centroCosto: e.x_studio_centro_de_costo ? e.x_studio_centro_de_costo[1] : null,
      supervisor: e.parent_id ? e.parent_id[1] : null,
      departamento: e.department_id ? e.department_id[1] : null,
      horasPorDia: round2(horasPorDia),
      diasHabiles,
      horasEsperadas: round2(horasEsperadas),
      feriadosHs: round2(feriadosHs),
      tiempoPersonalHs: round2(tiempoPersonalHs),
      porTipo,
      horasATrabajar: round2(Math.max(0, horasEsperadas - feriadosHs - tiempoPersonalHs)),
      fichadasHs: round2(fichadasHs.get(e.id) ?? 0),
      bancoSaldo: round2(saldo),
      bancoAcreditado: round2(bancoAcreditado.get(e.id) ?? 0),
      bancoUsado: round2(bancoUsado),
      pendientesHs: round2(pendientesHs),
      licencias,
      alertas,
    };
  });

  const tipoTotales = new Map<string, { horas: number; empleados: number }>();
  for (const r of rows) {
    for (const t of r.porTipo) {
      const acc = tipoTotales.get(t.tipo) ?? { horas: 0, empleados: 0 };
      acc.horas += t.horas;
      acc.empleados += 1;
      tipoTotales.set(t.tipo, acc);
    }
  }

  const suma = (pick: (r: QuincenaEmpleadoRow) => number) => round2(rows.reduce((s, r) => s + pick(r), 0));

  // Primero los que tienen errores, después avisos, después el resto por nombre.
  const peso = (r: QuincenaEmpleadoRow) => (r.alertas.some((a) => a.nivel === 'error') ? 0 : r.alertas.length > 0 ? 1 : 2);
  rows.sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre, 'es'));

  return {
    generatedAt: getArgentinaTodayIso(),
    desde,
    hasta,
    diasHabiles: diasHabilesRango,
    feriados: [...feriadosEnRango].sort(),
    fichadasTotal: attendance.length,
    totales: {
      empleados: rows.length,
      horasEsperadas: suma((r) => r.horasEsperadas),
      feriadosHs: suma((r) => r.feriadosHs),
      tiempoPersonalHs: suma((r) => r.tiempoPersonalHs),
      horasATrabajar: suma((r) => r.horasATrabajar),
      bancoUsado: suma((r) => r.bancoUsado),
      bancoAcreditado: suma((r) => r.bancoAcreditado),
      conAlertas: rows.filter((r) => r.alertas.length > 0).length,
      conErrores: rows.filter((r) => r.alertas.some((a) => a.nivel === 'error')).length,
    },
    porTipo: [...tipoTotales.entries()]
      .map(([tipo, v]) => ({ tipo, horas: round2(v.horas), empleados: v.empleados }))
      .sort((a, b) => b.horas - a.horas),
    rows,
  };
}

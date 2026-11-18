import { searchReadAll } from './client';
import type { OdooDomainLeaf } from './types';
import { addDaysIso } from '@/lib/date';
import { getArgentinaTodayIso } from './oee';
import { ApiValidationError } from '@/lib/api-helpers';
import { BANCO_HORAS_TYPE_ID, esFinDeSemana, fechaArgentina, HORAS_DIA } from './rrhh-quincena';
import {
  horaArgentina,
  horasDeLicenciaEnDia,
  JORNADA_FICHADA_HS,
  MARCA_MINIMA_HS,
  TOLERANCIA_EXTRA_HS,
  TOLERANCIA_FALTANTE_HS,
  type LeaveRow,
  type M2o,
  type NovedadLicenciaDia,
  type NovedadTipo,
} from './rrhh-novedades';
import { cargarBaseFichaje } from './rrhh-fichaje-base';
import { getEstadosResumen } from '@/lib/supabase/rrhh-resumen-estado';
import { listNovedadesDescartadas } from '@/lib/supabase/rrhh-novedades-descartadas';

/**
 * Historial de fichadas: para TODOS los empleados, el resumen de un período (días trabajados, horas, cuántas novedades de cada
 * tipo) y, de un empleado, el día por día para dibujar su calendario. SOLO LECTURA.
 *
 * Los días se clasifican con las mismas reglas y umbrales que la bandeja de novedades (rrhh-novedades.ts): lo que acá aparece
 * como anormal es exactamente lo que allá aparece para resolver.
 */

const MAX_DIAS_RESUMEN = 93;
const MAX_DIAS_DETALLE = 400;

export type EstadoDia = 'fin-de-semana' | 'feriado' | 'sin-datos' | 'pendiente' | 'ok' | 'licencia' | NovedadTipo;

export interface MarcaDia {
  entrada: string;
  salida: string | null;
  horas: number;
}

export interface DiaHistorial {
  fecha: string;
  estado: EstadoDia;
  entrada: string | null;
  salida: string | null;
  fichadoHs: number;
  /** Horas que faltan o sobran (solo en los estados de novedad). */
  horasAResolver: number;
  marcas: MarcaDia[];
  licencias: NovedadLicenciaDia[];
  /** RRHH ya la descartó en la bandeja: se muestra pero no cuenta como novedad. */
  descartada: boolean;
}

export interface EmpleadoResumen {
  empleadoId: number;
  empleado: string;
  legajo: string | null;
  departamento: string | null;
  saldoBanco: number;
  /** Días en que fichó (incluye fines de semana y feriados trabajados). */
  diasTrabajados: number;
  fichadoHs: number;
  /** Días hábiles cubiertos enteros por licencias aprobadas. */
  diasLicencia: number;
  porTipo: Record<NovedadTipo, number>;
  novedades: number;
  horasFaltantes: number;
  horasExtra: number;
  /** Solo cuando el rango es un único día: cómo estuvo ese día (para listar a todos, con o sin novedad). */
  dia?: DiaHistorial;
}

export interface RrhhHistorialResult {
  generatedAt: string;
  desde: string;
  hasta: string;
  evaluadoHasta: string;
  /** Resumen de todos los empleados activos (siempre viene). */
  empleados: EmpleadoResumen[];
  /** Solo si se pidió un empleado. */
  detalle: { empleadoId: number; dias: DiaHistorial[] } | null;
}

type EmployeeRow = {
  id: number;
  name: string;
  department_id: M2o;
  resource_calendar_id: M2o;
  barcode: string | false;
  x_studio_fecha_ingreso: string | false;
  x_studio_saldo_banco_horas: number;
};
type AttendanceRow = { employee_id: M2o; check_in: string; check_out: string | false; worked_hours: number };
type GlobalLeaveRow = { calendar_id: M2o; date_from: string; date_to: string };
type AllocationRow = { employee_id: M2o; date_from: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

function validar(desde: string, hasta: string, max: number) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(desde) || !iso.test(hasta)) throw new ApiValidationError('Fechas inválidas (usar YYYY-MM-DD)');
  if (hasta < desde) throw new ApiValidationError('La fecha "hasta" es anterior a "desde"');
  if (addDaysIso(desde, max) < hasta) throw new ApiValidationError(`El rango no puede superar ${max} días`);
}

export async function getRrhhHistorial(desde: string, hasta: string, empleadoId?: number): Promise<RrhhHistorialResult> {
  validar(desde, hasta, empleadoId ? MAX_DIAS_DETALLE : MAX_DIAS_RESUMEN);

  const hoy = getArgentinaTodayIso();
  const evaluadoHasta = hasta < hoy ? hasta : addDaysIso(hoy, -1);
  const soloEmpleado: OdooDomainLeaf[] = empleadoId ? [['employee_id', '=', empleadoId]] : [];

  const [employees, attendance, leaves, globalLeaves, acreditaciones, descartes, baseFichaje, estadosResumen] = await Promise.all([
    searchReadAll<EmployeeRow>({
      model: 'hr.employee',
      domain: [['active', '=', true]],
      fields: ['name', 'department_id', 'resource_calendar_id', 'barcode', 'x_studio_fecha_ingreso', 'x_studio_saldo_banco_horas'],
      order: 'name asc',
    }),
    searchReadAll<AttendanceRow>({
      model: 'hr.attendance',
      domain: [['check_in', '>=', `${desde} 03:00:00`], ['check_in', '<', `${addDaysIso(hasta, 1)} 03:00:00`], ...soloEmpleado],
      fields: ['employee_id', 'check_in', 'check_out', 'worked_hours'],
      order: 'check_in asc',
    }),
    searchReadAll<LeaveRow>({
      model: 'hr.leave',
      domain: [['state', 'in', ['confirm', 'validate1', 'validate']], ['request_date_from', '<=', hasta], ['request_date_to', '>=', desde], ...soloEmpleado],
      fields: ['employee_id', 'holiday_status_id', 'request_date_from', 'request_date_to', 'number_of_hours_display', 'number_of_days', 'request_unit_hours', 'state'],
    }),
    searchReadAll<GlobalLeaveRow>({
      model: 'resource.calendar.leaves',
      domain: [['resource_id', '=', false], ['date_from', '<=', `${addDaysIso(hasta, 1)} 23:59:59`], ['date_to', '>=', `${desde} 00:00:00`]],
      fields: ['calendar_id', 'date_from', 'date_to'],
    }),
    searchReadAll<AllocationRow>({
      model: 'hr.leave.allocation',
      domain: [['holiday_status_id', '=', BANCO_HORAS_TYPE_ID], ['state', 'in', ['confirm', 'validate1', 'validate']], ['date_from', '>=', desde], ['date_from', '<=', hasta], ...soloEmpleado],
      fields: ['employee_id', 'date_from'],
    }),
    listNovedadesDescartadas(desde, hasta),
    cargarBaseFichaje(),
    getEstadosResumen(),
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

  const fichadas = new Map<number, Map<string, AttendanceRow[]>>();
  for (const a of attendance) {
    if (!a.employee_id) continue;
    const porDia = fichadas.get(a.employee_id[0]) ?? new Map<string, AttendanceRow[]>();
    const dia = fechaArgentina(a.check_in);
    porDia.set(dia, [...(porDia.get(dia) ?? []), a]);
    fichadas.set(a.employee_id[0], porDia);
  }
  const licenciasPorEmpleado = new Map<number, LeaveRow[]>();
  for (const l of leaves) {
    if (!l.employee_id) continue;
    licenciasPorEmpleado.set(l.employee_id[0], [...(licenciasPorEmpleado.get(l.employee_id[0]) ?? []), l]);
  }

  const resumenes: EmpleadoResumen[] = [];
  let detalle: RrhhHistorialResult['detalle'] = null;

  for (const e of employees) {
    // Administración: "ignorar" = no aparece en ningún lado; "reporte perfecto" = aparece pero sus horas no se controlan (nunca tiene novedad).
    const estadoAdmin = estadosResumen.get(e.id);
    if (estadoAdmin === 'ignorar') continue;
    const porDia = fichadas.get(e.id) ?? new Map<string, AttendanceRow[]>();
    const feriados = (e.resource_calendar_id ? feriadosPorCalendario.get(e.resource_calendar_id[0]) : undefined) ?? new Set<string>();
    const licencias = licenciasPorEmpleado.get(e.id) ?? [];
    // Antes de su primera fichada (o de su ingreso) no se puede decir que faltó: puede que todavía no usara el kiosco (ver rrhh-fichaje-base.ts).
    const inicio = baseFichaje.inicioEvaluacion(e, desde);

    const resumen: EmpleadoResumen = {
      empleadoId: e.id,
      empleado: e.name,
      legajo: e.barcode || null,
      departamento: e.department_id ? e.department_id[1] : null,
      saldoBanco: round2(e.x_studio_saldo_banco_horas ?? 0),
      diasTrabajados: 0,
      fichadoHs: 0,
      diasLicencia: 0,
      porTipo: { 'horas-faltantes': 0, 'sin-salida': 0, 'marca-incompleta': 0, 'sin-fichada': 0, 'horas-extra': 0 },
      novedades: 0,
      horasFaltantes: 0,
      horasExtra: 0,
    };
    const dias: DiaHistorial[] = [];

    for (let d = desde; d <= hasta; d = addDaysIso(d, 1)) {
      const marcas = porDia.get(d) ?? [];
      const cerradas = marcas.filter((m) => m.check_out);
      const fichadoHs = round2(cerradas.reduce((s, m) => s + m.worked_hours, 0));
      const ultimaSalida = cerradas.length > 0 ? cerradas[cerradas.length - 1]!.check_out : false;
      const entrada = marcas[0] ? horaArgentina(marcas[0].check_in) : null;
      const salida = ultimaSalida ? horaArgentina(ultimaSalida) : null;
      const delDia: NovedadLicenciaDia[] = licencias
        .map((l) => ({ id: l.id, tipo: l.holiday_status_id ? l.holiday_status_id[1] : 'Sin tipo', estado: l.state, horas: round2(horasDeLicenciaEnDia(l, d)) }))
        .filter((l) => l.horas > 0);
      const cubiertoHs = delDia.filter((l) => l.estado === 'validate').reduce((s, l) => s + l.horas, 0);

      const dia: DiaHistorial = {
        fecha: d,
        estado: 'ok',
        entrada,
        salida,
        fichadoHs,
        horasAResolver: 0,
        marcas: marcas.map((m) => ({ entrada: horaArgentina(m.check_in), salida: m.check_out ? horaArgentina(m.check_out) : null, horas: round2(m.check_out ? m.worked_hours : 0) })),
        licencias: delDia,
        descartada: false,
      };
      if (marcas.length > 0) {
        resumen.diasTrabajados += 1;
        resumen.fichadoHs += fichadoHs;
      }

      let tipo: NovedadTipo | null = null;
      if (esFinDeSemana(d)) dia.estado = 'fin-de-semana';
      else if (feriados.has(d)) dia.estado = 'feriado';
      else if (inicio === null || d < inicio) dia.estado = 'sin-datos';
      else if (d > evaluadoHasta) dia.estado = 'pendiente';
      else if (cubiertoHs >= HORAS_DIA - TOLERANCIA_FALTANTE_HS) {
        dia.estado = 'licencia';
        resumen.diasLicencia += 1;
      } else if (marcas.length === 0) {
        tipo = 'sin-fichada';
        dia.horasAResolver = round2(HORAS_DIA - cubiertoHs);
      } else if (marcas.some((m) => !m.check_out)) {
        tipo = 'sin-salida';
      } else if (fichadoHs < MARCA_MINIMA_HS) {
        tipo = 'marca-incompleta';
        dia.horasAResolver = round2(Math.max(0, HORAS_DIA - cubiertoHs));
      } else {
        const faltan = JORNADA_FICHADA_HS - fichadoHs - cubiertoHs;
        if (faltan > TOLERANCIA_FALTANTE_HS) {
          tipo = 'horas-faltantes';
          dia.horasAResolver = round2(faltan);
        } else if (cubiertoHs === 0 && !acreditado.has(`${e.id}|${d}`) && fichadoHs - JORNADA_FICHADA_HS > TOLERANCIA_EXTRA_HS) {
          tipo = 'horas-extra';
          dia.horasAResolver = round2(fichadoHs - JORNADA_FICHADA_HS);
        }
      }

      if (tipo && estadoAdmin === 'reporte_perfecto') {
        tipo = null;
        dia.horasAResolver = 0;
      }
      if (tipo) {
        dia.estado = tipo;
        dia.descartada = descartes.map.has(`${e.id}|${d}|${tipo}`);
        if (!dia.descartada) {
          resumen.porTipo[tipo] += 1;
          resumen.novedades += 1;
          if (tipo === 'horas-faltantes' || tipo === 'sin-fichada') resumen.horasFaltantes += dia.horasAResolver;
          if (tipo === 'horas-extra') resumen.horasExtra += dia.horasAResolver;
        }
      }
      if (empleadoId === e.id || desde === hasta) dias.push(dia);
    }

    resumen.fichadoHs = round2(resumen.fichadoHs);
    resumen.horasFaltantes = round2(resumen.horasFaltantes);
    resumen.horasExtra = round2(resumen.horasExtra);
    if (desde === hasta) resumen.dia = dias[0];
    resumenes.push(resumen);
    if (empleadoId === e.id) detalle = { empleadoId: e.id, dias };
  }

  if (empleadoId && !detalle) throw new ApiValidationError('Empleado no encontrado o inactivo');

  return { generatedAt: hoy, desde, hasta, evaluadoHasta, empleados: resumenes, detalle };
}

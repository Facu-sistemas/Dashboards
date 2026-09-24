import { readGroup, searchRead, searchReadAll } from './client';
import { addDaysIso } from '../date';
import { getArgentinaTodayIso } from './oee';
import type { OdooReadGroupResult } from './types';

/**
 * `hr.leave.type` id de "Vacaciones" en la base de Frontera Living — fijo,
 * confirmado a mano contra Odoo (no hay forma estable de resolverlo por
 * nombre porque "Paid Time Off" es un tipo distinto sin usar).
 */
const VACACIONES_TYPE_ID = 5;

/**
 * A partir de qué saldo positivo se considera "acumulación alta" para
 * revisar (no es un error, pero vale la pena que RRHH lo mire) — calibrado
 * contra la distribución real: con 20 días o más quedan ~3 de 135
 * empleados, un grupo chico y accionable.
 */
const SALDO_ALTO_UMBRAL = 20;

const HORAS_CARGADAS_DIAS = 30;

export type VacacionesAnomalia = 'negativo' | 'alto' | 'ok';

export interface VacacionAsignacionRow {
  numberOfDays: number;
  dateFrom: string | null;
  dateTo: string | null;
  name: string;
}

export interface VacacionLicenciaRow {
  dateFrom: string; // "YYYY-MM-DD HH:mm:ss"
  dateTo: string;
  numberOfDays: number;
}

export interface ContratoInfo {
  wage: number;
  dateStart: string | null;
  dateEnd: string | null;
  state: string;
}

export interface EmpleadoVacacionesRow {
  id: number;
  nombre: string;
  activo: boolean;
  departamento: string | null;
  puesto: string | null;
  fechaIngreso: string | null; // ISO date
  categoriaConvenio: string | null;
  jornada: string | null;
  horasSemanales: number | null;
  enLicenciaActualmente: boolean;

  vacacionesAsignadas: number;
  vacacionesTomadas: number;
  vacacionesSaldo: number;
  anomalia: VacacionesAnomalia;
  asignaciones: VacacionAsignacionRow[];
  licenciasTomadas: VacacionLicenciaRow[];

  bancoHorasSaldo: number;
  horasCargadas30d: number;
  horasCargadasTotal: number;

  contrato: ContratoInfo | null;
}

export interface RrhhVacacionesResult {
  generatedAt: string;
  totalEmpleados: number;
  totalAnomalias: number;
  rows: EmpleadoVacacionesRow[];
}

type EmployeeRow = {
  id: number;
  name: string;
  active: boolean;
  department_id: [number, string] | false;
  job_id: [number, string] | false;
  resource_calendar_id: [number, string] | false;
  current_leave_state: string | false;
  x_studio_fecha_ingreso: string | false;
  x_studio_categora_de_convenio: [number, string] | false;
  x_studio_saldo_banco_horas: number;
};

type AllocationRow = {
  employee_id: [number, string] | false;
  number_of_days: number;
  date_from: string | false;
  date_to: string | false;
  name: string;
};

type LeaveRow = {
  employee_id: [number, string] | false;
  number_of_days: number;
  date_from: string;
  date_to: string;
};

type ContractRow = {
  employee_id: [number, string] | false;
  wage: number;
  date_start: string | false;
  date_end: string | false;
  state: string;
};

type HoursGroupRow = OdooReadGroupResult & { employee_id: [number, string] | false; unit_amount: number };

function anomaliaDe(saldo: number): VacacionesAnomalia {
  if (saldo < 0) return 'negativo';
  if (saldo >= SALDO_ALTO_UMBRAL) return 'alto';
  return 'ok';
}

async function getHorasPorSemana(): Promise<Map<number, number>> {
  const calendars = await searchRead<{ id: number; hours_per_week: number }>({
    model: 'resource.calendar',
    fields: ['hours_per_week'],
  });
  return new Map(calendars.map((c) => [c.id, c.hours_per_week]));
}

function sumByEmployee<T extends { employee_id: [number, string] | false }>(
  rows: T[],
  value: (r: T) => number
): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of rows) {
    if (!r.employee_id) continue;
    const id = r.employee_id[0];
    map.set(id, (map.get(id) ?? 0) + value(r));
  }
  return map;
}

function groupByEmployee<T extends { employee_id: [number, string] | false }>(rows: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const r of rows) {
    if (!r.employee_id) continue;
    const id = r.employee_id[0];
    const list = map.get(id) ?? [];
    list.push(r);
    map.set(id, list);
  }
  return map;
}

/**
 * Vacaciones de todos los empleados activos: saldo (asignado - tomado,
 * calculado a mano en vez de confiar en `remaining_leaves` porque ese
 * campo mezcla Vacaciones con Días compensatorios y Banco de horas), más
 * el resumen de contrato/jornada/horas cargadas que pidió RRHH para cada
 * ficha. Todo en un solo request server-side, dataset chico (~135
 * empleados), sin paginado del lado del cliente.
 */
export async function getRrhhVacaciones(): Promise<RrhhVacacionesResult> {
  const today = getArgentinaTodayIso();
  const desdeHoras = addDaysIso(today, -HORAS_CARGADAS_DIAS);

  const [employees, allocations, leaves, contracts, hoursByEmployee30d, hoursByEmployeeTotal, hoursPerWeekByCalendar] =
    await Promise.all([
      searchReadAll<EmployeeRow>({
        model: 'hr.employee',
        domain: [['active', '=', true]],
        fields: [
          'name',
          'active',
          'department_id',
          'job_id',
          'resource_calendar_id',
          'current_leave_state',
          'x_studio_fecha_ingreso',
          'x_studio_categora_de_convenio',
          'x_studio_saldo_banco_horas',
        ],
        order: 'name asc',
      }),
      searchReadAll<AllocationRow>({
        model: 'hr.leave.allocation',
        domain: [
          ['holiday_status_id', '=', VACACIONES_TYPE_ID],
          ['state', '=', 'validate'],
        ],
        fields: ['employee_id', 'number_of_days', 'date_from', 'date_to', 'name'],
      }),
      searchReadAll<LeaveRow>({
        model: 'hr.leave',
        domain: [
          ['holiday_status_id', '=', VACACIONES_TYPE_ID],
          ['state', '=', 'validate'],
        ],
        fields: ['employee_id', 'number_of_days', 'date_from', 'date_to'],
        order: 'date_from desc',
      }),
      searchReadAll<ContractRow>({
        model: 'hr.contract',
        fields: ['employee_id', 'wage', 'date_start', 'date_end', 'state'],
      }),
      readGroup({
        model: 'account.analytic.line',
        domain: [
          ['employee_id', '!=', false],
          ['date', '>=', desdeHoras],
        ],
        fields: ['unit_amount'],
        groupBy: ['employee_id'],
      }) as Promise<HoursGroupRow[]>,
      readGroup({
        model: 'account.analytic.line',
        domain: [['employee_id', '!=', false]],
        fields: ['unit_amount'],
        groupBy: ['employee_id'],
      }) as Promise<HoursGroupRow[]>,
      getHorasPorSemana(),
    ]);

  const asignadoMap = sumByEmployee(allocations, (a) => a.number_of_days);
  const tomadoMap = sumByEmployee(leaves, (l) => l.number_of_days);
  const asignacionesMap = groupByEmployee(allocations);
  const licenciasMap = groupByEmployee(leaves);
  const contratoMap = new Map(
    contracts.filter((c): c is ContractRow & { employee_id: [number, string] } => Boolean(c.employee_id)).map((c) => [c.employee_id[0], c])
  );
  const horas30dMap = sumByEmployee(hoursByEmployee30d, (g) => g.unit_amount);
  const horasTotalMap = sumByEmployee(hoursByEmployeeTotal, (g) => g.unit_amount);

  const rows: EmpleadoVacacionesRow[] = employees.map((e) => {
    const asignado = Math.round((asignadoMap.get(e.id) ?? 0) * 100) / 100;
    const tomado = Math.round((tomadoMap.get(e.id) ?? 0) * 100) / 100;
    const saldo = Math.round((asignado - tomado) * 100) / 100;
    const contrato = contratoMap.get(e.id);

    return {
      id: e.id,
      nombre: e.name,
      activo: e.active,
      departamento: e.department_id ? e.department_id[1] : null,
      puesto: e.job_id ? e.job_id[1] : null,
      fechaIngreso: e.x_studio_fecha_ingreso || null,
      categoriaConvenio: e.x_studio_categora_de_convenio ? e.x_studio_categora_de_convenio[1] : null,
      jornada: e.resource_calendar_id ? e.resource_calendar_id[1] : null,
      horasSemanales: e.resource_calendar_id ? hoursPerWeekByCalendar.get(e.resource_calendar_id[0]) ?? null : null,
      enLicenciaActualmente: Boolean(e.current_leave_state),

      vacacionesAsignadas: asignado,
      vacacionesTomadas: tomado,
      vacacionesSaldo: saldo,
      anomalia: anomaliaDe(saldo),
      asignaciones: (asignacionesMap.get(e.id) ?? [])
        .map((a) => ({ numberOfDays: a.number_of_days, dateFrom: a.date_from || null, dateTo: a.date_to || null, name: a.name }))
        .sort((a, b) => (b.dateFrom ?? '').localeCompare(a.dateFrom ?? '')),
      licenciasTomadas: (licenciasMap.get(e.id) ?? [])
        .map((l) => ({ dateFrom: l.date_from, dateTo: l.date_to, numberOfDays: l.number_of_days }))
        .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom)),

      bancoHorasSaldo: Math.round((e.x_studio_saldo_banco_horas ?? 0) * 100) / 100,
      horasCargadas30d: Math.round((horas30dMap.get(e.id) ?? 0) * 100) / 100,
      horasCargadasTotal: Math.round((horasTotalMap.get(e.id) ?? 0) * 100) / 100,

      contrato: contrato
        ? { wage: contrato.wage, dateStart: contrato.date_start || null, dateEnd: contrato.date_end || null, state: contrato.state }
        : null,
    };
  });

  rows.sort((a, b) => a.vacacionesSaldo - b.vacacionesSaldo);

  return {
    generatedAt: today,
    totalEmpleados: rows.length,
    totalAnomalias: rows.filter((r) => r.anomalia !== 'ok').length,
    rows,
  };
}

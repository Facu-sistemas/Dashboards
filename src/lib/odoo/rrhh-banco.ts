import { searchReadAll } from './client';
import { getArgentinaTodayIso } from './oee';
import { ApiValidationError } from '@/lib/api-helpers';
import { BANCO_HORAS_TYPE_ID } from './rrhh-quincena';
import type { M2o } from './rrhh-novedades';

/**
 * Movimientos del banco de horas (tipo de ausencia "Banco de horas" de Odoo), para el Excel de RRHH. SOLO LECTURA.
 *  - Alta (+): asignación (hr.leave.allocation) del tipo banco. Ej.: horas extra, "BCO HORA X INVENTARIO".
 *  - Uso (−): ausencia (hr.leave) del tipo banco, cuando el empleado se toma esas horas.
 * El saldo acumulado se calcula con TODO el historial (solo cuentan los movimientos aprobados) y después se recorta al período.
 */

export type EstadoMovimiento = 'aprobado' | 'pendiente';

export interface MovimientoBanco {
  fecha: string; // ISO
  empleadoId: number;
  empleado: string;
  departamento: string | null;
  tipo: 'alta' | 'uso';
  concepto: string;
  /** Con signo: + alta, − uso. */
  horas: number;
  estado: EstadoMovimiento;
  /** Saldo del empleado después de este movimiento (solo cuentan los aprobados). */
  saldo: number;
}

export interface SaldoEmpleadoBanco {
  empleadoId: number;
  empleado: string;
  departamento: string | null;
  altas: number;
  usos: number;
  /** Altas − usos del período mostrado. */
  neto: number;
  /** Saldo acumulado calculado con todo el historial aprobado. */
  saldoCalculado: number;
  /** Saldo que muestra Odoo hoy (campo del empleado). */
  saldoOdoo: number;
}

export interface RrhhBancoResult {
  generatedAt: string;
  desde: string;
  hasta: string;
  movimientos: MovimientoBanco[];
  empleados: SaldoEmpleadoBanco[];
  totales: { altas: number; usos: number; neto: number; saldoOdoo: number; movimientos: number; pendientes: number };
}

type EmployeeRow = { id: number; name: string; department_id: M2o; x_studio_saldo_banco_horas: number };
type AllocationRow = { id: number; name: string | false; employee_id: M2o; number_of_hours_display: number; date_from: string; state: string };
type LeaveRow = { id: number; name: string | false; employee_id: M2o; request_date_from: string; number_of_hours_display: number; state: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getRrhhBanco(desde: string, hasta: string): Promise<RrhhBancoResult> {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(desde) || !iso.test(hasta)) throw new ApiValidationError('Fechas inválidas (usar YYYY-MM-DD)');
  if (hasta < desde) throw new ApiValidationError('La fecha "hasta" es anterior a "desde"');

  const [employees, allocations, leaves] = await Promise.all([
    searchReadAll<EmployeeRow>({
      model: 'hr.employee',
      domain: [['active', '=', true]],
      fields: ['name', 'department_id', 'x_studio_saldo_banco_horas'],
      order: 'name asc',
    }),
    searchReadAll<AllocationRow>({
      model: 'hr.leave.allocation',
      domain: [['holiday_status_id', '=', BANCO_HORAS_TYPE_ID], ['state', 'in', ['confirm', 'validate1', 'validate']]],
      fields: ['name', 'employee_id', 'number_of_hours_display', 'date_from', 'state'],
    }),
    searchReadAll<LeaveRow>({
      model: 'hr.leave',
      domain: [['holiday_status_id', '=', BANCO_HORAS_TYPE_ID], ['state', 'in', ['confirm', 'validate1', 'validate']]],
      fields: ['name', 'employee_id', 'request_date_from', 'number_of_hours_display', 'state'],
    }),
  ]);

  const emp = new Map(employees.map((e) => [e.id, e]));
  type Crudo = Omit<MovimientoBanco, 'saldo'>;
  const crudos: Crudo[] = [];
  const deptoDe = (id: number) => {
    const d = emp.get(id)?.department_id;
    return d ? d[1] : null;
  };
  const nombreDe = (m: M2o) => (m ? (emp.get(m[0])?.name ?? m[1]) : 'Sin empleado');

  for (const a of allocations) {
    if (!a.employee_id) continue;
    crudos.push({
      fecha: String(a.date_from).slice(0, 10),
      empleadoId: a.employee_id[0],
      empleado: nombreDe(a.employee_id),
      departamento: deptoDe(a.employee_id[0]),
      tipo: 'alta',
      concepto: (a.name || 'Horas acreditadas al banco').trim(),
      horas: round2(a.number_of_hours_display),
      estado: a.state === 'validate' ? 'aprobado' : 'pendiente',
    });
  }
  for (const l of leaves) {
    if (!l.employee_id) continue;
    crudos.push({
      fecha: l.request_date_from,
      empleadoId: l.employee_id[0],
      empleado: nombreDe(l.employee_id),
      departamento: deptoDe(l.employee_id[0]),
      tipo: 'uso',
      concepto: (l.name || 'Horas tomadas del banco').trim(),
      horas: -round2(l.number_of_hours_display),
      estado: l.state === 'validate' ? 'aprobado' : 'pendiente',
    });
  }

  // Orden cronológico (a igual fecha, las altas antes que los usos) para que el saldo acumulado tenga sentido.
  crudos.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.tipo === b.tipo ? 0 : a.tipo === 'alta' ? -1 : 1));
  const corrido = new Map<number, number>();
  const todos: MovimientoBanco[] = crudos.map((m) => {
    const s = (corrido.get(m.empleadoId) ?? 0) + (m.estado === 'aprobado' ? m.horas : 0);
    corrido.set(m.empleadoId, s);
    return { ...m, saldo: round2(s) };
  });

  const movimientos = todos.filter((m) => m.fecha >= desde && m.fecha <= hasta);

  const porEmpleado = new Map<number, SaldoEmpleadoBanco>();
  const fila = (id: number, nombre: string, depto: string | null): SaldoEmpleadoBanco => {
    let f = porEmpleado.get(id);
    if (!f) {
      f = { empleadoId: id, empleado: nombre, departamento: depto, altas: 0, usos: 0, neto: 0, saldoCalculado: round2(corrido.get(id) ?? 0), saldoOdoo: round2(emp.get(id)?.x_studio_saldo_banco_horas ?? 0) };
      porEmpleado.set(id, f);
    }
    return f;
  };
  for (const m of movimientos) {
    if (m.estado !== 'aprobado') continue;
    const f = fila(m.empleadoId, m.empleado, m.departamento);
    if (m.horas > 0) f.altas = round2(f.altas + m.horas);
    else f.usos = round2(f.usos - m.horas);
    f.neto = round2(f.altas - f.usos);
  }
  // Empleados con saldo en Odoo aunque no hayan tenido movimientos en el período.
  for (const e of employees) if ((e.x_studio_saldo_banco_horas ?? 0) !== 0) fila(e.id, e.name, e.department_id ? e.department_id[1] : null);

  const aprobados = movimientos.filter((m) => m.estado === 'aprobado');
  const altas = round2(aprobados.filter((m) => m.horas > 0).reduce((s, m) => s + m.horas, 0));
  const usos = round2(-aprobados.filter((m) => m.horas < 0).reduce((s, m) => s + m.horas, 0));

  return {
    generatedAt: getArgentinaTodayIso(),
    desde,
    hasta,
    movimientos,
    empleados: [...porEmpleado.values()].sort((a, b) => a.empleado.localeCompare(b.empleado, 'es')),
    totales: {
      altas,
      usos,
      neto: round2(altas - usos),
      saldoOdoo: round2(employees.reduce((s, e) => s + (e.x_studio_saldo_banco_horas ?? 0), 0)),
      movimientos: movimientos.length,
      pendientes: movimientos.filter((m) => m.estado === 'pendiente').length,
    },
  };
}

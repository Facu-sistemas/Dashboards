import { addDaysIso } from '@/lib/date';
import { getArgentinaTodayIso } from './oee';
import { getRrhhHistorial, type DiaHistorial } from './rrhh-historial';
import { getRrhhBanco, type MovimientoBanco } from './rrhh-banco';
import { getRrhhVacaciones, type VacacionLicenciaRow } from './rrhh-vacaciones';

/**
 * Datos del portal del empleado (/empleados): solo lectura y solo lo del propio empleado. Reusa los cálculos de RRHH
 * para que lo que ve el empleado coincida con lo que ve RRHH. NO incluye sueldo ni contrato.
 */

export interface PortalEmpleado {
  hoy: string;
  empleado: { id: number; nombre: string; legajo: string | null; departamento: string | null; puesto: string | null; fechaIngreso: string | null; jornada: string | null };
  /** Estado de hoy: si está adentro (marca abierta) y sus fichadas del día. */
  hoyEstado: { fichado: boolean; marcas: DiaHistorial['marcas']; fichadoHs: number; licencia: boolean };
  mes: {
    periodo: string;
    diasTrabajados: number;
    horasCargadas: number;
    horasEsperadas: number | null;
    horasEsperadasMesCompleto: number | null;
    novedades: number;
    horasFaltantes: number;
    horasExtra: number;
    dias: DiaHistorial[];
  };
  banco: { saldo: number; movimientos: MovimientoBanco[] };
  vacaciones: { asignadas: number; tomadas: number; saldo: number; licenciasTomadas: VacacionLicenciaRow[] };
}

const MESES_BANCO_ATRAS = 6;

export async function getPortalEmpleado(empleadoId: number): Promise<PortalEmpleado> {
  const hoy = getArgentinaTodayIso();
  const periodo = hoy.slice(0, 7);
  const primeroMes = `${periodo}-01`;
  const finMes = (() => {
    const [y, m] = periodo.split('-').map(Number) as [number, number];
    return `${periodo}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  })();
  const desdeBanco = addDaysIso(hoy, -30 * MESES_BANCO_ATRAS);

  const [historial, banco, vacaciones] = await Promise.all([
    getRrhhHistorial(primeroMes, finMes, empleadoId),
    getRrhhBanco(desdeBanco, hoy),
    getRrhhVacaciones(),
  ]);

  const resumen = historial.empleados.find((e) => e.empleadoId === empleadoId);
  const fila = vacaciones.rows.find((r) => r.id === empleadoId);
  const saldoBanco = banco.empleados.find((e) => e.empleadoId === empleadoId);
  const dias = historial.detalle?.dias ?? [];
  const diaHoy = dias.find((d) => d.fecha === hoy);
  if (!resumen) throw new Error('Empleado no encontrado');

  return {
    hoy,
    empleado: {
      id: empleadoId,
      nombre: resumen.empleado,
      legajo: resumen.legajo,
      departamento: resumen.departamento,
      puesto: fila?.puesto ?? null,
      fechaIngreso: fila?.fechaIngreso ?? null,
      jornada: fila?.jornada ?? null,
    },
    hoyEstado: {
      fichado: !!diaHoy?.marcas.some((m) => m.salida === null),
      marcas: diaHoy?.marcas ?? [],
      fichadoHs: diaHoy?.fichadoHs ?? 0,
      licencia: (diaHoy?.licencias.length ?? 0) > 0,
    },
    mes: {
      periodo,
      diasTrabajados: resumen.diasTrabajados,
      horasCargadas: fila?.horasCargadasMes ?? resumen.fichadoHs,
      horasEsperadas: fila?.horasEsperadasMes ?? null,
      horasEsperadasMesCompleto: fila?.horasEsperadasMesCompleto ?? null,
      novedades: resumen.novedades,
      horasFaltantes: resumen.horasFaltantes,
      horasExtra: resumen.horasExtra,
      dias,
    },
    banco: {
      saldo: saldoBanco?.saldoOdoo ?? resumen.saldoBanco,
      movimientos: banco.movimientos.filter((m) => m.empleadoId === empleadoId).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)),
    },
    vacaciones: {
      asignadas: fila?.vacacionesAsignadas ?? 0,
      tomadas: fila?.vacacionesTomadas ?? 0,
      saldo: fila?.vacacionesSaldo ?? 0,
      licenciasTomadas: fila?.licenciasTomadas ?? [],
    },
  };
}

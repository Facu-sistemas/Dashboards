export type CalidadRange = 'all' | 'this-year' | 'last-12-months' | 'last-6-months';

export type {
  TicketsPorMotivoRow,
  ReparacionesFlujoPoint,
  ReparacionGasto,
  TicketDetalle,
  TicketsSoporteResult,
} from '@/lib/odoo/calidad';

export interface ReparacionSectorMonthlyPoint {
  month: string;
  cantidadReparaciones: number;
  horasReparacion: number;
  totalRecuperado: number;
  unidadesFabricadas: number;
  reparacionesPorMilUnidades: number | null;
}

export interface ReparacionesSectorResult {
  totalReparaciones: number;
  totalHoras: number;
  totalRecuperado: number;
  totalUnidadesFabricadas: number;
  mensual: ReparacionSectorMonthlyPoint[];
}

export interface ReparacionColchonMonthlyPoint {
  month: string;
  cantidadNotasCredito: number;
  montoNotasCredito: number;
  cantidadGarantia: number;
  montoGarantia: number;
  cantidadCalidad: number;
  montoCalidad: number;
  horasReparacion: number;
  unidadesFabricadas: number;
  notasCreditoPorMilUnidades: number | null;
}

export interface ReparacionesColchonResult {
  totalNotasCredito: number;
  totalMontoNotasCredito: number;
  totalHoras: number;
  totalUnidadesFabricadas: number;
  mensual: ReparacionColchonMonthlyPoint[];
}

export interface ReparacionesResult {
  totalSinSector: number;
  valorHora: number;
  living: ReparacionesSectorResult;
  colchon: ReparacionesColchonResult;
}

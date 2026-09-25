export type CalidadRange = 'all' | 'this-year' | 'last-12-months' | 'last-6-months';

/** Filtro de empresa solo para la sección de Notas de Crédito por Garantía — Tickets siempre queda en Frontera Living S.A. */
export type NotasCreditoEmpresaFilter = 'all' | 'frontera' | 'presupuesto';

export interface TicketsPorTipoRow {
  tipo: string;
  cantidad: number;
}

export interface TicketsPorPrioridadRow {
  prioridad: string;
  cantidad: number;
}

export interface TicketsMonthlyPoint {
  month: string;
  cantidad: number;
}

export interface NotasCreditoGarantiaPoint {
  month: string;
  living: number;
  colchon: number;
  sinSector: number;
  totalNotasCredito: number;
  pctDelTotal: number | null;
}

export interface TicketsSoporteResult {
  total: number;
  porTipo: TicketsPorTipoRow[];
  porPrioridad: TicketsPorPrioridadRow[];
  mensual: TicketsMonthlyPoint[];
  notasCreditoGarantia: NotasCreditoGarantiaPoint[];
}

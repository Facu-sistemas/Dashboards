export type CalidadRange = 'all' | 'this-year' | 'last-12-months' | 'last-6-months';

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

export interface TicketsSoporteResult {
  total: number;
  porTipo: TicketsPorTipoRow[];
  porPrioridad: TicketsPorPrioridadRow[];
  mensual: TicketsMonthlyPoint[];
}

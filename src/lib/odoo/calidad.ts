import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { lastMonthKeys, rangePresetStartDate, type DateRangePreset } from '../date';

const TREND_MONTHS = 12;

const PRIORITY_LABELS: Record<string, string> = {
  '0': 'Baja',
  '1': 'Media',
  '2': 'Alta',
  '3': 'Urgente',
};
const PRIORITY_ORDER = ['Baja', 'Media', 'Alta', 'Urgente'];

export interface TicketsPorTipoRow {
  tipo: string;
  cantidad: number;
}

export interface TicketsPorPrioridadRow {
  prioridad: string;
  cantidad: number;
}

export interface TicketsMonthlyPoint {
  month: string; // "YYYY-MM"
  cantidad: number;
}

export interface TicketsSoporteResult {
  total: number;
  porTipo: TicketsPorTipoRow[];
  porPrioridad: TicketsPorPrioridadRow[];
  mensual: TicketsMonthlyPoint[];
}

/**
 * Only "Tipo" (`ticket_type_id`) and "Prioridad" (`priority`) are usably
 * populated on real tickets — confirmed live that "Motivo"
 * (`x_studio_motivo` / `x_studio_motivo_1`, split by Tipo) is set on only 1
 * of 219 tickets, and "Bajo garantía" has zero real variance (218/219
 * false). The heatmap Tipo×Motivo and Pareto-de-Motivos from the original
 * plan would render as essentially empty against real data, so this v1
 * only covers what Calidad actually tracks today: tickets by Tipo, by
 * Prioridad, and monthly volume. Revisit once Motivo gets filled in
 * consistently.
 */
export async function getTicketsSoporte(range: DateRangePreset): Promise<TicketsSoporteResult> {
  const { companyId } = await getFronteraCompany();

  type Row = { ticket_type_id: [number, string] | false; priority: string; create_date: string };
  const allRows = await searchReadAll<Row>({
    model: 'helpdesk.ticket',
    domain: [['company_id', '=', companyId]],
    fields: ['ticket_type_id', 'priority', 'create_date'],
  });

  const startDate = rangePresetStartDate(range);
  const filtered = startDate ? allRows.filter((r) => r.create_date >= startDate) : allRows;

  const tipoCounts = new Map<string, number>();
  for (const r of filtered) {
    const tipo = r.ticket_type_id ? r.ticket_type_id[1] : 'Sin tipo';
    tipoCounts.set(tipo, (tipoCounts.get(tipo) ?? 0) + 1);
  }
  const porTipo = [...tipoCounts.entries()].map(([tipo, cantidad]) => ({ tipo, cantidad })).sort((a, b) => b.cantidad - a.cantidad);

  const prioridadCounts = new Map<string, number>();
  for (const r of filtered) {
    const label = PRIORITY_LABELS[r.priority] ?? r.priority;
    prioridadCounts.set(label, (prioridadCounts.get(label) ?? 0) + 1);
  }
  const porPrioridad = PRIORITY_ORDER.map((prioridad) => ({ prioridad, cantidad: prioridadCounts.get(prioridad) ?? 0 }));

  // Fixed last-12-months trend, independent of the range filter — same
  // convention as Facturación's monthly trend row.
  const months = lastMonthKeys(TREND_MONTHS);
  const monthSet = new Set(months);
  const monthCounts = new Map<string, number>();
  for (const r of allRows) {
    const month = r.create_date.slice(0, 7);
    if (monthSet.has(month)) monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
  }
  const mensual = months.map((month) => ({ month, cantidad: monthCounts.get(month) ?? 0 }));

  return { total: filtered.length, porTipo, porPrioridad, mensual };
}

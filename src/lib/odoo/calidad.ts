import { searchRead, searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { currentMonthKey, lastMonthKeys, monthsBetween, rangePresetStartDate, type DateRangePreset } from '../date';
import type { OdooDomain } from './types';

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

export interface NotasCreditoGarantiaPoint {
  month: string; // "YYYY-MM"
  living: number;
  colchon: number;
  sinSector: number;
  /** Monto total de TODAS las notas de crédito posteadas ese mes (cualquier motivo), para poder dimensionar qué % representa la garantía. */
  totalNotasCredito: number;
  /** (living+colchon+sinSector)/totalNotasCredito × 100 — null si no hubo notas de crédito ese mes (dividir por 0 no tiene sentido). */
  pctDelTotal: number | null;
}

export interface TicketsSoporteResult {
  total: number;
  porTipo: TicketsPorTipoRow[];
  porPrioridad: TicketsPorPrioridadRow[];
  mensual: TicketsMonthlyPoint[];
  notasCreditoGarantia: NotasCreditoGarantiaPoint[];
}

/**
 * `x_studio_motivo` on `account.move` ("Tipo de Nota de Crédito") stores this
 * value with a typo — "Garantatía" — even though the label shown in the
 * Odoo UI reads "Garantía". Confirmed live against the "Notas de Crédito"
 * saved filter (Tipo de Nota de Crédito = Garantía, Sector = Colchón):
 * matched exactly (14 rows, -$6.042.710,11 sin impuestos for Sept 2026).
 */
const CREDIT_NOTE_WARRANTY_MOTIVO = 'Garantatía';

/**
 * Selector de empresa para Notas de Crédito por Garantía — deliberately
 * separate from Tickets' `companyId` (siempre Frontera Living S.A. para
 * tickets, ver `getTicketsSoporte`). 'all' es el default y reproduce la
 * vista `cids=1-2` de Odoo que el usuario usa para confirmar estos números.
 */
export type NotasCreditoEmpresa = 'all' | 'frontera' | 'presupuesto';

const EMPRESA_NAME: Record<Exclude<NotasCreditoEmpresa, 'all'>, string> = {
  frontera: 'Frontera Living S.A',
  presupuesto: 'Presupuesto',
};

async function resolveEmpresaDomain(empresa: NotasCreditoEmpresa): Promise<OdooDomain> {
  if (empresa === 'all') return [];
  type Row = { id: number; name: string };
  const rows = await searchRead<Row>({ model: 'res.company', fields: ['name'] });
  const company = rows.find((r) => r.name === EMPRESA_NAME[empresa]);
  // No match => an empty (impossible) filter rather than silently falling
  // back to "all", so a renamed/missing company shows 0 instead of lying.
  return [['company_id', '=', company?.id ?? -1]];
}

/**
 * Monto ($) de notas de crédito por garantía, por mes, separado Living vs.
 * Colchón — histórico completo sin recorte de rango: a diferencia de
 * Tickets, este dato recién empezó a cargarse en Odoo en septiembre 2026,
 * así que no hay un "antes" no comparable que excluir; el gráfico
 * simplemente crece un mes por vez.
 *
 * Deliberately NOT scoped to `company_id` by default (unlike
 * `getTicketsSoporte`) — confirmed live against the user's own Odoo view
 * (`cids=1-2`, both "Frontera Living S.A" and "Presupuesto"): restricting to
 * one company dropped 5 of 14 September rows and undercounted Colchón by
 * ~$1.5M. `empresa` lets the user narrow to one company when they want to.
 */
async function getNotasCreditoGarantia(empresa: NotasCreditoEmpresa): Promise<NotasCreditoGarantiaPoint[]> {
  type Row = { invoice_date: string; x_studio_sector: string | false; x_studio_motivo: string | false; amount_total_signed: number };

  const empresaDomain = await resolveEmpresaDomain(empresa);

  // Un solo fetch de TODAS las notas de crédito posteadas (cualquier
  // motivo) — de ahí sacamos tanto el desglose de Garantía (Living/Colchón)
  // como el total mensual que sirve de denominador para el %.
  const rows = await searchReadAll<Row>({
    model: 'account.move',
    domain: [
      ['move_type', '=', 'out_refund'],
      ['state', '=', 'posted'],
      ...empresaDomain,
    ],
    fields: ['invoice_date', 'x_studio_sector', 'x_studio_motivo', 'amount_total_signed'],
  });

  const garantiaRows = rows.filter((r) => r.x_studio_motivo === CREDIT_NOTE_WARRANTY_MOTIVO);
  if (garantiaRows.length === 0) return [];

  const byMonth = new Map<string, { living: number; colchon: number; sinSector: number }>();
  for (const r of garantiaRows) {
    const month = r.invoice_date.slice(0, 7);
    const bucket = byMonth.get(month) ?? { living: 0, colchon: 0, sinSector: 0 };
    const monto = Math.abs(r.amount_total_signed);
    if (r.x_studio_sector === 'Living') bucket.living += monto;
    else if (r.x_studio_sector === 'Colchon') bucket.colchon += monto;
    else bucket.sinSector += monto;
    byMonth.set(month, bucket);
  }

  const totalByMonth = new Map<string, number>();
  for (const r of rows) {
    const month = r.invoice_date.slice(0, 7);
    totalByMonth.set(month, (totalByMonth.get(month) ?? 0) + Math.abs(r.amount_total_signed));
  }

  const months = [...byMonth.keys()].sort();
  const allMonths = monthsBetween(months[0]!, currentMonthKey());
  return allMonths.map((month) => {
    const bucket = byMonth.get(month) ?? { living: 0, colchon: 0, sinSector: 0 };
    const totalNotasCredito = totalByMonth.get(month) ?? 0;
    const garantiaTotal = bucket.living + bucket.colchon + bucket.sinSector;
    const pctDelTotal = totalNotasCredito > 0 ? (garantiaTotal / totalNotasCredito) * 100 : null;
    return { month, ...bucket, totalNotasCredito, pctDelTotal };
  });
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
export async function getTicketsSoporte(range: DateRangePreset, notasCreditoEmpresa: NotasCreditoEmpresa = 'all'): Promise<TicketsSoporteResult> {
  const { companyId } = await getFronteraCompany();

  type Row = { ticket_type_id: [number, string] | false; priority: string; create_date: string };
  const [allRows, notasCreditoGarantia] = await Promise.all([
    searchReadAll<Row>({
      model: 'helpdesk.ticket',
      domain: [['company_id', '=', companyId]],
      fields: ['ticket_type_id', 'priority', 'create_date'],
    }),
    getNotasCreditoGarantia(notasCreditoEmpresa),
  ]);

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

  return { total: filtered.length, porTipo, porPrioridad, mensual, notasCreditoGarantia };
}

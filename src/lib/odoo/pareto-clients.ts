import { readGroup, searchRead } from './client';
import { getFronteraCompany } from './reference';
import { rangePresetStartDate, monthBounds, lastMonthKeys, type DateRangePreset } from '../date';
import type { OdooDomain, OdooReadGroupResult } from './types';

const TOP_N = 10;
const DEFAULT_MONTHLY_WINDOW = 6;
const MAX_COMPARE_CLIENTS = 2;

export type ParetoRange = DateRangePreset;

export interface ParetoClientRow {
  partnerId: number;
  partnerName: string;
  amount: number;
  /** Total units across every product line on this client's invoices (mixes product types, same caveat as the Manufactura ranking's "unidades") — same period as `amount`. */
  unitsSold: number;
  /** % of TOTAL invoiced revenue (all clients, not just the shown top 10) accumulated up to and including this row. */
  cumulativePct: number;
}

export interface ParetoClientsResult {
  rows: ParetoClientRow[];
  /** Total invoiced across every client in the period, not just the top 10 — the true denominator behind cumulativePct. */
  grandTotal: number;
}

/**
 * "Facturación" = posted customer invoices (account.move, move_type
 * 'out_invoice', state 'posted'), scoped to Frontera Living S.A.
 *
 * Odoo also has a second company here ("Presupuesto") with its own
 * out_invoice moves — confirmed live these aren't real client sales
 * (same company reference.ts already warns about for analytic accounts).
 * Mixing them in would inflate the total by ~25% with numbers that don't
 * represent actual revenue, so every query here is explicitly scoped to
 * Frontera Living S.A.'s company_id.
 *
 * All posted invoices here are in ARS (confirmed live, single currency) —
 * no currency-split handling needed, unlike the purchase-budget dashboard.
 */
export async function getParetoClients(range: ParetoRange): Promise<ParetoClientsResult> {
  const { companyId } = await getFronteraCompany();

  const domain: OdooDomain = [
    ['move_type', '=', 'out_invoice'],
    ['state', '=', 'posted'],
    ['company_id', '=', companyId],
  ];
  const start = rangePresetStartDate(range);
  if (start) domain.push(['invoice_date', '>=', start]);

  type GroupRow = OdooReadGroupResult & { partner_id: [number, string] | false; amount_total: number };
  const groups = (await readGroup({
    model: 'account.move',
    domain,
    fields: ['amount_total'],
    groupBy: ['partner_id'],
    orderby: 'amount_total desc',
  })) as GroupRow[];

  const named = groups.filter((g): g is GroupRow & { partner_id: [number, string] } => Boolean(g.partner_id));
  const grandTotal = named.reduce((sum, g) => sum + g.amount_total, 0);
  const top = named.slice(0, TOP_N);

  const unitsByPartner = await getClientUnitsSold(
    top.map((g) => g.partner_id[0]),
    companyId,
    start
  );

  let cumulative = 0;
  const rows: ParetoClientRow[] = top.map((g) => {
    cumulative += g.amount_total;
    return {
      partnerId: g.partner_id[0],
      partnerName: g.partner_id[1],
      amount: g.amount_total,
      unitsSold: unitsByPartner.get(g.partner_id[0]) ?? 0,
      cumulativePct: grandTotal > 0 ? (cumulative / grandTotal) * 100 : 0,
    };
  });

  return { rows, grandTotal };
}

/**
 * Total units across invoice lines that actually carry a product (excludes
 * tax/section/payment-term lines, which have no `product_id` and would
 * otherwise pollute the sum) — confirmed live that `display_type` splits
 * these cleanly via a plain `product_id != false` filter.
 */
async function getClientUnitsSold(partnerIds: number[], companyId: number, start: string | null): Promise<Map<number, number>> {
  if (partnerIds.length === 0) return new Map();

  const domain: OdooDomain = [
    ['move_id.move_type', '=', 'out_invoice'],
    ['move_id.state', '=', 'posted'],
    ['move_id.company_id', '=', companyId],
    ['product_id', '!=', false],
    ['partner_id', 'in', partnerIds],
  ];
  if (start) domain.push(['move_id.invoice_date', '>=', start]);

  type GroupRow = OdooReadGroupResult & { partner_id: [number, string] | false; quantity: number };
  const groups = (await readGroup({
    model: 'account.move.line',
    domain,
    fields: ['quantity'],
    groupBy: ['partner_id'],
  })) as GroupRow[];

  const map = new Map<number, number>();
  for (const g of groups) {
    if (g.partner_id) map.set(g.partner_id[0], g.quantity);
  }
  return map;
}

export interface ClientMonthlyPoint {
  month: string; // YYYY-MM
  amount: number;
}

export interface ClientMonthlySeries {
  partnerId: number;
  partnerName: string;
  points: ClientMonthlyPoint[];
}

/**
 * Monthly invoiced total for one or two clients (drill-down / "Comparar"
 * mode), over a fixed rolling window — independent of the ranking's own
 * period selector, per plan-top-clientes.md's "ventana inicial: 6 meses".
 * Every requested id gets a full, zero-filled series (even months with no
 * invoices at all) so a quiet client still renders bars, not a gap.
 */
export async function getClientMonthlyBilling(
  partnerIds: number[],
  monthsBack: number = DEFAULT_MONTHLY_WINDOW
): Promise<ClientMonthlySeries[]> {
  if (partnerIds.length === 0) return [];
  const ids = partnerIds.slice(0, MAX_COMPARE_CLIENTS);

  const { companyId } = await getFronteraCompany();
  const months = lastMonthKeys(monthsBack);
  const rangeStart = monthBounds(months[0]!).start;

  type GroupRow = OdooReadGroupResult & {
    partner_id: [number, string] | false;
    amount_total: number;
    __range?: Record<string, { from: string | false; to: string | false }>;
  };

  const [nameRows, groups] = await Promise.all([
    searchRead<{ id: number; name: string }>({
      model: 'res.partner',
      domain: [['id', 'in', ids]],
      fields: ['name'],
    }),
    readGroup({
      model: 'account.move',
      domain: [
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
        ['company_id', '=', companyId],
        ['partner_id', 'in', ids],
        ['invoice_date', '>=', rangeStart],
      ],
      fields: ['amount_total'],
      groupBy: ['partner_id', 'invoice_date:month'],
      lazy: false,
    }) as Promise<GroupRow[]>,
  ]);

  const nameById = new Map(nameRows.map((r) => [r.id, r.name]));

  const amountByPartnerMonth = new Map<number, Map<string, number>>();
  for (const g of groups) {
    if (!g.partner_id) continue;
    const [id] = g.partner_id;
    const monthFrom = g.__range?.['invoice_date:month']?.from;
    if (!monthFrom) continue;
    if (!amountByPartnerMonth.has(id)) amountByPartnerMonth.set(id, new Map());
    amountByPartnerMonth.get(id)!.set(monthFrom.slice(0, 7), g.amount_total);
  }

  return ids.map((id) => ({
    partnerId: id,
    partnerName: nameById.get(id) ?? `#${id}`,
    points: months.map((month) => ({ month, amount: amountByPartnerMonth.get(id)?.get(month) ?? 0 })),
  }));
}

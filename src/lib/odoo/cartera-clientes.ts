import { readGroup } from './client';
import { getFronteraCompany } from './reference';
import type { OdooDomain, OdooReadGroupResult } from './types';

const SIN_ASIGNAR = 'Sin asignar';

/**
 * One client's purchases on one day, from one salesperson: [clientIdx, dateStr (YYYY-MM-DD), amount, vendorIdx, nOrders].
 * Compact on purpose — the whole dataset ships to the browser so the tab can
 * recompute snapshots (estado, Pareto, ISC) instantly as the user tweaks
 * periodoActivo/montoMinimo/umbralDormido/fecha de corte, without a round
 * trip per control change. Day granularity (not per-invoice) keeps this
 * small while preserving exact "days since last purchase" math.
 */
export type CarteraRecord = [clientIdx: number, dateStr: string, amount: number, vendorIdx: number, nOrders: number];

export interface CarteraClientesData {
  clients: string[];
  vendors: string[];
  records: CarteraRecord[];
}

/**
 * "Facturación" = posted customer invoices (account.move, move_type
 * 'out_invoice', state 'posted'), scoped to Frontera Living S.A. — same
 * convention as pareto-clients.ts and clientes-activos.ts. No netting of
 * notas de crédito here: this dashboard measures purchase activity/value,
 * same as the reference prototype it's built from.
 */
export async function getCarteraClientes(): Promise<CarteraClientesData> {
  const { companyId } = await getFronteraCompany();

  const domain: OdooDomain = [
    ['move_type', '=', 'out_invoice'],
    ['state', '=', 'posted'],
    ['company_id', '=', companyId],
  ];

  type GroupRow = OdooReadGroupResult & {
    partner_id: [number, string] | false;
    invoice_user_id: [number, string] | false;
    amount_total: number;
    __range?: Record<string, { from: string | false; to: string | false }>;
  };

  const groups = (await readGroup({
    model: 'account.move',
    domain,
    fields: ['amount_total'],
    groupBy: ['partner_id', 'invoice_date:day', 'invoice_user_id'],
    lazy: false,
  })) as GroupRow[];

  const clientIndex = new Map<number, number>();
  const clients: string[] = [];
  const vendorIndex = new Map<number, number>();
  const vendors: string[] = [];

  function clientIdx(id: number, name: string): number {
    let idx = clientIndex.get(id);
    if (idx === undefined) {
      idx = clients.length;
      clientIndex.set(id, idx);
      clients.push(name);
    }
    return idx;
  }

  const UNASSIGNED_KEY = -1;
  function vendorIdx(partner: [number, string] | false): number {
    const key = partner ? partner[0] : UNASSIGNED_KEY;
    const name = partner ? partner[1] : SIN_ASIGNAR;
    let idx = vendorIndex.get(key);
    if (idx === undefined) {
      idx = vendors.length;
      vendorIndex.set(key, idx);
      vendors.push(name);
    }
    return idx;
  }

  const records: CarteraRecord[] = [];
  for (const g of groups) {
    if (!g.partner_id) continue;
    const dateStr = g.__range?.['invoice_date:day']?.from;
    if (!dateStr) continue;
    records.push([
      clientIdx(g.partner_id[0], g.partner_id[1]),
      dateStr.slice(0, 10),
      g.amount_total,
      vendorIdx(g.invoice_user_id),
      g.__count,
    ]);
  }

  return { clients, vendors, records };
}

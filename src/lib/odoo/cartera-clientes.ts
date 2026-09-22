import { readGroup, searchRead } from './client';
import type { OdooReadGroupResult } from './types';

const SIN_ASIGNAR = 'Sin asignar';

/**
 * One client's purchases on one day, from one salesperson, in one company:
 * [clientIdx, dateStr (YYYY-MM-DD), amount, vendorIdx, nOrders, companyIdx].
 * Compact on purpose — the whole dataset ships to the browser so the tab can
 * recompute snapshots (estado, Pareto, ISC) instantly as the user tweaks
 * periodoActivo/montoMinimo/umbralDormido/fecha de corte/empresa, without a
 * round trip per control change. Day granularity (not per-invoice) keeps
 * this small while preserving exact "days since last purchase" math.
 */
export type CarteraRecord = [
  clientIdx: number,
  dateStr: string,
  amount: number,
  vendorIdx: number,
  nOrders: number,
  companyIdx: number,
];

export interface CarteraCompany {
  id: number;
  name: string;
}

export interface CarteraClientesData {
  clients: string[];
  vendors: string[];
  companies: CarteraCompany[];
  records: CarteraRecord[];
}

/**
 * "Facturación" = posted customer invoices (account.move, move_type
 * 'out_invoice', state 'posted'), across every company in Odoo (Frontera
 * Living S.A. and Presupuesto) — unlike pareto-clients.ts/clientes-activos.ts,
 * which only look at Frontera Living S.A. because "Presupuesto" isn't real
 * sales revenue there. Here the choice of which company(ies) to include is
 * left to the user via a filter in the tab (default: both), since Salud de
 * la Cartera is explicitly meant to let that be toggled. No netting of
 * notas de crédito: this dashboard measures purchase activity/value, same
 * as the reference prototype it's built from.
 */
export async function getCarteraClientes(): Promise<CarteraClientesData> {
  const companyRows = await searchRead<{ id: number; name: string }>({
    model: 'res.company',
    fields: ['name'],
    order: 'id asc',
  });
  const companies: CarteraCompany[] = companyRows.map((c) => ({ id: c.id, name: c.name }));
  const companyIdxById = new Map(companies.map((c, idx) => [c.id, idx]));

  type GroupRow = OdooReadGroupResult & {
    partner_id: [number, string] | false;
    invoice_user_id: [number, string] | false;
    company_id: [number, string] | false;
    amount_total: number;
    __range?: Record<string, { from: string | false; to: string | false }>;
  };

  const groups = (await readGroup({
    model: 'account.move',
    domain: [
      ['move_type', '=', 'out_invoice'],
      ['state', '=', 'posted'],
    ],
    fields: ['amount_total'],
    groupBy: ['partner_id', 'invoice_date:day', 'invoice_user_id', 'company_id'],
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
    if (!g.partner_id || !g.company_id) continue;
    const dateStr = g.__range?.['invoice_date:day']?.from;
    if (!dateStr) continue;
    const companyIdx = companyIdxById.get(g.company_id[0]);
    if (companyIdx === undefined) continue; // company disappeared between the two queries — skip rather than crash
    records.push([
      clientIdx(g.partner_id[0], g.partner_id[1]),
      dateStr.slice(0, 10),
      g.amount_total,
      vendorIdx(g.invoice_user_id),
      g.__count,
      companyIdx,
    ]);
  }

  return { clients, vendors, companies, records };
}

import { readGroup, searchRead } from './client';
import type { OdooReadGroupResult } from './types';

const SIN_ASIGNAR = 'Sin asignar';

/**
 * One client's purchases on one day, from one salesperson, in one company:
 * [clientIdx, dateStr (YYYY-MM-DD), amount, vendorIdx, nOrders, companyIdx].
 * Compact on purpose — the whole dataset ships to the browser so the tab can
 * recompute snapshots (estado, Pareto, ISC) instantly as the user tweaks
 * periodoActivo/montoMinimo/umbralDormido/fecha de corte/empresa, without a
 * round trip per control change. Day granularity (not per-invoice/pedido)
 * keeps this small while preserving exact "days since last purchase" math.
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
 * 'pedidos' (default) = `sale.order` confirmado (state='sale'), por
 * `date_order` — mismo criterio y misma razón que clientes-activos.ts:
 * "ingreso de pedido", no la factura que puede llegar semanas después.
 * 'facturas' = el comportamiento original, `account.move` posted
 * (out_invoice), por `invoice_date`. Necesario para que Salud de la
 * Cartera y Clientes Activos puedan dar el mismo número con los mismos
 * parámetros, cualquiera sea la fuente elegida en cada uno.
 */
export type CarteraFuente = 'pedidos' | 'facturas';

/**
 * "Facturación"/"Ventas" (según `fuente`) — across every company in Odoo
 * (Frontera Living S.A. and Presupuesto). Acá la elección de qué compañía(s)
 * incluir queda en manos del usuario vía un filtro en el tab (default:
 * ambas). En fuente 'pedidos' esto casi no importa — "Presupuesto" tiene
 * prácticamente cero pedidos cargados (visto en vivo: 2 contra >10k de
 * Frontera Living), a diferencia de facturas, donde sí infla el total.
 * No hay neteo de notas de crédito: este tablero mide actividad/valor de
 * compra, igual que el prototipo de referencia sobre el que está armado.
 */
export async function getCarteraClientes(fuente: CarteraFuente = 'pedidos'): Promise<CarteraClientesData> {
  const companyRows = await searchRead<{ id: number; name: string }>({
    model: 'res.company',
    fields: ['name'],
    order: 'id asc',
  });
  const companies: CarteraCompany[] = companyRows.map((c) => ({ id: c.id, name: c.name }));
  const companyIdxById = new Map(companies.map((c, idx) => [c.id, idx]));

  type RawGroupRow = OdooReadGroupResult & {
    partner_id: [number, string] | false;
    company_id: [number, string] | false;
    amount_total: number;
    __range?: Record<string, { from: string | false; to: string | false }>;
    [vendorField: string]: unknown;
  };

  // Mismo shape de resultado ([cliente, día, monto, vendedor, empresa]),
  // pero cada fuente vive en un modelo y campos de Odoo distintos —
  // sale.order.user_id vs account.move.invoice_user_id, date_order vs
  // invoice_date. Se resuelve acá el nombre de campo una sola vez, el
  // resto de la función no necesita saber cuál fue.
  const dateGroupKey = fuente === 'pedidos' ? 'date_order:day' : 'invoice_date:day';
  const vendorField = fuente === 'pedidos' ? 'user_id' : 'invoice_user_id';

  const groups = (await readGroup(
    fuente === 'pedidos'
      ? {
          model: 'sale.order',
          domain: [['state', '=', 'sale']],
          fields: ['amount_total'],
          groupBy: ['partner_id', dateGroupKey, vendorField, 'company_id'],
          lazy: false,
        }
      : {
          model: 'account.move',
          domain: [
            ['move_type', '=', 'out_invoice'],
            ['state', '=', 'posted'],
          ],
          fields: ['amount_total'],
          groupBy: ['partner_id', dateGroupKey, vendorField, 'company_id'],
          lazy: false,
        }
  )) as RawGroupRow[];

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
    const dateStr = g.__range?.[dateGroupKey]?.from;
    if (!dateStr) continue;
    const companyIdx = companyIdxById.get(g.company_id[0]);
    if (companyIdx === undefined) continue; // company disappeared between the two queries — skip rather than crash
    records.push([
      clientIdx(g.partner_id[0], g.partner_id[1]),
      dateStr.slice(0, 10),
      g.amount_total,
      vendorIdx(g[vendorField] as [number, string] | false),
      g.__count,
      companyIdx,
    ]);
  }

  return { clients, vendors, companies, records };
}

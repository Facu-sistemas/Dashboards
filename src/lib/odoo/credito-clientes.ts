import { searchRead, searchReadAll } from './client';
import { currentMonthKey, monthsBetween } from '../date';
import type { OdooDomain } from './types';

/**
 * Mirrors the "Deuda tablero credito" `ir.filters` saved filter (id 570, on
 * `account.move.line`) that this data is modeled after — confirmed live
 * that `res.partner.credit`/`total_due` already equals exactly what that
 * filter sums (verified against Roberto Picca E Hijos S.A.S., partner
 * 37474: $198.708.526,15 both ways), so we read the pre-computed field
 * instead of re-deriving it from move lines.
 */

/**
 * "Cheques de terceros" (account.third.check) a contemplar: En cartera,
 * Vendido, Entregado y Depositado — todos menos Rechazado (confirmado
 * explícitamente: es el único estado a excluir).
 */
const EXCLUDED_CHECK_STATE = 'rejected';

/** Orders still open for delivery — confirmed (state 'sale') but not fully shipped. */
const PENDING_ORDER_DOMAIN: OdooDomain = [
  ['state', '=', 'sale'],
  ['delivery_status', '!=', 'full'],
];

export interface ClienteCreditoRow {
  partnerId: number;
  partnerName: string;
  /** `res.partner.credit` — saldo abierto en cuentas de deudores por ventas (matches `total_due`). */
  totalPorCobrar: number;
  limiteCredito: number;
  /** Suma de cheques de terceros recibidos, en cualquier estado salvo Rechazado. */
  totalChequesActivos: number;
  pedidosPendientesNeto: number;
  pedidosPendientesConIva: number;
  /** chequesActivos + porCobrar + pedidosPendientes CON IVA (el neto es solo informativo). */
  totalCredito: number;
}

export interface ChequeMesPoint {
  month: string; // "YYYY-MM"
  monto: number;
}

export interface CreditoClientesTotales {
  totalPorCobrar: number;
  limiteCredito: number;
  totalChequesActivos: number;
  pedidosPendientesNeto: number;
  pedidosPendientesConIva: number;
  totalCredito: number;
}

export interface CreditoClientesData {
  clientes: ClienteCreditoRow[];
  totales: CreditoClientesTotales;
  /** Distribución mensual (mes actual en adelante) del total de cheques en cartera, por fecha de pago. */
  chequesPorMes: ChequeMesPoint[];
  /** Igual que `chequesPorMes`, pero desglosado por cliente — para el drill-down del gráfico. */
  chequesPorMesPorCliente: Record<number, ChequeMesPoint[]>;
}

interface PartnerAgg {
  chequesActivos: number;
  pedidosNeto: number;
  pedidosConIva: number;
}

export async function getCreditoClientes(): Promise<CreditoClientesData> {
  type ChequeRow = { partner_id: [number, string] | false; amount: number; payment_date: string | false };
  type PendingOrderRow = { partner_id: [number, string] | false; amount_total: number; amount_untaxed: number };
  type PartnerRow = { id: number; name: string; credit: number; credit_limit: number };

  const [cheques, pendingOrders] = await Promise.all([
    searchReadAll<ChequeRow>({
      model: 'account.third.check',
      domain: [['state', '!=', EXCLUDED_CHECK_STATE]],
      fields: ['partner_id', 'amount', 'payment_date'],
    }),
    searchReadAll<PendingOrderRow>({
      model: 'sale.order',
      domain: PENDING_ORDER_DOMAIN,
      fields: ['partner_id', 'amount_total', 'amount_untaxed'],
    }),
  ]);

  const byPartner = new Map<number, PartnerAgg>();
  function bucket(id: number): PartnerAgg {
    let a = byPartner.get(id);
    if (!a) {
      a = { chequesActivos: 0, pedidosNeto: 0, pedidosConIva: 0 };
      byPartner.set(id, a);
    }
    return a;
  }

  const monthByPartner = new Map<number, Map<string, number>>();
  const monthTotals = new Map<string, number>();
  for (const c of cheques) {
    if (!c.partner_id || !c.payment_date) continue;
    const [id] = c.partner_id;
    bucket(id).chequesActivos += c.amount;

    const month = c.payment_date.slice(0, 7);
    monthTotals.set(month, (monthTotals.get(month) ?? 0) + c.amount);
    let perClientMonths = monthByPartner.get(id);
    if (!perClientMonths) {
      perClientMonths = new Map();
      monthByPartner.set(id, perClientMonths);
    }
    perClientMonths.set(month, (perClientMonths.get(month) ?? 0) + c.amount);
  }

  for (const o of pendingOrders) {
    if (!o.partner_id) continue;
    const [id] = o.partner_id;
    const a = bucket(id);
    a.pedidosNeto += o.amount_untaxed;
    a.pedidosConIva += o.amount_total;
  }

  // Every partner with an open receivable balance, plus any partner that only
  // shows up via cheques/pedidos above (e.g. fully paid invoices but checks
  // still in wallet) — union of both sets, fetched in the fewest round trips.
  const creditPartners = await searchReadAll<PartnerRow>({
    model: 'res.partner',
    domain: [['credit', '!=', 0]],
    fields: ['id', 'name', 'credit', 'credit_limit'],
  });
  const creditPartnerIds = new Set(creditPartners.map((p) => p.id));
  const missingIds = [...byPartner.keys()].filter((id) => !creditPartnerIds.has(id));
  const extraPartners =
    missingIds.length > 0
      ? await searchRead<PartnerRow>({
          model: 'res.partner',
          domain: [['id', 'in', missingIds]],
          fields: ['id', 'name', 'credit', 'credit_limit'],
        })
      : [];

  const clientes: ClienteCreditoRow[] = [...creditPartners, ...extraPartners]
    .map((p) => {
      const a = byPartner.get(p.id) ?? { chequesActivos: 0, pedidosNeto: 0, pedidosConIva: 0 };
      return {
        partnerId: p.id,
        partnerName: p.name,
        totalPorCobrar: p.credit,
        limiteCredito: p.credit_limit,
        totalChequesActivos: a.chequesActivos,
        pedidosPendientesNeto: a.pedidosNeto,
        pedidosPendientesConIva: a.pedidosConIva,
        totalCredito: a.chequesActivos + p.credit + a.pedidosConIva,
      };
    })
    .sort((a, b) => b.totalCredito - a.totalCredito);

  const totales = clientes.reduce<CreditoClientesTotales>(
    (acc, c) => {
      acc.totalPorCobrar += c.totalPorCobrar;
      acc.limiteCredito += c.limiteCredito;
      acc.totalChequesActivos += c.totalChequesActivos;
      acc.pedidosPendientesNeto += c.pedidosPendientesNeto;
      acc.pedidosPendientesConIva += c.pedidosPendientesConIva;
      acc.totalCredito += c.totalCredito;
      return acc;
    },
    { totalPorCobrar: 0, limiteCredito: 0, totalChequesActivos: 0, pedidosPendientesNeto: 0, pedidosPendientesConIva: 0, totalCredito: 0 }
  );

  // Solo meses futuros (mes actual en adelante) — cheques con fecha de pago
  // ya vencida y aún en cartera son la excepción, no el caso a graficar.
  const currentMonth = currentMonthKey();
  const futureMonthKeys = [...monthTotals.keys()].filter((m) => m >= currentMonth).sort();
  const monthRange = futureMonthKeys.length > 0 ? monthsBetween(currentMonth, futureMonthKeys[futureMonthKeys.length - 1]!) : [];
  const chequesPorMes: ChequeMesPoint[] = monthRange.map((month) => ({ month, monto: monthTotals.get(month) ?? 0 }));

  const chequesPorMesPorCliente: Record<number, ChequeMesPoint[]> = {};
  for (const [partnerId, months] of monthByPartner) {
    chequesPorMesPorCliente[partnerId] = monthRange.map((month) => ({ month, monto: months.get(month) ?? 0 })).filter((p) => p.monto !== 0);
  }

  return { clientes, totales, chequesPorMes, chequesPorMesPorCliente };
}

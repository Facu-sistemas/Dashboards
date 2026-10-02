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
 * explícitamente: es el único estado a excluir). Además, solo con fecha de
 * pago de hoy en adelante — no el historial completo (confirmado: contarlos
 * todos infló "Cheques Activos" con cheques ya vencidos hace tiempo).
 */
const EXCLUDED_CHECK_STATE = 'rejected';

/** Orders still open for delivery — confirmed (state 'sale') but not fully shipped. */
const PENDING_ORDER_DOMAIN: OdooDomain = [
  ['state', '=', 'sale'],
  ['delivery_status', '!=', 'full'],
];

/**
 * `res.partner` de Frontera Living S.A (id 1) y Presupuesto (id 7) —
 * empresas propias del grupo, no clientes reales, así que no deben
 * aparecer en el resumen (confirmado explícitamente).
 */
const EXCLUDED_PARTNER_IDS = [1, 7];

/**
 * `res.company` id 2 = "Presupuesto". Cada línea de pedido tiene su propio
 * `company_invoice_id` ("Facturar en empresa") — confirmado en vivo contra
 * S17465 (AIMAR CARLOS NAHUEL): sus 2 líneas tienen company_invoice_id =
 * Presupuesto, price_total $300.000/$90.000 y untaxed_amount_invoiced
 * $270.000/$0 → (300.000-270.000) + (90.000-0) = $120.000 exacto, el
 * número confirmado por el usuario. Vacío/false se trata como Frontera
 * Living (confirmado explícitamente: "vacío -> lo toma como Frontera
 * Living").
 *
 * Para las líneas de Frontera Living (factura real) NO se usa `price_total`
 * directo — eso suma el total de la línea completa incluso cuando ya está
 * parcialmente facturada, e infla el número (confirmado: daba
 * $621.921.383,07 para Roberto Picca, cliente 100% factura). La cuenta
 * correcta es lo que falta facturar en neto (`price_subtotal -
 * untaxed_amount_invoiced`) multiplicado por 1.21 para agregarle el IVA
 * real que sí corresponde en una factura — confirmado con Picca dando
 * $93.684.442,32.
 */
const PRESUPUESTO_COMPANY_ID = 2;
const IVA_MULTIPLIER = 1.21;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface ClienteCreditoRow {
  partnerId: number;
  partnerName: string;
  /** `res.partner.credit` — saldo abierto en cuentas de deudores por ventas (matches `total_due`). */
  totalPorCobrar: number;
  limiteCredito: number;
  /** Suma de cheques de terceros recibidos, en cualquier estado salvo Rechazado. */
  totalChequesActivos: number;
  /**
   * Suma por línea de pedido pendiente: línea facturable por Frontera
   * Living (o sin empresa asignada) → `(price_subtotal -
   * untaxed_amount_invoiced) * 1.21` (lo que falta facturar, con IVA);
   * línea facturable por Presupuesto → `price_total -
   * untaxed_amount_invoiced` (lo que falta facturar, sin agregar IVA).
   */
  pedidosPendientes: number;
  /** Parte de `pedidosPendientes` que viene de líneas facturables por Presupuesto (vs. factura real de Frontera Living) — para marcarlo visualmente en la tabla. */
  pedidosPendientesPresupuesto: number;
  /** chequesActivos + porCobrar + pedidosPendientes. */
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
  pedidosPendientes: number;
  totalCredito: number;
}

export interface CreditoClientesData {
  clientes: ClienteCreditoRow[];
  totales: CreditoClientesTotales;
  /** Distribución mensual (mes actual en adelante) del total de cheques en cartera, por fecha de pago. */
  chequesPorMes: ChequeMesPoint[];
  /** Igual que `chequesPorMes`, pero desglosado por cliente — para el drill-down del gráfico. */
  chequesPorMesPorCliente: Record<number, ChequeMesPoint[]>;
  /** "YYYY-MM-DD" del día en que se calculó esto — los cheques solo cuentan desde esta fecha en adelante. */
  asOf: string;
}

interface PartnerAgg {
  chequesActivos: number;
  pedidosPendientes: number;
  pedidosPendientesPresupuesto: number;
}

export async function getCreditoClientes(): Promise<CreditoClientesData> {
  type ChequeRow = { partner_id: [number, string] | false; amount: number; payment_date: string | false };
  type PendingOrderRow = { id: number; partner_id: [number, string] | false };
  type OrderLineRow = {
    order_id: [number, string];
    company_invoice_id: [number, string] | false;
    price_total: number;
    price_subtotal: number;
    untaxed_amount_invoiced: number;
  };
  type PartnerRow = { id: number; name: string; credit: number; credit_limit: number };

  const today = todayIso();

  const [cheques, pendingOrders] = await Promise.all([
    searchReadAll<ChequeRow>({
      model: 'account.third.check',
      domain: [
        ['state', '!=', EXCLUDED_CHECK_STATE],
        ['payment_date', '>=', today],
        ['partner_id', 'not in', EXCLUDED_PARTNER_IDS],
      ],
      fields: ['partner_id', 'amount', 'payment_date'],
    }),
    searchReadAll<PendingOrderRow>({
      model: 'sale.order',
      domain: [...PENDING_ORDER_DOMAIN, ['partner_id', 'not in', EXCLUDED_PARTNER_IDS]],
      fields: ['id', 'partner_id'],
    }),
  ]);

  const partnerIdByOrderId = new Map<number, number>();
  for (const o of pendingOrders) {
    if (o.partner_id) partnerIdByOrderId.set(o.id, o.partner_id[0]);
  }

  const orderLines =
    partnerIdByOrderId.size > 0
      ? await searchReadAll<OrderLineRow>({
          model: 'sale.order.line',
          domain: [['order_id', 'in', [...partnerIdByOrderId.keys()]]],
          fields: ['order_id', 'company_invoice_id', 'price_total', 'price_subtotal', 'untaxed_amount_invoiced'],
        })
      : [];

  const byPartner = new Map<number, PartnerAgg>();
  function bucket(id: number): PartnerAgg {
    let a = byPartner.get(id);
    if (!a) {
      a = { chequesActivos: 0, pedidosPendientes: 0, pedidosPendientesPresupuesto: 0 };
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

  for (const line of orderLines) {
    const partnerId = partnerIdByOrderId.get(line.order_id[0]);
    if (partnerId === undefined) continue;
    const esPresupuesto = line.company_invoice_id !== false && line.company_invoice_id[0] === PRESUPUESTO_COMPANY_ID;
    const contribucion = esPresupuesto
      ? line.price_total - line.untaxed_amount_invoiced
      : (line.price_subtotal - line.untaxed_amount_invoiced) * IVA_MULTIPLIER;
    const a = bucket(partnerId);
    a.pedidosPendientes += contribucion;
    if (esPresupuesto) a.pedidosPendientesPresupuesto += contribucion;
  }

  // Every partner with an open receivable balance, plus any partner that only
  // shows up via cheques/pedidos above (e.g. fully paid invoices but checks
  // still in wallet) — union of both sets, fetched in the fewest round trips.
  const creditPartners = await searchReadAll<PartnerRow>({
    model: 'res.partner',
    domain: [
      ['credit', '!=', 0],
      ['id', 'not in', EXCLUDED_PARTNER_IDS],
    ],
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
    // Un puñado de partner_id referenciados en cheques/pedidos vienen sin
    // `name` (registros fusionados/archivados en Odoo) — no son clientes
    // reportables, se descartan.
    .filter((p) => p.name)
    .map((p) => {
      const a = byPartner.get(p.id) ?? { chequesActivos: 0, pedidosPendientes: 0, pedidosPendientesPresupuesto: 0 };
      return {
        partnerId: p.id,
        partnerName: p.name,
        totalPorCobrar: p.credit,
        limiteCredito: p.credit_limit,
        totalChequesActivos: a.chequesActivos,
        pedidosPendientes: a.pedidosPendientes,
        pedidosPendientesPresupuesto: a.pedidosPendientesPresupuesto,
        totalCredito: a.chequesActivos + p.credit + a.pedidosPendientes,
      };
    })
    .sort((a, b) => b.totalCredito - a.totalCredito);

  const totales = clientes.reduce<CreditoClientesTotales>(
    (acc, c) => {
      acc.totalPorCobrar += c.totalPorCobrar;
      acc.limiteCredito += c.limiteCredito;
      acc.totalChequesActivos += c.totalChequesActivos;
      acc.pedidosPendientes += c.pedidosPendientes;
      acc.totalCredito += c.totalCredito;
      return acc;
    },
    { totalPorCobrar: 0, limiteCredito: 0, totalChequesActivos: 0, pedidosPendientes: 0, totalCredito: 0 }
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

  return { clientes, totales, chequesPorMes, chequesPorMesPorCliente, asOf: today };
}

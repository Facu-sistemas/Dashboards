import { readGroup, searchRead } from './client';
import { getFronteraCompany } from './reference';
import { lastMonthKeys, monthBounds, addDaysIso } from '../date';
import { getArgentinaTodayIso } from './oee';
import type { OdooDomain, OdooReadGroupResult } from './types';

/** '30d' = ventana exacta de los últimos 30 días (no alineada a mes) — default, agregada además de las opciones de mes que ya existían. '3m'/'6m'/'9m' siguen alineadas a mes, como antes. */
export type ClientesActivosPeriodo = '30d' | '3m' | '6m' | '9m';

function desdeFecha(periodo: ClientesActivosPeriodo): string {
  if (periodo === '30d') return addDaysIso(getArgentinaTodayIso(), -30);
  const meses = periodo === '3m' ? 3 : periodo === '6m' ? 6 : 9;
  return monthBounds(lastMonthKeys(meses)[0]!).start;
}

/**
 * Notas de crédito que no son una devolución real, identificadas por el
 * nombre del producto de la línea — no deben contarse en
 * `creditNoteCount`/`creditNoteAmount` (inflarían la alerta de
 * "devoluciones" con algo que no es tal), pero siguen apareciendo en el
 * detalle de `getNotasCreditoCliente` con su categoría marcada, para
 * poder verlas a simple vista en vez de ocultarlas.
 *
 * - "N/C ACUERDO COMERCIAL COLCHONE"/"...SILLONES": acuerdo comercial
 *   pagado por fuera (en efectivo) — confirmado en vivo con el cliente
 *   el 2026-09-20.
 * - "NOTA DE CREDITO POR DESCUENTO": descuento comercial, no devolución.
 * - "PUBLICIDAD Y PROPAGANDA": nota de crédito por publicidad, no
 *   devolución — confirmado en vivo con el cliente el 2026-09-21.
 */
export type NotaCreditoCategoria = 'acuerdo_comercial' | 'descuento' | 'publicidad' | null;

const IGNORED_PATTERNS: { categoria: Exclude<NotaCreditoCategoria, null>; pattern: string }[] = [
  { categoria: 'acuerdo_comercial', pattern: 'ACUERDO COMERCIAL' },
  { categoria: 'descuento', pattern: 'NOTA DE CREDITO POR DESCUENTO' },
  { categoria: 'publicidad', pattern: 'PUBLICIDAD Y PROPAGANDA' },
];

function categoriaDeProductos(productos: string[]): NotaCreditoCategoria {
  const upper = productos.map((p) => p.toUpperCase());
  for (const { categoria, pattern } of IGNORED_PATTERNS) {
    if (upper.some((p) => p.includes(pattern))) return categoria;
  }
  return null;
}

/** Odoo domain OR: N condiciones necesitan (N-1) operadores '|' en notación prefija antes de ellas. */
function orDomain(conditions: OdooDomain): OdooDomain {
  if (conditions.length <= 1) return conditions;
  return [...new Array(conditions.length - 1).fill('|' as const), ...conditions];
}

async function getIgnoredCreditNoteMoveIds(companyId: number, desde: string): Promise<number[]> {
  const domain: OdooDomain = [
    ['move_type', '=', 'out_refund'],
    ['state', '=', 'posted'],
    ['company_id', '=', companyId],
    ['invoice_date', '>=', desde],
    ...orDomain(IGNORED_PATTERNS.map(({ pattern }) => ['invoice_line_ids.product_id.name', 'ilike', pattern])),
  ];
  const rows = await searchRead<{ id: number }>({
    model: 'account.move',
    domain,
    fields: ['id'],
  });
  return rows.map((r) => r.id);
}

export interface ClienteActivoRow {
  partnerId: number;
  partnerName: string;
  invoiceCount: number;
  amount: number;
  /** Notas de crédito (account.move, move_type 'out_refund', posted) del mismo cliente en el período — devoluciones/reembolsos, no se restan de invoiceCount ni amount, se muestran como alerta aparte. */
  creditNoteCount: number;
  creditNoteAmount: number;
}

export interface ClientesActivosResult {
  periodo: ClientesActivosPeriodo;
  desde: string;
  /** Siempre "hoy" (no hay tope superior en el filtro) — calculado en el servidor, no en el navegador, para no arriesgar un mismatch de hidratación por zona horaria. */
  hasta: string;
  rows: ClienteActivoRow[];
}

/**
 * Un cliente se considera "activo" si tuvo al menos una factura de cliente
 * posteada (account.move, move_type 'out_invoice', state 'posted') dentro
 * del `periodo` elegido (últimos 30 días exactos, o 6/9 meses alineados a
 * mes) — misma noción de "facturación" que pareto-clients.ts, scopeada a
 * Frontera Living S.A. (no a "Presupuesto").
 *
 * `rows` viene ordenado por cantidad de facturas descendente — el Top 10
 * se obtiene simplemente tomando los primeros 10 en el cliente.
 */
export async function getClientesActivos(periodo: ClientesActivosPeriodo, incluirTodasNC: boolean = false): Promise<ClientesActivosResult> {
  const { companyId } = await getFronteraCompany();
  const desde = desdeFecha(periodo);

  const domain: OdooDomain = [
    ['move_type', '=', 'out_invoice'],
    ['state', '=', 'posted'],
    ['company_id', '=', companyId],
    ['invoice_date', '>=', desde],
  ];

  type GroupRow = OdooReadGroupResult & { partner_id: [number, string] | false; amount_total: number };
  const [invoiceGroups, ignoredIds] = await Promise.all([
    readGroup({
      model: 'account.move',
      domain,
      fields: ['amount_total'],
      groupBy: ['partner_id'],
    }) as Promise<GroupRow[]>,
    incluirTodasNC ? Promise.resolve([]) : getIgnoredCreditNoteMoveIds(companyId, desde),
  ]);

  const creditNoteDomain: OdooDomain = [
    ['move_type', '=', 'out_refund'],
    ['state', '=', 'posted'],
    ['company_id', '=', companyId],
    ['invoice_date', '>=', desde],
  ];
  if (ignoredIds.length > 0) {
    creditNoteDomain.push(['id', 'not in', ignoredIds]);
  }
  const creditNoteGroups = (await readGroup({
    model: 'account.move',
    domain: creditNoteDomain,
    fields: ['amount_total'],
    groupBy: ['partner_id'],
  })) as GroupRow[];

  const creditNotesByPartner = new Map<number, { count: number; amount: number }>();
  for (const g of creditNoteGroups) {
    if (!g.partner_id) continue;
    creditNotesByPartner.set(g.partner_id[0], { count: g.__count, amount: g.amount_total });
  }

  const rows: ClienteActivoRow[] = invoiceGroups
    .filter((g): g is GroupRow & { partner_id: [number, string] } => Boolean(g.partner_id))
    .map((g) => {
      const creditNote = creditNotesByPartner.get(g.partner_id[0]);
      return {
        partnerId: g.partner_id[0],
        partnerName: g.partner_id[1],
        invoiceCount: g.__count,
        amount: g.amount_total,
        creditNoteCount: creditNote?.count ?? 0,
        creditNoteAmount: creditNote?.amount ?? 0,
      };
    })
    .sort((a, b) => b.invoiceCount - a.invoiceCount);

  return { periodo, desde, hasta: getArgentinaTodayIso(), rows };
}

export interface NotaCreditoRow {
  id: number;
  name: string;
  invoiceDate: string; // YYYY-MM-DD
  amount: number;
  /** Texto libre cargado a mano al crear la NC ("Reversión de: <factura origen>, <motivo>") — false cuando nadie lo completó. */
  motivo: string | null;
  /** "<producto> x<cantidad>" por cada línea con producto — vacío si la NC no referencia ningún producto puntual. */
  productos: string[];
  /** No-null cuando esta NC es una de las categorías "no es una devolución real" — ver IGNORED_PATTERNS arriba. */
  categoria: NotaCreditoCategoria;
}

/** Detalle de las notas de crédito (una por una) de un cliente puntual en el período — para el desplegable de la tabla, cargado bajo demanda al expandir una fila. */
export async function getNotasCreditoCliente(
  partnerId: number,
  periodo: ClientesActivosPeriodo
): Promise<NotaCreditoRow[]> {
  const { companyId } = await getFronteraCompany();
  const desde = desdeFecha(periodo);

  type MoveRow = { id: number; name: string; invoice_date: string; amount_total: number; ref: string | false };
  const moves = await searchRead<MoveRow>({
    model: 'account.move',
    domain: [
      ['move_type', '=', 'out_refund'],
      ['state', '=', 'posted'],
      ['company_id', '=', companyId],
      ['partner_id', '=', partnerId],
      ['invoice_date', '>=', desde],
    ],
    fields: ['name', 'invoice_date', 'amount_total', 'ref'],
    order: 'invoice_date desc',
  });

  if (moves.length === 0) return [];

  type LineRow = { move_id: [number, string]; product_id: [number, string]; quantity: number };
  const lines = await searchRead<LineRow>({
    model: 'account.move.line',
    domain: [
      ['move_id', 'in', moves.map((m) => m.id)],
      ['product_id', '!=', false],
    ],
    fields: ['move_id', 'product_id', 'quantity'],
  });

  const productosByMove = new Map<number, string[]>();
  for (const l of lines) {
    const moveId = l.move_id[0];
    const list = productosByMove.get(moveId) ?? [];
    list.push(`${l.product_id[1]} x${l.quantity}`);
    productosByMove.set(moveId, list);
  }

  return moves.map((m) => {
    const productos = productosByMove.get(m.id) ?? [];
    return {
      id: m.id,
      name: m.name,
      invoiceDate: m.invoice_date,
      amount: m.amount_total,
      motivo: m.ref || null,
      productos,
      categoria: categoriaDeProductos(productos),
    };
  });
}

const ULTIMAS_VENTAS_LIMIT = 10;

export interface UltimaVentaRow {
  partnerId: number;
  partnerName: string;
  amount: number;
  invoiceDate: string; // YYYY-MM-DD
  /** Hora local (America/Argentina/Buenos_Aires, UTC-3 fijo) en la que se posteó la factura ("HH:MM") — calculada acá, no en el navegador, para no depender de la zona horaria del cliente. */
  horaConfirmacion: string;
}

/** Odoo guarda `write_date` en UTC — Argentina es UTC-3 todo el año (sin horario de verano), así que restar 3 horas alcanza sin tocar Date/Intl del lado del navegador. */
function writeDateToHoraArgentina(writeDate: string): string {
  const [, timePart] = writeDate.split(' ');
  const [hh, mm] = (timePart ?? '00:00:00').split(':').map(Number);
  const totalMinutes = (((hh! * 60 + mm! - 180) % 1440) + 1440) % 1440;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Las últimas facturas de cliente posteadas, sin importar el período elegido
 * en el resto del tab — "pulso en vivo" del negocio para el carrusel, no
 * una agregación. Independiente de `getClientesActivos`.
 */
export async function getUltimasVentas(): Promise<UltimaVentaRow[]> {
  const { companyId } = await getFronteraCompany();

  type Row = {
    partner_id: [number, string] | false;
    amount_total: number;
    invoice_date: string;
    write_date: string;
  };
  const rows = await searchRead<Row>({
    model: 'account.move',
    domain: [
      ['move_type', '=', 'out_invoice'],
      ['state', '=', 'posted'],
      ['company_id', '=', companyId],
    ],
    fields: ['partner_id', 'amount_total', 'invoice_date', 'write_date'],
    order: 'invoice_date desc, id desc',
    limit: ULTIMAS_VENTAS_LIMIT,
  });

  return rows
    .filter((r): r is Row & { partner_id: [number, string] } => Boolean(r.partner_id))
    .map((r) => ({
      partnerId: r.partner_id[0],
      partnerName: r.partner_id[1],
      amount: r.amount_total,
      invoiceDate: r.invoice_date,
      horaConfirmacion: writeDateToHoraArgentina(r.write_date),
    }));
}

const TENDENCIA_MENSUAL_MESES = 6;

export interface TendenciaMensualRow {
  month: string; // YYYY-MM
  clientesActivos: number;
  facturas: number;
  facturado: number;
  notasCreditoMonto: number;
}

type MonthGroupRow = OdooReadGroupResult & {
  partner_id: [number, string] | false;
  amount_total: number;
  __range?: Record<string, { from: string | false; to: string | false }>;
};

/**
 * Evolución mes a mes de los últimos `TENDENCIA_MENSUAL_MESES` meses
 * calendario completos (independiente del `periodo` elegido en el resto
 * del tab, que puede ser una ventana corta como "30 días") — para ver la
 * tendencia, no un corte puntual. `notasCreditoMonto` ya excluye las
 * categorías que no son devolución real (ver IGNORED_PATTERNS).
 */
export async function getTendenciaMensual(incluirTodasNC: boolean = false): Promise<TendenciaMensualRow[]> {
  const { companyId } = await getFronteraCompany();
  const months = lastMonthKeys(TENDENCIA_MENSUAL_MESES);
  const rangeStart = monthBounds(months[0]!).start;

  const [invoiceGroups, ignoredIds] = await Promise.all([
    readGroup({
      model: 'account.move',
      domain: [
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
        ['company_id', '=', companyId],
        ['invoice_date', '>=', rangeStart],
      ],
      fields: ['amount_total'],
      groupBy: ['partner_id', 'invoice_date:month'],
      lazy: false,
    }) as Promise<MonthGroupRow[]>,
    incluirTodasNC ? Promise.resolve([]) : getIgnoredCreditNoteMoveIds(companyId, rangeStart),
  ]);

  const creditNoteDomain: OdooDomain = [
    ['move_type', '=', 'out_refund'],
    ['state', '=', 'posted'],
    ['company_id', '=', companyId],
    ['invoice_date', '>=', rangeStart],
  ];
  if (ignoredIds.length > 0) creditNoteDomain.push(['id', 'not in', ignoredIds]);

  const creditNoteGroups = (await readGroup({
    model: 'account.move',
    domain: creditNoteDomain,
    fields: ['amount_total'],
    groupBy: ['invoice_date:month'],
    lazy: false,
  })) as MonthGroupRow[];

  const byMonth = new Map<string, { partners: Set<number>; facturas: number; facturado: number }>();
  for (const g of invoiceGroups) {
    const monthFrom = g.__range?.['invoice_date:month']?.from;
    if (!monthFrom) continue;
    const month = monthFrom.slice(0, 7);
    const bucket = byMonth.get(month) ?? { partners: new Set<number>(), facturas: 0, facturado: 0 };
    if (g.partner_id) bucket.partners.add(g.partner_id[0]);
    bucket.facturas += g.__count;
    bucket.facturado += g.amount_total;
    byMonth.set(month, bucket);
  }

  const creditNoteByMonth = new Map<string, number>();
  for (const g of creditNoteGroups) {
    const monthFrom = g.__range?.['invoice_date:month']?.from;
    if (!monthFrom) continue;
    creditNoteByMonth.set(monthFrom.slice(0, 7), g.amount_total);
  }

  return months.map((month) => {
    const b = byMonth.get(month);
    return {
      month,
      clientesActivos: b?.partners.size ?? 0,
      facturas: b?.facturas ?? 0,
      facturado: b?.facturado ?? 0,
      notasCreditoMonto: creditNoteByMonth.get(month) ?? 0,
    };
  });
}

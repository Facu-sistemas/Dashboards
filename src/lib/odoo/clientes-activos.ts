import { readGroup, searchRead } from './client';
import { getFronteraCompany } from './reference';
import { lastMonthKeys, monthBounds, addDaysIso } from '../date';
import { getArgentinaTodayIso } from './oee';
import type { OdooDomain, OdooReadGroupResult } from './types';

/** '30d' = ventana exacta de los últimos 30 días (no alineada a mes) — default. '6m'/'9m' siguen alineados a mes, como antes. */
export type ClientesActivosPeriodo = '30d' | '6m' | '9m';

function desdeFecha(periodo: ClientesActivosPeriodo): string {
  if (periodo === '30d') return addDaysIso(getArgentinaTodayIso(), -30);
  const meses = periodo === '6m' ? 6 : 9;
  return monthBounds(lastMonthKeys(meses)[0]!).start;
}

/**
 * "N/C ACUERDO COMERCIAL COLCHONE" / "... SILLONES" — notas de crédito que
 * no son una devolución real sino un acuerdo comercial pagado por fuera
 * (en efectivo), confirmado en vivo con el cliente el 2026-09-20. No deben
 * contarse en `creditNoteCount`/`creditNoteAmount` (inflarían la alerta de
 * "devoluciones" con algo que no es tal), pero siguen apareciendo en el
 * detalle de `getNotasCreditoCliente` — ahí el front las resalta en vez de
 * ocultarlas, para que se puedan ver a simple vista.
 */
async function getAcuerdoComercialMoveIds(companyId: number, desde: string): Promise<number[]> {
  const rows = await searchRead<{ id: number }>({
    model: 'account.move',
    domain: [
      ['move_type', '=', 'out_refund'],
      ['state', '=', 'posted'],
      ['company_id', '=', companyId],
      ['invoice_date', '>=', desde],
      ['invoice_line_ids.product_id.name', 'ilike', 'ACUERDO COMERCIAL'],
    ],
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
export async function getClientesActivos(periodo: ClientesActivosPeriodo): Promise<ClientesActivosResult> {
  const { companyId } = await getFronteraCompany();
  const desde = desdeFecha(periodo);

  const domain: OdooDomain = [
    ['move_type', '=', 'out_invoice'],
    ['state', '=', 'posted'],
    ['company_id', '=', companyId],
    ['invoice_date', '>=', desde],
  ];

  type GroupRow = OdooReadGroupResult & { partner_id: [number, string] | false; amount_total: number };
  const [invoiceGroups, acuerdoComercialIds] = await Promise.all([
    readGroup({
      model: 'account.move',
      domain,
      fields: ['amount_total'],
      groupBy: ['partner_id'],
    }) as Promise<GroupRow[]>,
    getAcuerdoComercialMoveIds(companyId, desde),
  ]);

  const creditNoteDomain: OdooDomain = [
    ['move_type', '=', 'out_refund'],
    ['state', '=', 'posted'],
    ['company_id', '=', companyId],
    ['invoice_date', '>=', desde],
  ];
  if (acuerdoComercialIds.length > 0) {
    creditNoteDomain.push(['id', 'not in', acuerdoComercialIds]);
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

  return { periodo, desde, rows };
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

  return moves.map((m) => ({
    id: m.id,
    name: m.name,
    invoiceDate: m.invoice_date,
    amount: m.amount_total,
    motivo: m.ref || null,
    productos: productosByMove.get(m.id) ?? [],
  }));
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

import { searchRead, searchReadAll } from './client';
import { getPartners, normalizarProvincia } from './mapa-destinos';
import { fetchNotasDevolucionColchon, type Causa } from './notas-credito-devolucion';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS } from './oee';
import { getArgentinaTodayIso } from './oee';
import { lastMonthKeys, monthBounds } from '../date';

export type SectorDevolucion = 'living' | 'colchon';

export type { Causa };

export interface EmpresaOption {
  id: number;
  name: string;
}

/**
 * Un caso = una orden de reparación (Living y reparaciones de Colchón) o una
 * nota de crédito de devolución (Colchón), ya ubicado en mes, sector,
 * empresa y provincia, con lo que Odoo sabe de su costo. Lo que depende de
 * las tarifas (flete y mano de obra) se calcula en el front.
 */
export interface DevolucionRegistro {
  ref: string;
  origen: 'reparacion' | 'nota-credito' | 'ticket';
  /** Ticket de soporte de la reparación, si lo tiene. */
  ticket: string | null;
  /** Mes de apertura (fecha de creación de la orden / ticket / nota): es el que ordena el resumen mensual. */
  mes: string; // "YYYY-MM"
  /** Fecha de apertura "YYYY-MM-DD". */
  abierto: string;
  /** Fecha de cierre del ticket "YYYY-MM-DD", o null si sigue abierto o no aplica. */
  cerrado: string | null;
  sector: SectorDevolucion;
  empresa: number;
  cliente: string;
  provincia: string;
  producto: string;
  causa: Causa;
  /** Motivo tal como está en Odoo, para mostrarlo ("Calidad / Garantía real"). */
  motivo: string;
  /** true = cuenta como devolución del índice (Living: orden de reparación; Colchón: nota de crédito). Las reparaciones de Colchón no cuentan, pero sus horas sí cuestan. */
  cuenta: boolean;
  horas: number;
  /** Todavía no se terminó de reparar (o ni empezó): las horas aún pueden cargarse. */
  enCurso: boolean;
  /** Plata de materia/producto que no se pudo recuperar ($): costo del producto − lo recuperado (Living) o costo del colchón devuelto. */
  material: number;
  /** Lo que se le facturó a otro por este caso ($, sin IVA): al transportista o al cliente (post-venta). */
  facturado: number;
  /** Tiene una venta/factura vinculada (para saber si falta vincularla). */
  vinculado: boolean;
  /** Monto ($) de la nota de crédito (solo Colchón). */
  notaCredito: number;
  /** Recargo de flete de la región del cliente, en % (ej. 5 = 5%). null si el cliente no tiene región. */
  recargoPct: number | null;
  /** Valor sobre el que se aplica el recargo para estimar el flete cuando no hay tarifa ($). */
  baseFlete: number;
}

export interface ProduccionRegistro {
  mes: string;
  sector: SectorDevolucion;
  empresa: number;
  unidades: number;
}

export interface CostoDevolucionesData {
  /** Últimos 12 meses, el más reciente primero. */
  meses: string[];
  mesActual: string;
  empresas: EmpresaOption[];
  registros: DevolucionRegistro[];
  produccion: ProduccionRegistro[];
}

const MESES_VENTANA = 12;

interface RepairRow extends Record<string, unknown> {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  company_id: [number, string] | false;
  create_date: string;
  product_id: [number, string] | false;
  product_qty: number;
  state: string;
  ticket_id: [number, string] | false;
  sale_order_id: [number, string] | false;
  x_studio_horas_de_reparacion: number;
  x_studio_total_recuperado: number;
}

interface TicketRow extends Record<string, unknown> {
  id: number;
  name: string;
  x_studio_motivo: string | false;
  sale_order_id: [number, string] | false;
  close_date: string | false;
}

interface TicketSinOrdenRow extends TicketRow {
  create_date: string;
  partner_id: [number, string] | false;
  company_id: [number, string] | false;
  product_id: [number, string] | false;
}

interface ProductRow extends Record<string, unknown> {
  id: number;
  standard_price: number;
  categ_id: [number, string] | false;
}

interface ProductionRow extends Record<string, unknown> {
  company_id: [number, string] | false;
  date_finished: string;
  qty_produced: number;
}

function fetchRepairs(categIds: number[], desde: string): Promise<RepairRow[]> {
  return searchReadAll<RepairRow>({
    model: 'repair.order',
    // Cuenta desde que se confirma, no recién al terminar: un ticket cargado hoy ya es un caso de este mes.
    domain: [
      ['state', 'in', ['confirmed', 'under_repair', 'done']],
      ['product_id.categ_id', 'in', categIds],
      ['create_date', '>=', `${desde} 00:00:00`],
    ],
    fields: [
      'name',
      'partner_id',
      'company_id',
      'create_date',
      'product_id',
      'product_qty',
      'state',
      'ticket_id',
      'sale_order_id',
      'x_studio_horas_de_reparacion',
      'x_studio_total_recuperado',
    ],
  });
}

function fetchProduction(categIds: number[], desde: string): Promise<ProductionRow[]> {
  return searchReadAll<ProductionRow>({
    model: 'mrp.production',
    domain: [
      ['state', '=', 'done'],
      ['product_id.categ_id', 'in', categIds],
      ['date_finished', '>=', `${desde} 00:00:00`],
    ],
    fields: ['company_id', 'date_finished', 'qty_produced'],
  });
}

const CAUSA_TICKET: Record<string, Causa> = {
  Calidad: 'calidad',
  Transporte: 'transporte',
  'Post-Venta': 'postventa',
  // "Devolución" no dice por qué volvió: queda sin clasificar hasta que se cargue la causa real.
  Devolución: 'sinmotivo',
};

/** "CORDOBA - 5%" → 5 · "COSTA BS AS - 12,5%" → 12.5 · sin % → null. */
function parseRecargoPct(regionName: string | undefined): number | null {
  if (!regionName) return null;
  const m = regionName.match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? Number(m[1]!.replace(',', '.')) : null;
}

async function getRegiones(partnerIds: number[]): Promise<Map<number, string>> {
  const unicos = [...new Set(partnerIds)];
  const out = new Map<number, string>();
  const CHUNK = 1000;
  for (let i = 0; i < unicos.length; i += CHUNK) {
    const rows = await searchReadAll<{ id: number; region_id: [number, string] | false }>({
      model: 'res.partner',
      domain: [['id', 'in', unicos.slice(i, i + CHUNK)]],
      fields: ['region_id'],
      context: { active_test: false },
    });
    for (const r of rows) if (r.region_id) out.set(r.id, r.region_id[1]);
  }
  return out;
}

async function getProductos(ids: number[]): Promise<Map<number, ProductRow>> {
  const unicos = [...new Set(ids)];
  const out = new Map<number, ProductRow>();
  const CHUNK = 1000;
  for (let i = 0; i < unicos.length; i += CHUNK) {
    const rows = await searchReadAll<ProductRow>({
      model: 'product.product',
      domain: [['id', 'in', unicos.slice(i, i + CHUNK)]],
      fields: ['standard_price', 'categ_id'],
      context: { active_test: false },
    });
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

/**
 * Casos de no calidad × mes × sector × empresa × provincia del cliente, con
 * su causa. Misma definición de "devolución" que la pestaña Reparaciones
 * (Living = órdenes de reparación, Colchón = notas de crédito de devolución)
 * para que el índice "cada 1.000" coincida.
 *
 * Qué trae Odoo de cada costo:
 *  - Mano de obra: horas de la orden de reparación (se valorizan en el front).
 *  - Material: costo del producto − lo recuperado de la orden (Living); costo
 *    de las unidades de la nota de crédito (Colchón).
 *  - Facturado: importe de la venta vinculada al ticket (al transportista en
 *    Transporte, al cliente en Post-venta).
 *  - Flete: se calcula en el front con la tarifa por provincia; si no hay,
 *    se estima con el % de recargo de la región del cliente.
 */
export async function getCostoDevolucionesData(): Promise<CostoDevolucionesData> {
  const mesActual = getArgentinaTodayIso().slice(0, 7);
  const mesesAsc = lastMonthKeys(MESES_VENTANA);
  const desde = monthBounds(mesesAsc[0]!).start;

  const [empresas, livingRepairs, colchonRepairs, notasCredito, livingProd, colchonProd] = await Promise.all([
    searchRead<{ id: number; name: string }>({ model: 'res.company', fields: ['name'], order: 'id asc' }),
    fetchRepairs(LIVING_CATEG_IDS, desde),
    fetchRepairs(COLCHONES_CATEG_IDS, desde),
    fetchNotasDevolucionColchon(desde),
    fetchProduction(LIVING_CATEG_IDS, desde),
    fetchProduction(COLCHONES_CATEG_IDS, desde),
  ]);

  // Tickets de las reparaciones (motivo y venta vinculada).
  const ticketIds = [...livingRepairs, ...colchonRepairs].flatMap((r) => (r.ticket_id ? [r.ticket_id[0]] : []));
  const tickets = new Map<number, TicketRow>();
  if (ticketIds.length > 0) {
    const rows = await searchReadAll<TicketRow>({
      model: 'helpdesk.ticket',
      domain: [['id', 'in', [...new Set(ticketIds)]]],
      fields: ['name', 'x_studio_motivo', 'sale_order_id', 'close_date'],
      context: { active_test: false },
    });
    for (const t of rows) tickets.set(t.id, t);
  }

  // Tickets de Living con motivo cargado que todavía no tienen orden de reparación: ya son un caso aunque no se haya empezado a reparar.
  const ticketsSinOrden = await searchReadAll<TicketSinOrdenRow>({
    model: 'helpdesk.ticket',
    domain: [
      ['create_date', '>=', `${desde} 00:00:00`],
      ['repair_ids', '=', false],
      ['x_studio_motivo', '!=', false],
      ['stage_id.name', '!=', 'Canceled'],
      ['ticket_type_id.name', '!=', 'Colchones'],
    ],
    fields: ['name', 'x_studio_motivo', 'sale_order_id', 'close_date', 'create_date', 'partner_id', 'company_id', 'product_id'],
  });

  // Importe de las ventas vinculadas (lo que se le facturó al transportista / cliente).
  const soIds = [
    ...[...tickets.values()].flatMap((t) => (t.sale_order_id ? [t.sale_order_id[0]] : [])),
    ...[...livingRepairs, ...colchonRepairs].flatMap((r) => (r.sale_order_id ? [r.sale_order_id[0]] : [])),
    ...ticketsSinOrden.flatMap((t) => (t.sale_order_id ? [t.sale_order_id[0]] : [])),
  ];
  const ventas = new Map<number, number>();
  if (soIds.length > 0) {
    const rows = await searchReadAll<{ id: number; amount_untaxed: number }>({
      model: 'sale.order',
      domain: [['id', 'in', [...new Set(soIds)]]],
      fields: ['amount_untaxed'],
      context: { active_test: false },
    });
    for (const s of rows) ventas.set(s.id, s.amount_untaxed);
  }

  const productos = await getProductos(
    [...livingRepairs, ...colchonRepairs].flatMap((r) => (r.product_id ? [r.product_id[0]] : []))
  );

  const partnerIds = [
    ...[...livingRepairs, ...colchonRepairs].flatMap((r) => (r.partner_id ? [r.partner_id[0]] : [])),
    ...ticketsSinOrden.flatMap((t) => (t.partner_id ? [t.partner_id[0]] : [])),
    ...notasCredito.flatMap((n) => (n.partnerId ? [n.partnerId[0]] : [])),
  ];
  const [partners, regiones] = await Promise.all([getPartners(partnerIds), getRegiones(partnerIds)]);
  const provinciaDe = (partnerId: [number, string] | false): string => {
    const state = partnerId ? partners.get(partnerId[0])?.state_id : undefined;
    return normalizarProvincia(state ? state[1] : undefined);
  };
  const recargoDe = (partnerId: [number, string] | false): number | null =>
    partnerId ? parseRecargoPct(regiones.get(partnerId[0])) : null;

  const registros: DevolucionRegistro[] = [];
  const reparacion = (r: RepairRow, sector: SectorDevolucion, cuenta: boolean) => {
    const ticket = r.ticket_id ? tickets.get(r.ticket_id[0]) : undefined;
    const motivoTicket = ticket && ticket.x_studio_motivo ? ticket.x_studio_motivo : null;
    const causa: Causa = (motivoTicket && CAUSA_TICKET[motivoTicket]) || 'sinmotivo';
    const soId = ticket?.sale_order_id ? ticket.sale_order_id[0] : r.sale_order_id ? r.sale_order_id[0] : null;
    const prod = r.product_id ? productos.get(r.product_id[0]) : undefined;
    const costoProducto = (prod?.standard_price ?? 0) * (r.product_qty || 1);
    registros.push({
      ref: r.name,
      origen: 'reparacion',
      ticket: ticket ? ticket.name : null,
      mes: r.create_date.slice(0, 7),
      abierto: r.create_date.slice(0, 10),
      cerrado: ticket && ticket.close_date ? ticket.close_date.slice(0, 10) : null,
      sector,
      empresa: r.company_id ? r.company_id[0] : 0,
      cliente: r.partner_id ? r.partner_id[1] : '—',
      provincia: provinciaDe(r.partner_id),
      producto: r.product_id ? r.product_id[1] : '—',
      causa,
      motivo: motivoTicket ?? 'Sin motivo',
      cuenta,
      horas: r.x_studio_horas_de_reparacion,
      enCurso: r.state !== 'done',
      // Lo que no se recuperó de la unidad desarmada; nunca negativo (si se recuperó de más, no es ganancia).
      material: Math.max(0, costoProducto - r.x_studio_total_recuperado),
      facturado: soId !== null ? (ventas.get(soId) ?? 0) : 0,
      vinculado: soId !== null,
      notaCredito: 0,
      recargoPct: recargoDe(r.partner_id),
      baseFlete: costoProducto,
    });
  };
  for (const r of livingRepairs) reparacion(r, 'living', true);
  for (const r of colchonRepairs) reparacion(r, 'colchon', false);
  for (const t of ticketsSinOrden) {
    const soId = t.sale_order_id ? t.sale_order_id[0] : null;
    registros.push({
      ref: t.name,
      origen: 'ticket',
      ticket: t.name,
      mes: t.create_date.slice(0, 7),
      abierto: t.create_date.slice(0, 10),
      cerrado: t.close_date ? t.close_date.slice(0, 10) : null,
      sector: 'living',
      empresa: t.company_id ? t.company_id[0] : 0,
      cliente: t.partner_id ? t.partner_id[1] : '—',
      provincia: provinciaDe(t.partner_id),
      producto: t.product_id ? t.product_id[1] : '—',
      causa: (t.x_studio_motivo && CAUSA_TICKET[t.x_studio_motivo]) || 'sinmotivo',
      motivo: t.x_studio_motivo || 'Sin motivo',
      cuenta: true,
      horas: 0,
      enCurso: true,
      material: 0,
      facturado: soId !== null ? (ventas.get(soId) ?? 0) : 0,
      vinculado: soId !== null,
      notaCredito: 0,
      recargoPct: recargoDe(t.partner_id),
      baseFlete: 0,
    });
  }
  for (const n of notasCredito) {
    registros.push({
      ref: n.name,
      origen: 'nota-credito',
      ticket: null,
      mes: n.invoiceDate.slice(0, 7),
      abierto: n.invoiceDate,
      cerrado: null,
      sector: 'colchon',
      empresa: n.companyId,
      cliente: n.partnerId ? n.partnerId[1] : '—',
      provincia: provinciaDe(n.partnerId),
      producto: '—',
      causa: n.causa,
      motivo: n.motivo,
      cuenta: true,
      horas: 0,
      enCurso: false,
      // El colchón dañado (calidad, rotura en el viaje) o sin motivo no se revende: se pierde su costo. En un error
      // propio de carga/pedido vuelve intacto y en post-venta es un servicio, así que no hay producto perdido.
      material: n.causa === 'logistica' || n.causa === 'postventa' ? 0 : n.costoProducto,
      facturado: 0,
      vinculado: false,
      notaCredito: n.amount,
      recargoPct: recargoDe(n.partnerId),
      baseFlete: n.amountUntaxed,
    });
  }

  const produccion = new Map<string, ProduccionRegistro>();
  const sumarProduccion = (rows: ProductionRow[], sector: SectorDevolucion) => {
    for (const r of rows) {
      const mes = r.date_finished.slice(0, 7);
      const empresa = r.company_id ? r.company_id[0] : 0;
      const key = `${mes}|${sector}|${empresa}`;
      const reg = produccion.get(key) ?? { mes, sector, empresa, unidades: 0 };
      reg.unidades += r.qty_produced;
      produccion.set(key, reg);
    }
  };
  sumarProduccion(livingProd, 'living');
  sumarProduccion(colchonProd, 'colchon');

  return {
    meses: [...mesesAsc].reverse(),
    mesActual,
    empresas: empresas.map((e) => ({ id: e.id, name: e.name })),
    registros,
    produccion: [...produccion.values()],
  };
}

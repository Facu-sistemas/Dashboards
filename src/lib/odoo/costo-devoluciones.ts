import { searchRead, searchReadAll } from './client';
import { getPartners, normalizarProvincia } from './mapa-destinos';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS } from './oee';
import { getArgentinaTodayIso } from './oee';
import { lastMonthKeys, monthBounds } from '../date';
import type { OdooDomain } from './types';

export type SectorDevolucion = 'living' | 'colchon';

/**
 * Por qué volvió (o se rompió) algo. Es lo que separa "no calidad" de lo
 * que se le cobra a otro:
 *  - calidad: falla nuestra de producto — no se recupera, el producto vuelve.
 *  - transporte: se rompió en el viaje — se le factura al transportista.
 *  - postventa: servicio al cliente (retapizar, etc.) — se le factura al cliente.
 *  - logistica: error propio de carga / pedido / facturación / no entregado.
 *  - sinmotivo: no se cargó el motivo en Odoo (no se puede clasificar).
 */
export type Causa = 'calidad' | 'transporte' | 'postventa' | 'logistica' | 'sinmotivo';

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
  origen: 'reparacion' | 'nota-credito';
  /** Ticket de soporte de la reparación, si lo tiene. */
  ticket: string | null;
  mes: string; // "YYYY-MM"
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

// Motivos de la nota de crédito (x_studio_motivo_1 → x_motivo_n_c) y sus notas (x_studio_nota → x_nota_n_c).
const NC_MOTIVO_CALIDAD = 'Calidad';
const NC_MOTIVO_LOGISTICO = 'Logístico';
const NC_NOTA_ROTURA_CAMIONERO = 'Rotura camionero';
const NC_NOTA_POSTVENTA = 'Servicio post venta';
const NC_NOTA_GARANTIA_NO_REAL = 'Garantía no real';
// Campos viejos de la nota de crédito, anteriores al motivo/nota nuevo (18-sep-2026).
const NC_OLD_WARRANTY = 'Garantatía';
const NC_OLD_PRODUCTO = 'Producto';

interface RepairRow extends Record<string, unknown> {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  company_id: [number, string] | false;
  create_date: string;
  product_id: [number, string] | false;
  product_qty: number;
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
}

interface CreditNoteRow extends Record<string, unknown> {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  company_id: [number, string] | false;
  invoice_date: string;
  amount_total_signed: number;
  amount_untaxed_signed: number;
  x_studio_sector: string | false;
  x_studio_motivo: string | false;
  x_studio_motivo_1: [number, string] | false;
  x_studio_nota: [number, string] | false;
  x_studio_notagaranta: string | false;
  x_studio_notaproducto: string | false;
}

interface CreditNoteLineRow extends Record<string, unknown> {
  move_id: [number, string];
  product_id: [number, string] | false;
  quantity: number;
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
    domain: [
      ['state', '=', 'done'],
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

/**
 * Notas de crédito candidatas a devolución: las del esquema viejo (motivo
 * Producto / Garantía) y todas las que ya tienen el motivo nuevo. Después se
 * clasifican en `causaNotaCredito`, que descarta las comerciales/financieras
 * (descuentos, acuerdos comerciales), que no son devoluciones.
 */
function fetchNotasCredito(desde: string): Promise<CreditNoteRow[]> {
  const domain: OdooDomain = [
    ['move_type', '=', 'out_refund'],
    ['state', '=', 'posted'],
    ['invoice_date', '>=', desde],
    '|',
    ['x_studio_motivo', 'in', [NC_OLD_WARRANTY, NC_OLD_PRODUCTO]],
    ['x_studio_motivo_1', '!=', false],
  ];
  return searchReadAll<CreditNoteRow>({
    model: 'account.move',
    domain,
    fields: [
      'name',
      'partner_id',
      'company_id',
      'invoice_date',
      'amount_total_signed',
      'amount_untaxed_signed',
      'x_studio_sector',
      'x_studio_motivo',
      'x_studio_motivo_1',
      'x_studio_nota',
      'x_studio_notagaranta',
      'x_studio_notaproducto',
    ],
  });
}

const CAUSA_TICKET: Record<string, Causa> = {
  Calidad: 'calidad',
  Transporte: 'transporte',
  'Post-Venta': 'postventa',
  // "Devolución" no dice por qué volvió: queda sin clasificar hasta que se cargue la causa real.
  Devolución: 'sinmotivo',
};

/**
 * Causa y motivo legible de una nota de crédito, o null si no es una
 * devolución (comercial / financiera). Usa el motivo y la nota nuevos si
 * están cargados; si no, el esquema viejo.
 */
function causaNotaCredito(n: CreditNoteRow): { causa: Causa; motivo: string } | null {
  const motivoNuevo = n.x_studio_motivo_1 ? n.x_studio_motivo_1[1] : null;
  const nota = n.x_studio_nota ? n.x_studio_nota[1] : null;
  if (motivoNuevo) {
    const motivo = nota ? `${motivoNuevo} / ${nota}` : motivoNuevo;
    if (nota === NC_NOTA_POSTVENTA) return { causa: 'postventa', motivo };
    if (motivoNuevo === NC_MOTIVO_CALIDAD) return { causa: nota === NC_NOTA_GARANTIA_NO_REAL ? 'postventa' : 'calidad', motivo };
    if (motivoNuevo === NC_MOTIVO_LOGISTICO) return { causa: nota === NC_NOTA_ROTURA_CAMIONERO ? 'transporte' : 'logistica', motivo };
    return null; // Comercial / Financiero
  }

  // Esquema viejo.
  const producto = n.x_studio_notaproducto || null;
  if (n.x_studio_motivo === NC_OLD_PRODUCTO) {
    if (producto === 'Transporte') return { causa: 'transporte', motivo: 'Producto / Transporte' };
    if (producto === 'Post-venta') return { causa: 'postventa', motivo: 'Producto / Post-venta' };
    if (producto === 'Error de carga/Facturación' || producto === 'Error de pedido') {
      return { causa: 'logistica', motivo: `Producto / ${producto}` };
    }
    // "Fuera de garantía" se muestra en Odoo como "Financiamiento": son descuentos, no devoluciones.
    if (producto === 'Fuera de garantía') return null;
    return { causa: 'calidad', motivo: 'Producto' };
  }
  if (n.x_studio_motivo === NC_OLD_WARRANTY) {
    if (producto === 'Transporte') return { causa: 'transporte', motivo: 'Garantía / Transporte' };
    if (n.x_studio_notagaranta === 'Comercio') return null;
    if (n.x_studio_notagaranta === 'Por calidad') return { causa: 'calidad', motivo: 'Garantía / Por calidad' };
    return { causa: 'sinmotivo', motivo: 'Garantía' };
  }
  return null;
}

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

  const [empresas, livingRepairs, colchonRepairs, notasCreditoAll, livingProd, colchonProd] = await Promise.all([
    searchRead<{ id: number; name: string }>({ model: 'res.company', fields: ['name'], order: 'id asc' }),
    fetchRepairs(LIVING_CATEG_IDS, desde),
    fetchRepairs(COLCHONES_CATEG_IDS, desde),
    fetchNotasCredito(desde),
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
      fields: ['name', 'x_studio_motivo', 'sale_order_id'],
      context: { active_test: false },
    });
    for (const t of rows) tickets.set(t.id, t);
  }

  // Importe de las ventas vinculadas (lo que se le facturó al transportista / cliente).
  const soIds = [
    ...[...tickets.values()].flatMap((t) => (t.sale_order_id ? [t.sale_order_id[0]] : [])),
    ...[...livingRepairs, ...colchonRepairs].flatMap((r) => (r.sale_order_id ? [r.sale_order_id[0]] : [])),
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

  // Líneas de las notas de crédito: producto y cantidad (costo del colchón devuelto + sector).
  const ncIds = notasCreditoAll.map((n) => n.id);
  const lineas: CreditNoteLineRow[] = [];
  for (let i = 0; i < ncIds.length; i += 1000) {
    lineas.push(
      ...(await searchReadAll<CreditNoteLineRow>({
        model: 'account.move.line',
        domain: [
          ['move_id', 'in', ncIds.slice(i, i + 1000)],
          ['display_type', '=', 'product'],
        ],
        fields: ['move_id', 'product_id', 'quantity'],
      }))
    );
  }

  const productos = await getProductos([
    ...lineas.flatMap((l) => (l.product_id ? [l.product_id[0]] : [])),
    ...[...livingRepairs, ...colchonRepairs].flatMap((r) => (r.product_id ? [r.product_id[0]] : [])),
  ]);
  const colchonSet = new Set(COLCHONES_CATEG_IDS);

  // Por nota de crédito: costo de lo devuelto y si alguna línea es de Colchón.
  const ncInfo = new Map<number, { costo: number; esColchon: boolean }>();
  for (const l of lineas) {
    if (!l.product_id) continue;
    const p = productos.get(l.product_id[0]);
    if (!p) continue;
    const info = ncInfo.get(l.move_id[0]) ?? { costo: 0, esColchon: false };
    info.costo += Math.abs(l.quantity) * p.standard_price;
    if (p.categ_id && colchonSet.has(p.categ_id[0])) info.esColchon = true;
    ncInfo.set(l.move_id[0], info);
  }

  // Solo las que son devolución (descarta descuentos/acuerdos) y de Colchón: el sector sale del campo
  // y, si no está cargado, de la categoría de los productos de la nota.
  const notasCredito = notasCreditoAll.flatMap((n) => {
    const clasif = causaNotaCredito(n);
    if (!clasif) return [];
    const esColchon = n.x_studio_sector ? n.x_studio_sector === 'Colchon' : (ncInfo.get(n.id)?.esColchon ?? false);
    return esColchon ? [{ n, ...clasif }] : [];
  });

  const partnerIds = [...livingRepairs, ...colchonRepairs, ...notasCredito.map((x) => x.n)].flatMap((r) =>
    r.partner_id ? [r.partner_id[0]] : []
  );
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
      sector,
      empresa: r.company_id ? r.company_id[0] : 0,
      cliente: r.partner_id ? r.partner_id[1] : '—',
      provincia: provinciaDe(r.partner_id),
      producto: r.product_id ? r.product_id[1] : '—',
      causa,
      motivo: motivoTicket ?? 'Sin motivo',
      cuenta,
      horas: r.x_studio_horas_de_reparacion,
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
  for (const { n, causa, motivo } of notasCredito) {
    registros.push({
      ref: n.name,
      origen: 'nota-credito',
      ticket: null,
      mes: n.invoice_date.slice(0, 7),
      sector: 'colchon',
      empresa: n.company_id ? n.company_id[0] : 0,
      cliente: n.partner_id ? n.partner_id[1] : '—',
      provincia: provinciaDe(n.partner_id),
      producto: '—',
      causa,
      motivo,
      cuenta: true,
      horas: 0,
      // El colchón dañado (calidad, rotura en el viaje) o sin motivo no se revende: se pierde su costo. En un error
      // propio de carga/pedido vuelve intacto y en post-venta es un servicio, así que no hay producto perdido.
      material: causa === 'logistica' || causa === 'postventa' ? 0 : (ncInfo.get(n.id)?.costo ?? 0),
      facturado: 0,
      vinculado: false,
      notaCredito: Math.abs(n.amount_total_signed),
      recargoPct: recargoDe(n.partner_id),
      baseFlete: Math.abs(n.amount_untaxed_signed),
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

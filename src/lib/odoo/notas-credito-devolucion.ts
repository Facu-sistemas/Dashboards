import { searchReadAll } from './client';
import { COLCHONES_CATEG_IDS } from './oee';
import type { OdooDomain } from './types';

/**
 * Notas de crédito de Colchón que cuentan como "devolución", con su causa.
 * Fuente única para la pestaña Reparaciones y para Costo de no calidad, así
 * las dos coinciden. Una nota cuenta si es de Colchón y NO es comercial ni
 * financiera: no entran los descuentos, los acuerdos comerciales ni la
 * publicidad (se detectan por el motivo/nota y, como el motivo a veces
 * viene mal o vacío, también por el producto de las líneas).
 */

/**
 * Por qué volvió algo. Separa "no calidad" de lo que se le cobra a otro:
 *  - calidad: falla nuestra de producto — no se recupera.
 *  - transporte: se rompió en el viaje — se le factura al transportista.
 *  - postventa: servicio al cliente — se le factura al cliente.
 *  - logistica: error propio de carga / pedido / facturación / no entregado.
 *  - sinmotivo: no se cargó el motivo en Odoo.
 */
export type Causa = 'calidad' | 'transporte' | 'postventa' | 'logistica' | 'sinmotivo';

// Motivos de la nota de crédito (x_studio_motivo_1 → x_motivo_n_c) y sus notas (x_studio_nota → x_nota_n_c).
const NC_MOTIVO_CALIDAD = 'Calidad';
const NC_MOTIVO_LOGISTICO = 'Logístico';
const NC_NOTA_ROTURA_CAMIONERO = 'Rotura camionero';
const NC_NOTA_POSTVENTA = 'Servicio post venta';
const NC_NOTA_GARANTIA_NO_REAL = 'Garantía no real';
// Campo viejo (x_studio_motivo), anterior al motivo/nota nuevo del 18-sep-2026. Mismos valores que
// CREDIT_NOTE_WARRANTY_MOTIVO (con la errata "Garantatía", hoy "Logistica" en la UI) y CREDIT_NOTE_NO_CONFORMIDAD_MOTIVO de calidad.ts.
const NC_OLD_WARRANTY = 'Garantatía';
const NC_OLD_PRODUCTO = 'Producto';

/** Productos genéricos de las notas que NO son devoluciones: si todas las líneas son de estos, se descarta la nota. */
const PRODUCTO_NO_DEVOLUCION = /descuento|acuerdo comercial|publicidad/i;

export interface NotaDevolucion {
  id: number;
  name: string;
  partnerId: [number, string] | false;
  companyId: number;
  invoiceDate: string;
  /** Monto con IVA, positivo. */
  amount: number;
  amountUntaxed: number;
  causa: Causa;
  /** Motivo legible ("Calidad / Garantía real"). */
  motivo: string;
  /** Para la pestaña Reparaciones: "garantia" = el bucket que viene de Logística/Garantía, "calidad" = el de Calidad/Producto. */
  grupo: 'garantia' | 'calidad';
  /** Costo ($) de los productos devueltos en la nota (cantidad × costo estándar). */
  costoProducto: number;
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

interface LineRow extends Record<string, unknown> {
  move_id: [number, string];
  product_id: [number, string] | false;
  quantity: number;
}

interface ProductRow extends Record<string, unknown> {
  id: number;
  standard_price: number;
  categ_id: [number, string] | false;
}

/**
 * Causa y motivo legible de una nota de crédito, o null si no es una
 * devolución (comercial / financiera). Usa el motivo y la nota nuevos si
 * están cargados; si no, el esquema viejo.
 */
function clasificar(n: CreditNoteRow): { causa: Causa; motivo: string; grupo: NotaDevolucion['grupo'] } | null {
  const motivoNuevo = n.x_studio_motivo_1 ? n.x_studio_motivo_1[1] : null;
  const nota = n.x_studio_nota ? n.x_studio_nota[1] : null;
  if (motivoNuevo) {
    const motivo = nota ? `${motivoNuevo} / ${nota}` : motivoNuevo;
    const grupo = motivoNuevo === NC_MOTIVO_LOGISTICO ? 'garantia' : 'calidad';
    if (nota === NC_NOTA_POSTVENTA) return { causa: 'postventa', motivo, grupo };
    if (motivoNuevo === NC_MOTIVO_CALIDAD) return { causa: nota === NC_NOTA_GARANTIA_NO_REAL ? 'postventa' : 'calidad', motivo, grupo };
    if (motivoNuevo === NC_MOTIVO_LOGISTICO) return { causa: nota === NC_NOTA_ROTURA_CAMIONERO ? 'transporte' : 'logistica', motivo, grupo };
    return null; // Comercial / Financiero
  }

  // Esquema viejo.
  const producto = n.x_studio_notaproducto || null;
  if (n.x_studio_motivo === NC_OLD_PRODUCTO) {
    if (producto === 'Transporte') return { causa: 'transporte', motivo: 'Producto / Transporte', grupo: 'calidad' };
    if (producto === 'Post-venta') return { causa: 'postventa', motivo: 'Producto / Post-venta', grupo: 'calidad' };
    if (producto === 'Error de carga/Facturación' || producto === 'Error de pedido') {
      return { causa: 'logistica', motivo: `Producto / ${producto}`, grupo: 'calidad' };
    }
    // "Fuera de garantía" se muestra en Odoo como "Financiamiento": son descuentos, no devoluciones.
    if (producto === 'Fuera de garantía') return null;
    return { causa: 'calidad', motivo: 'Producto', grupo: 'calidad' };
  }
  if (n.x_studio_motivo === NC_OLD_WARRANTY) {
    if (producto === 'Transporte') return { causa: 'transporte', motivo: 'Garantía / Transporte', grupo: 'garantia' };
    if (n.x_studio_notagaranta === 'Comercio') return null;
    if (n.x_studio_notagaranta === 'Por calidad') return { causa: 'calidad', motivo: 'Garantía / Por calidad', grupo: 'garantia' };
    return { causa: 'sinmotivo', motivo: 'Garantía', grupo: 'garantia' };
  }
  return null;
}

/**
 * Notas de crédito de devolución de Colchón desde `desde` (YYYY-MM-DD) o de
 * siempre si es null. Deliberadamente NO se filtra por empresa: acotar a una
 * sola subcuenta notas reales (confirmado en vivo para Garantía).
 *
 * El sector sale de `x_studio_sector` y, si no está cargado (casi ninguna de
 * las notas nuevas lo tiene), de la categoría de los productos de la nota.
 */
export async function fetchNotasDevolucionColchon(desde: string | null): Promise<NotaDevolucion[]> {
  const domain: OdooDomain = [
    ['move_type', '=', 'out_refund'],
    ['state', '=', 'posted'],
    '|',
    ['x_studio_motivo', 'in', [NC_OLD_WARRANTY, NC_OLD_PRODUCTO]],
    ['x_studio_motivo_1', '!=', false],
  ];
  if (desde) domain.push(['invoice_date', '>=', desde]);
  const notas = await searchReadAll<CreditNoteRow>({
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

  const lineas: LineRow[] = [];
  const ids = notas.map((n) => n.id);
  for (let i = 0; i < ids.length; i += 1000) {
    lineas.push(
      ...(await searchReadAll<LineRow>({
        model: 'account.move.line',
        domain: [
          ['move_id', 'in', ids.slice(i, i + 1000)],
          ['display_type', '=', 'product'],
        ],
        fields: ['move_id', 'product_id', 'quantity'],
      }))
    );
  }

  const productIds = [...new Set(lineas.flatMap((l) => (l.product_id ? [l.product_id[0]] : [])))];
  const productos = new Map<number, ProductRow>();
  for (let i = 0; i < productIds.length; i += 1000) {
    const rows = await searchReadAll<ProductRow>({
      model: 'product.product',
      domain: [['id', 'in', productIds.slice(i, i + 1000)]],
      fields: ['standard_price', 'categ_id'],
      context: { active_test: false },
    });
    for (const p of rows) productos.set(p.id, p);
  }

  const colchonSet = new Set(COLCHONES_CATEG_IDS);
  const info = new Map<number, { costo: number; esColchon: boolean; soloNoDevolucion: boolean; lineas: number }>();
  for (const l of lineas) {
    const i = info.get(l.move_id[0]) ?? { costo: 0, esColchon: false, soloNoDevolucion: true, lineas: 0 };
    i.lineas++;
    if (!l.product_id || !PRODUCTO_NO_DEVOLUCION.test(l.product_id[1])) i.soloNoDevolucion = false;
    const p = l.product_id ? productos.get(l.product_id[0]) : undefined;
    if (p) {
      i.costo += Math.abs(l.quantity) * p.standard_price;
      if (p.categ_id && colchonSet.has(p.categ_id[0])) i.esColchon = true;
    }
    info.set(l.move_id[0], i);
  }

  return notas.flatMap((n) => {
    const clasif = clasificar(n);
    if (!clasif) return [];
    const i = info.get(n.id);
    // Descuento / acuerdo comercial / publicidad aunque el motivo esté mal cargado.
    if (i && i.lineas > 0 && i.soloNoDevolucion) return [];
    const esColchon = n.x_studio_sector ? n.x_studio_sector === 'Colchon' : (i?.esColchon ?? false);
    if (!esColchon) return [];
    return [
      {
        id: n.id,
        name: n.name,
        partnerId: n.partner_id,
        companyId: n.company_id ? n.company_id[0] : 0,
        invoiceDate: n.invoice_date,
        amount: Math.abs(n.amount_total_signed),
        amountUntaxed: Math.abs(n.amount_untaxed_signed),
        causa: clasif.causa,
        motivo: clasif.motivo,
        grupo: clasif.grupo,
        costoProducto: i?.costo ?? 0,
      },
    ];
  });
}

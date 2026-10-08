// Conectores de solo lectura: OC pendientes, stock de fin de mes, gasto real, tipo de cambio y recepciones sin facturar.
// Las tres primeras reutilizan las consultas de la pestaña Descargas (ya validadas por Compras), acotadas a la compañía operativa.
import { searchRead, searchReadAll } from '../../odoo/client';
import { getFronteraCompany } from '../../odoo/reference';
import { MATERIA_PRIMA_CATEG_ID } from '../../odoo/raw-material-consumption';
import { getGastoLineas, getOcPendientes, getStockDetalle } from '../../odoo/rotacion-gasto-detalle';
import type { GastoLinea, OcPendienteLinea, StockDetalleResult } from '../../odoo/rotacion-gasto-detalle';
import type { OcLinea } from '../motor';

export async function getOcPendientesMp(): Promise<OcPendienteLinea[]> {
  const { companyId } = await getFronteraCompany();
  return getOcPendientes([companyId]);
}

/** A las líneas que consume el motor. `nombrePorId` (productId → nombre del producto) evita depender del texto con la referencia interna. */
export function aOcLineas(oc: OcPendienteLinea[], nombrePorId?: Map<number, string>): OcLinea[] {
  const f = (s: string) => (s ? s : null);
  return oc.map((l, i) => ({
    fila: i + 1, lineaId: l.lineaId, ordenId: l.ordenId, productId: l.productId, n: (nombrePorId?.get(l.productId) ?? l.nombrePantalla).trim(), fecha: f(l.fechaPrevista), pend: Math.max(0, l.pendiente),
    categoria: l.categoria, orden: l.orden, prov: l.proveedor.trim(), fechaOrden: f(l.fechaOrden), pedida: l.pedida, recibida: l.recibida,
    condicion: l.condicionPago, ultimaRecepcion: f(l.ultimaRecepcion), recepcionProgramada: f(l.recepcionProgramada), remito: l.remitoAbierto,
  }));
}

export async function getStockFinDeMes(): Promise<StockDetalleResult> {
  const { companyId } = await getFronteraCompany();
  return getStockDetalle([companyId]);
}

/** `empresaIds` = empresas elegidas por el usuario; sin dato, solo la compañía operativa (Frontera Living S.A.). */
export async function getGastoRealMp(empresaIds?: number[]): Promise<GastoLinea[]> {
  const { companyId } = await getFronteraCompany();
  return getGastoLineas(empresaIds && empresaIds.length ? empresaIds : [companyId]);
}

export interface TipoCambio {
  moneda: string;
  /** Fecha de la cotización (AAAA-MM-DD). */
  fecha: string;
  /** Pesos por unidad de la moneda. */
  pesos: number;
}

/** Última cotización cargada en Odoo de la moneda (USD por defecto) a la fecha indicada. */
export async function getTipoCambio(moneda = 'USD', hasta = new Date().toISOString().slice(0, 10)): Promise<TipoCambio | null> {
  const { companyId } = await getFronteraCompany();
  const rows = await searchRead<{ name: string; rate: number; company_rate: number; inverse_company_rate: number }>({
    model: 'res.currency.rate',
    domain: [['currency_id.name', '=', moneda], ['company_id', 'in', [false, companyId]], ['name', '<=', hasta]],
    fields: ['name', 'rate', 'company_rate', 'inverse_company_rate'],
    order: 'name desc, id desc',
    limit: 1,
  });
  const r = rows[0];
  if (!r) return null;
  const pesos = r.inverse_company_rate || (r.rate ? 1 / r.rate : 0);
  return { moneda, fecha: r.name, pesos };
}

export interface RecepcionSinFacturar {
  productId: number;
  orden: string;
  proveedor: string;
  moneda: string;
  /** Cantidad recibida y todavía no facturada, en la unidad de la línea. */
  cantidad: number;
  /** Importe estimado, en la moneda de la orden: subtotal de la línea × (recibido - facturado) / pedido. */
  monto: number;
}

/**
 * Lo recibido que todavía no tiene factura: sale de caja cuando llegue la factura y no está en "facturas abiertas".
 * Solo mira órdenes aprobadas desde `desde` (por defecto, 60 días): las facturas viejas cargadas sin vincular a la
 * OC dejan `qty_invoiced` en 0 para siempre y darían una deuda inexistente. El importe se calcula por proporción
 * del subtotal de la línea, así no depende de la unidad de compra.
 */
export async function getRecepcionesSinFacturar(desde?: string): Promise<RecepcionSinFacturar[]> {
  const { companyId } = await getFronteraCompany();
  const limite = desde ?? new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  type L = {
    product_id: [number, string]; order_id: [number, string]; partner_id: [number, string] | false; product_qty: number;
    qty_received: number; qty_invoiced: number; price_subtotal: number; currency_id: [number, string] | false;
  };
  const lines = await searchReadAll<L>({
    model: 'purchase.order.line',
    domain: [['order_id.state', 'in', ['purchase', 'done']], ['order_id.company_id', '=', companyId], ['order_id.date_approve', '>=', limite],
      ['display_type', '=', false], ['product_id.categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID]],
    fields: ['product_id', 'order_id', 'partner_id', 'product_qty', 'qty_received', 'qty_invoiced', 'price_subtotal', 'currency_id'],
  });
  return lines
    .filter((l) => l.qty_received - l.qty_invoiced > 1e-6 && l.product_qty > 0)
    .map((l) => {
      const cantidad = Math.min(l.qty_received, l.product_qty) - l.qty_invoiced;
      return {
        productId: l.product_id[0], orden: l.order_id[1], proveedor: l.partner_id ? l.partner_id[1].trim() : '', moneda: l.currency_id ? l.currency_id[1] : '',
        cantidad, monto: (l.price_subtotal * cantidad) / l.product_qty,
      };
    })
    .filter((r) => r.cantidad > 1e-6);
}

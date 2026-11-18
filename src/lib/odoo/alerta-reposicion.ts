// Alerta de reposición: reglas de reabastecimiento de Odoo cuyo pronóstico quedó por debajo del mínimo, con la cantidad a pedir
// (máximo − pronóstico, redondeada al múltiplo). Odoo no avisa con disparador manual: solo lo muestra si alguien abre Reposiciones.
// Solo lectura: nunca escribe en Odoo.
import { searchReadAll } from '@/lib/odoo/client';

export interface FilaAlerta {
  reglaId: number;
  sku: string;
  ubicacion: string;
  disponible: number;
  pronostico: number;
  min: number;
  max: number;
  multiplo: number;
  /** Cantidad a pedir según la regla: máximo − pronóstico, redondeada hacia arriba al múltiplo. */
  aPedir: number;
  /** Lo que muestra Odoo en la columna "A pedir" de Reposiciones (puede estar desactualizado). */
  aPedirOdoo: number;
  /** Cantidad en OC en borrador o enviadas (RFQ): no cuenta en el pronóstico hasta confirmarlas. */
  enRfq: number;
  trigger: string;
  unidad: string;
}

export interface ResultadoAlerta {
  filas: FilaAlerta[];
  totalReglas: number;
  leidoEn: string;
}

type ReglaOdoo = {
  id: number;
  product_id: [number, string];
  location_id: [number, string];
  product_min_qty: number;
  product_max_qty: number;
  qty_multiple: number;
  trigger: string;
  qty_on_hand: number;
  qty_forecast: number;
  qty_to_order: number;
  product_uom: [number, string] | false;
};

const redondear = (v: number) => Math.round(v * 100) / 100;

export async function construirAlertaReposicion(): Promise<ResultadoAlerta> {
  const reglas = await searchReadAll<ReglaOdoo>({
    model: 'stock.warehouse.orderpoint',
    domain: [['active', '=', true], ['product_min_qty', '>', 0]],
    fields: ['product_id', 'location_id', 'product_min_qty', 'product_max_qty', 'qty_multiple', 'trigger', 'qty_on_hand', 'qty_forecast', 'qty_to_order', 'product_uom'],
  });
  // qty_forecast no se puede filtrar en el dominio (no está almacenado): se filtra acá.
  const bajoMinimo = reglas.filter((r) => r.qty_forecast < r.product_min_qty);

  const rfq = new Map<number, number>();
  if (bajoMinimo.length) {
    const lineas = await searchReadAll<{ product_id: [number, string]; product_qty: number }>({
      model: 'purchase.order.line',
      domain: [['product_id', 'in', bajoMinimo.map((r) => r.product_id[0])], ['order_id.state', 'in', ['draft', 'sent']]],
      fields: ['product_id', 'product_qty'],
    });
    for (const l of lineas) rfq.set(l.product_id[0], (rfq.get(l.product_id[0]) ?? 0) + l.product_qty);
  }

  const filas: FilaAlerta[] = bajoMinimo
    .map((r) => {
      const mult = r.qty_multiple > 0 ? r.qty_multiple : 1;
      const falta = r.product_max_qty - r.qty_forecast;
      return {
        reglaId: r.id,
        sku: r.product_id[1],
        ubicacion: r.location_id[1],
        disponible: redondear(r.qty_on_hand),
        pronostico: redondear(r.qty_forecast),
        min: r.product_min_qty,
        max: r.product_max_qty,
        multiplo: mult,
        aPedir: Math.ceil(falta / mult - 1e-9) * mult,
        aPedirOdoo: redondear(r.qty_to_order),
        enRfq: redondear(rfq.get(r.product_id[0]) ?? 0),
        trigger: r.trigger,
        unidad: r.product_uom ? r.product_uom[1] : '',
      };
    })
    .sort((a, b) => a.pronostico / (a.min || 1) - b.pronostico / (b.min || 1));

  return { filas, totalReglas: reglas.length, leidoEn: new Date().toISOString() };
}

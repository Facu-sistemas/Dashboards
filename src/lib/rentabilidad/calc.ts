import { umbralesDeCategoria } from '@/lib/rentabilidad/config';
import type { RentabilidadConfig, EstadoSemaforo, Metricas, UmbralesRentabilidad } from '@/lib/rentabilidad/types';

/**
 * Cálculo puro (sin I/O) de métricas de contribución, igual que las
 * funciones SQL agg_categoria / agg_subcategoria / agg_cliente del
 * proyecto de referencia:
 *   contribucion_pct = contribución / venta * 100
 *   gap_pct          = contribucion_pct - objetivo_pct
 *   margen_perdido   = max(objetivo_pct/100 * venta - contribución, 0)
 * con la salvedad de que venta y costo se comparan solo sobre la parte de
 * la venta que tiene costo conocido (`ventaConCosto`): sin costo no hay
 * contribución (queda null) en vez de un número inventado.
 */

export interface Acumulador {
  /** Monto s/flete (base de la contribución). */
  venta: number;
  /** Subtotal facturado, con el recargo regional incluido. */
  subtotal: number;
  cantidad: number;
  ventaConCosto: number;
  costoMp: number;
  costoMod: number;
  costoFijos: number;
  /** Suma de objetivo% * ventaConCosto, para promediar el objetivo ponderado por venta. */
  objetivoPesado: number;
}

export function acumuladorVacio(): Acumulador {
  return { venta: 0, subtotal: 0, cantidad: 0, ventaConCosto: 0, costoMp: 0, costoMod: 0, costoFijos: 0, objetivoPesado: 0 };
}

export interface LineaCosteada {
  clienteId: number;
  templateId: number;
  varianteId: number;
  mes: number;
  /** Monto s/flete = subtotal / (1 + recargo). */
  venta: number;
  subtotal: number;
  cantidad: number;
  categoria: string;
  subcategoria: string;
  /** null en los tres = línea sin costo conocido. */
  costoMp: number | null;
  costoMod: number | null;
  costoFijos: number | null;
}

export function tieneCosto(l: LineaCosteada): boolean {
  // Sin MP o sin MOD la contribución quedaría inflada: la línea cuenta como sin costo.
  return l.costoMp !== null && l.costoMod !== null;
}

export function acumular(a: Acumulador, l: LineaCosteada, config: RentabilidadConfig): void {
  a.venta += l.venta;
  a.subtotal += l.subtotal;
  a.cantidad += l.cantidad;
  if (!tieneCosto(l)) return;
  a.ventaConCosto += l.venta;
  a.costoMp += l.costoMp ?? 0;
  a.costoMod += l.costoMod ?? 0;
  a.costoFijos += l.costoFijos ?? 0;
  a.objetivoPesado += umbralesDeCategoria(config, l.categoria).objetivo * l.venta;
}

export function estadoSemaforo(pct: number | null, u: UmbralesRentabilidad): EstadoSemaforo {
  if (pct === null) return 'sin_costo';
  if (pct >= u.verde) return 'verde';
  if (pct >= u.amarillo) return 'amarillo';
  return 'rojo';
}

/** `umbrales`: los que rigen el semáforo de esta fila (los de su categoría si es de una sola, o los globales). */
export function metricas(a: Acumulador, umbrales: UmbralesRentabilidad): Metricas {
  const conCosto = a.ventaConCosto > 0;
  const costoTotal = conCosto ? a.costoMp + a.costoMod + a.costoFijos : null;
  const contribucion = costoTotal !== null ? a.ventaConCosto - costoTotal : null;
  const contribucionPct = contribucion !== null && a.ventaConCosto > 0 ? (contribucion / a.ventaConCosto) * 100 : null;
  const objetivoPct = a.ventaConCosto > 0 ? a.objetivoPesado / a.ventaConCosto : umbrales.objetivo;
  return {
    venta: a.venta,
    subtotal: a.subtotal,
    cantidad: a.cantidad,
    ventaConCosto: a.ventaConCosto,
    cobertura: a.venta !== 0 ? Math.min(Math.max(a.ventaConCosto / a.venta, 0), 1) : 0,
    costoMp: conCosto ? a.costoMp : null,
    costoMod: conCosto ? a.costoMod : null,
    costoFijos: conCosto ? a.costoFijos : null,
    costoTotal,
    contribucion,
    contribucionPct,
    objetivoPct,
    gapPct: contribucionPct !== null ? contribucionPct - objetivoPct : null,
    margenPerdido:
      contribucion !== null && a.ventaConCosto > 0 ? Math.max((objetivoPct / 100) * a.ventaConCosto - contribucion, 0) : null,
    estado: estadoSemaforo(contribucionPct, umbrales),
  };
}

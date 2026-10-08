// Inventario hoy frente a la política (columnas ED–FK de la hoja "Cálculo SKU" del libro v12): valor actual e ideal, estado frente a la
// política, capital inmovilizado, compra de urgencia y rotación real. Función pura, se aplica sobre las filas del motor.
import type { FilaCalc } from './motor';

/** Stock de fin de mes de un producto: índice 0 = 31-dic del año anterior, 1 = enero … 12 = diciembre. */
export interface HistoriaStockProducto {
  cantidad: number[];
  valor: number[];
}
/** Por `clave` del insumo (`#id`, o el nombre cuando no hay id). */
export type HistoriaStock = Map<string, HistoriaStockProducto>;

export type EstadoPolitica =
  | 'Consignado' | 'Agotar stock' | 'Discontinuado' | 'Sin stock ni consumo' | 'Sin consumo proyectado'
  | 'Debajo del stock de seguridad' | 'Debajo del objetivo' | 'En rango' | 'Exceso';

export interface FilaInventario {
  /** Consumo semanal de referencia hoy (u). */
  ed: number;
  /** Stock de seguridad / objetivo (punto de pedido) / máximo hoy (u). */
  ee: number; ef: number; eg: number;
  /** Valor actual ($): disponible × costo (consignados no cuentan). */
  eh: number;
  /** Stock ideal hoy (u) y su valor ($). */
  ei: number; ej: number;
  /** Variación ($) = valor actual − valor ideal. */
  ek: number;
  /** Cobertura del disponible (semanas); null si no hay consumo. */
  el: number | null;
  /** Días de inventario actual y con entrante. */
  em: number | null; en: number | null;
  estado: EstadoPolitica | '';
  /** Sin movimiento 3+ meses ($), exceso sobre el máximo ($), stock de líneas discontinuadas ($). */
  ep: number; eq: number; er: number;
  /** Capital inmovilizado ($), sin doble conteo. */
  es: number;
  /** Stock objetivo hoy ($). */
  et: number;
  /** Desviación vs objetivo: (stock − objetivo) / objetivo. */
  eu: number | null;
  /** Compra de urgencia ($): respaldo + faltante antes de poder recibir. */
  ev: number;
  /** Consumo anualizado ($) y rotación provisoria. */
  fe: number; ff: number | null;
  /** Stock real al fin del mes de corte (u y $) y stock promedio valorizado de los 5 últimos cierres. */
  fg: number; fh: number; fi: number;
  /** Rotación real (veces/año). */
  fj: number | null;
  grupo: 'Químicos principales' | 'General';
}

export interface ParametrosInventario {
  /** Último mes cerrado (1-12). */
  corte: number;
  /** 7 = días corridos; 5 = días hábiles (para expresar la política en días). */
  diasPorSemana: number;
}

export function calcularInventario(filas: FilaCalc[], historia: HistoriaStock, p: ParametrosInventario): FilaInventario[] {
  return filas.map((f) => {
    const ed = f.w1;
    const ee = f.ss * ed, ef = f.obs * ed, eg = f.mxs * ed;
    const consignado = f.met === 'Consignado';
    const eh = consignado ? 0 : f.disp * f.costo;
    const ei = f.idw * ed;
    const ej = consignado ? 0 : ei * f.costo;
    const el = ed > 0 ? f.disp / ed : null;

    let estado: EstadoPolitica;
    if (consignado) estado = 'Consignado';
    else if (f.met === 'Agotar stock') estado = 'Agotar stock';
    else if (f.met === 'Discontinuado') estado = f.disp > 0 ? 'Discontinuado' : 'Sin stock ni consumo';
    else if (ed === 0) estado = f.disp > 0 ? 'Sin consumo proyectado' : 'Sin stock ni consumo';
    else if (el! < f.ss) estado = 'Debajo del stock de seguridad';
    else if (el! < f.obs) estado = 'Debajo del objetivo';
    else if (el! <= f.mxs) estado = 'En rango';
    else estado = 'Exceso';

    const ep = f.c3t === 0 && f.disp > 0 && !consignado ? f.disp * f.costo : 0;
    const eq = ed > 0 && !consignado && f.met !== 'Agotar stock' ? Math.max(0, f.disp - eg) * f.costo : 0;
    const er = f.met === 'Discontinuado' && ep === 0 ? eh : 0;
    const es = ep > 0 ? ep : er > 0 ? er : eq;
    const fe = f.c4t * 3 * f.costo;

    const h = historia.get(f.clave);
    const cant = h?.cantidad[p.corte] ?? 0;
    const val = h?.valor[p.corte] ?? 0;
    // Promedio del valor de los 5 últimos cierres (corte-4 … corte); sin cierres anteriores a diciembre del año previo.
    let suma = 0, n = 0;
    for (let m = p.corte - 4; m <= p.corte; m++) {
      if (m < 0) continue;
      suma += h?.valor[m] ?? 0;
      n++;
    }
    const fi = h && n ? suma / n : 0;

    return {
      ed, ee, ef, eg, eh, ei, ej, ek: eh - ej, el,
      em: ed > 0 ? f.disp / (ed / p.diasPorSemana) : null,
      en: ed > 0 ? (f.disp + f.ent) / (ed / p.diasPorSemana) : null,
      estado, ep, eq, er, es, et: ef * f.costo, eu: ef > 0 ? (f.disp - ef) / ef : null,
      ev: (f.bk1 + f.bk2 + f.bk3 + f.bk4) * f.costo + f.o0u * f.costo,
      fe, ff: eh > 0 ? fe / eh : null, fg: cant, fh: val, fi, fj: fi > 0 ? fe / fi : null,
      grupo: f.met === 'Químico principal' ? 'Químicos principales' : 'General',
    };
  });
}

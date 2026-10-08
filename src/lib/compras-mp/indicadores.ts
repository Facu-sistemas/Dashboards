// Indicadores de rendición de cuentas de Compras MP (hojas Inventario y KPI Gerencia del libro v12), calculados sobre las filas de una corrida.
// Función pura: la web solo muestra lo que sale de acá.
import type { FilaCalc } from './motor';
import type { FilaInventario } from './inventario';

export type FilaCompleta = FilaCalc & FilaInventario;

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export interface InventarioResumen {
  valorActual: number;
  valorIdeal: number;
  variacion: number;
  variacionPct: number | null;
  excesoSobreMaximo: number;
  sinMovimiento: number;
  capitalInmovilizado: number;
  pctSinMovimiento: number | null;
  rotacionProvisoria: number | null;
  stockPromedio5: number;
  rotacionReal: number | null;
  consumoAnualizado: number;
}

export interface InventarioPorCategoria extends InventarioResumen {
  categoria: string;
}

function resumir(filas: FilaCompleta[]): InventarioResumen {
  const valorActual = sum(filas.map((f) => f.eh)), valorIdeal = sum(filas.map((f) => f.ej));
  const sinMovimiento = sum(filas.map((f) => f.ep)), stockPromedio5 = sum(filas.map((f) => f.fi)), consumoAnualizado = sum(filas.map((f) => f.fe));
  return {
    valorActual, valorIdeal, variacion: valorActual - valorIdeal, variacionPct: div(valorActual - valorIdeal, valorIdeal),
    excesoSobreMaximo: sum(filas.map((f) => f.eq)), sinMovimiento, capitalInmovilizado: sum(filas.map((f) => f.es)),
    pctSinMovimiento: div(sinMovimiento, valorActual), rotacionProvisoria: div(consumoAnualizado, valorActual),
    stockPromedio5, rotacionReal: div(consumoAnualizado, stockPromedio5), consumoAnualizado,
  };
}

/** Una fila por categoría (orden alfabético) más el total. */
export function inventarioPorCategoria(filas: FilaCompleta[]): { categorias: InventarioPorCategoria[]; total: InventarioResumen } {
  const porCat = new Map<string, FilaCompleta[]>();
  for (const f of filas) porCat.set(f.cat, [...(porCat.get(f.cat) ?? []), f]);
  const categorias = [...porCat].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([categoria, fs]) => ({ categoria, ...resumir(fs) }));
  return { categorias, total: resumir(filas) };
}

export interface InventarioPorClase {
  clase: string;
  bajoSeguridad: number;
  bajoObjetivo: number;
  enRango: number;
  exceso: number;
  pctEnRango: number | null;
  valorExceso: number;
  capitalInmovilizado: number;
  /** Stock objetivo hoy ($), o punto de pedido. */
  objetivoHoy: number;
  /** Stock actual ($) de los insumos que tienen objetivo. */
  stockActual: number;
  desviacion: number | null;
}

function clase(nombre: string, filas: FilaCompleta[]): InventarioPorClase {
  const cuenta = (e: string) => filas.filter((f) => f.estado === e).length;
  const bajoSeguridad = cuenta('Debajo del stock de seguridad'), bajoObjetivo = cuenta('Debajo del objetivo'), enRango = cuenta('En rango'), exceso = cuenta('Exceso');
  const objetivoHoy = sum(filas.map((f) => f.et));
  const stockActual = sum(filas.filter((f) => f.et > 0).map((f) => f.eh));
  const n = bajoSeguridad + bajoObjetivo + enRango + exceso;
  return {
    clase: nombre, bajoSeguridad, bajoObjetivo, enRango, exceso, pctEnRango: n ? enRango / n : null,
    valorExceso: sum(filas.map((f) => f.eq)), capitalInmovilizado: sum(filas.map((f) => f.es)), objetivoHoy, stockActual,
    desviacion: objetivoHoy > 0 ? (stockActual - objetivoHoy) / objetivoHoy : null,
  };
}

/** Grado de ajuste a la política por clase ABC (A, B, C) y total. */
export function inventarioPorClase(filas: FilaCompleta[]): { clases: InventarioPorClase[]; total: InventarioPorClase } {
  const clases = ['A', 'B', 'C'].map((c) => clase(c, filas.filter((f) => f.abc === c)));
  const t = (k: 'bajoSeguridad' | 'bajoObjetivo' | 'enRango' | 'exceso' | 'valorExceso' | 'capitalInmovilizado' | 'objetivoHoy' | 'stockActual') => sum(clases.map((c) => c[k]));
  const n = t('bajoSeguridad') + t('bajoObjetivo') + t('enRango') + t('exceso');
  const objetivoHoy = t('objetivoHoy'), stockActual = t('stockActual');
  return {
    clases,
    total: {
      clase: 'Total', bajoSeguridad: t('bajoSeguridad'), bajoObjetivo: t('bajoObjetivo'), enRango: t('enRango'), exceso: t('exceso'), pctEnRango: n ? t('enRango') / n : null,
      valorExceso: t('valorExceso'), capitalInmovilizado: t('capitalInmovilizado'), objetivoHoy, stockActual,
      desviacion: objetivoHoy > 0 ? (stockActual - objetivoHoy) / objetivoHoy : null,
    },
  };
}

export interface KpisInventario {
  /** N2.1 */ valorizacion: number;
  valorIdeal: number;
  /** N1 */ capitalInmovilizado: number;
  pctCapitalInmovilizado: number | null;
  /** N1: SKUs de clase A, B y C entre el stock de seguridad y el máximo. */
  pctDentroPolitica: number | null;
  skusPorEstado: { bajoSeguridad: number; bajoObjetivo: number; enRango: number; exceso: number };
  /** N2.2: desviación vs punto de pedido, por clase y total. */
  desviacion: Record<string, number | null>;
  /** N2.3 */ rotacionReal: number | null;
  /** N2.4 */ pctSinMovimiento: number | null;
  sinMovimiento: number;
}

export function kpisInventario(filas: FilaCompleta[]): KpisInventario {
  const total = resumir(filas);
  const { clases, total: ct } = inventarioPorClase(filas);
  const n = ct.bajoSeguridad + ct.bajoObjetivo + ct.enRango + ct.exceso;
  return {
    valorizacion: total.valorActual, valorIdeal: total.valorIdeal, capitalInmovilizado: total.capitalInmovilizado,
    pctCapitalInmovilizado: div(total.capitalInmovilizado, total.valorActual),
    pctDentroPolitica: n ? (ct.bajoObjetivo + ct.enRango) / n : null,
    skusPorEstado: { bajoSeguridad: ct.bajoSeguridad, bajoObjetivo: ct.bajoObjetivo, enRango: ct.enRango, exceso: ct.exceso },
    desviacion: { ...Object.fromEntries(clases.map((c) => [c.clase, c.desviacion])), Total: ct.desviacion },
    rotacionReal: total.rotacionReal, pctSinMovimiento: total.pctSinMovimiento, sinMovimiento: total.sinMovimiento,
  };
}

export interface KpisCompras {
  /** Proyección vigente del horizonte ($). */
  totalCompra: number;
  /** N2.2: compras de urgencia (respaldo + faltante) sobre el total de compra + faltante. */
  urgencia: number;
  totalConUrgencia: number;
  pctUrgencia: number | null;
}

export function kpisCompras(filas: FilaCompleta[]): KpisCompras {
  const totalCompra = sum(filas.map((f) => f.rdt));
  const urgencia = sum(filas.map((f) => f.ev));
  const totalConUrgencia = totalCompra + sum(filas.map((f) => f.o0));
  return { totalCompra, urgencia, totalConUrgencia, pctUrgencia: div(urgencia, totalConUrgencia) };
}

export interface CompraPorCategoria {
  categoria: string;
  /** Compra por mes del horizonte ($) y total. */
  meses: number[];
  total: number;
  /** Órdenes a emitir por mes ($). */
  emitir: number[];
}

/** Compra (llegadas) y órdenes a emitir por categoría y mes del horizonte. */
export function compraPorCategoria(filas: FilaCompleta[]): CompraPorCategoria[] {
  const por = new Map<string, FilaCompleta[]>();
  for (const f of filas) por.set(f.cat, [...(por.get(f.cat) ?? []), f]);
  const g = (fs: FilaCompleta[], pre: 'rd' | 'o', j: number) => sum(fs.map((f) => (f as unknown as Record<string, number>)[`${pre}${j}`] ?? 0));
  return [...por]
    .map(([categoria, fs]) => ({
      categoria,
      meses: [1, 2, 3, 4].map((j) => g(fs, 'rd', j)),
      total: sum(fs.map((f) => f.rdt)),
      emitir: [1, 2, 3, 4].map((j) => g(fs, 'o', j)),
    }))
    .sort((a, b) => b.total - a.total);
}

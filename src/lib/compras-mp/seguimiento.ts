// Seguimiento: cumplimiento del presupuesto aprobado contra las llegadas físicas reales de cada mes cerrado
// (hoja Seguimiento y columnas FQ–HA de "Cálculo SKU" del libro v12). Función pura.
//
// Llegadas reales de un mes = stock de fin de mes − stock de fin del mes anterior + consumo del mes (nunca negativas).
// El real se valoriza al costo con el que se presupuestó. Un mes cuenta como "cerrado" cuando ya pasó el corte y hay
// stock de fin de mes de ese mes.
import type { FilaVersion } from './versiones';
import type { HistoriaStockProducto } from './inventario';

export interface CatalogoProducto {
  sku: string;
  cat: string;
  abc?: string;
}

export interface EntradaSeguimiento {
  filasVersion: FilaVersion[];
  /** Meses de la versión (AAAA-MM). */
  horizonte: string[];
  /** Último mes cerrado a la fecha (AAAA-MM). */
  corte: string;
  /** Año al que corresponde el índice 0 del stock (el 31-dic del año anterior): índice del mes = (año − anioStock) × 12 + mes. */
  anioStock: number;
  /** Cantidad de cierres que trae el stock (el índice más alto disponible + 1). */
  cierresDeStock: number;
  stock: Map<number, HistoriaStockProducto>;
  /** Consumo real por producto y mes (AAAA-MM). */
  consumo: Map<number, Map<string, number>>;
  /** Productos de hoy (para los que no estaban en la versión aprobada) y su costo actual. */
  catalogo: Map<number, CatalogoProducto & { costoActual: number }>;
  /** Facturado por producto y mes (referencia), clave `${productId}|${AAAA-MM}`. */
  facturado?: Map<string, number>;
}

export interface MesSeguimiento {
  mes: string;
  cerrado: boolean;
  aprobado: number;
  real: number;
}

export interface FilaSeguimiento {
  productId: number;
  sku: string;
  cat: string;
  abc: string;
  costoPresupuesto: number;
  /** Por mes del horizonte: aprobado ($), llegadas reales (u) y real ($, solo meses cerrados). */
  aprobadoMes: number[];
  realMes: number[];
  aprobadoCerradoU: number;
  realU: number;
  aprobadoCerrado: number;
  real: number;
  desvio: number;
  cumplimiento: number | null;
  facturado: number;
}

export interface CategoriaSeguimiento {
  categoria: string;
  aprobadoMes: number[];
  realMes: number[];
  aprobadoCerrado: number;
  real: number;
  cumplimiento: number | null;
  desvio: number;
  facturado: number;
}

export interface PrecisionCategoria {
  categoria: string;
  /** Consumo proyectado en la versión aprobada ($) y consumo real ($), del mes. */
  pronostico: number;
  consumoReal: number;
  errorPct: number | null;
}

export interface ResultadoSeguimiento {
  meses: MesSeguimiento[];
  mesesCerrados: string[];
  filas: FilaSeguimiento[];
  categorias: CategoriaSeguimiento[];
  total: { aprobadoMes: number[]; realMes: number[]; aprobadoCerrado: number; real: number; cumplimiento: number | null; desvio: number; facturado: number };
  /** Mes usado para medir la precisión del pronóstico (el último mes cerrado de la versión) y su detalle. */
  precision: { mes: string | null; porCategoria: PrecisionCategoria[]; total: PrecisionCategoria | null };
}

const clave = (mes: string) => Number(mes.replace('-', ''));
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function calcularSeguimiento(inp: EntradaSeguimiento): ResultadoSeguimiento {
  const [anioCorte, mesCorte] = inp.corte.split('-').map(Number) as [number, number];
  const indice = (mes: string) => {
    const [y, m] = mes.split('-').map(Number) as [number, number];
    return (y - inp.anioStock) * 12 + m;
  };
  // Un mes está cerrado si ya pasó el corte y el stock de su fin de mes está cargado con datos. Se mira que haya productos con stock
  // positivo (no la suma total: un solo producto con un stock negativo absurdo en Odoo la volvería inservible).
  const hayStockEn = (i: number) => {
    for (const h of inp.stock.values()) if ((h.cantidad[i] ?? 0) > 0) return true;
    return false;
  };
  const cerrado = (mes: string) => clave(mes) <= anioCorte * 100 + mesCorte && indice(mes) >= 1 && indice(mes) < inp.cierresDeStock && hayStockEn(indice(mes));
  const meses = inp.horizonte;
  const flags = meses.map(cerrado);

  const porProducto = new Map<number, FilaVersion[]>();
  for (const f of inp.filasVersion) porProducto.set(f.productId, [...(porProducto.get(f.productId) ?? []), f]);
  const ids = new Set<number>([...porProducto.keys(), ...inp.catalogo.keys()]);

  const filas: FilaSeguimiento[] = [];
  for (const id of ids) {
    const fv = porProducto.get(id) ?? [];
    const cat = inp.catalogo.get(id);
    const costoPresupuesto = fv[0]?.costo ?? cat?.costoActual ?? 0;
    const aprobadoMes = meses.map((m) => fv.find((x) => x.mes === m)?.llegadaArs ?? 0);
    const aprobadoU = meses.map((m) => fv.find((x) => x.mes === m)?.llegadaU ?? 0);
    const h = inp.stock.get(id);
    const realU = meses.map((m, i) => {
      if (!flags[i]) return 0;
      const ix = indice(m);
      const consumo = inp.consumo.get(id)?.get(m) ?? 0;
      return Math.max(0, (h?.cantidad[ix] ?? 0) - (h?.cantidad[ix - 1] ?? 0) + consumo);
    });
    const realMes = realU.map((u) => u * costoPresupuesto);
    const sumaCerrada = (xs: number[]) => xs.reduce((s, v, i) => s + (flags[i] ? v : 0), 0);
    const aprobadoCerrado = sumaCerrada(aprobadoMes), real = sumaCerrada(realMes);
    const facturado = meses.reduce((s, m, i) => s + (flags[i] ? (inp.facturado?.get(`${id}|${m}`) ?? 0) : 0), 0);
    if (!fv.length && real === 0 && facturado === 0) continue;   // sin presupuesto ni movimiento: no aporta
    filas.push({
      productId: id, sku: fv[0]?.sku ?? cat?.sku ?? String(id), cat: fv[0]?.cat ?? cat?.cat ?? 'Otros', abc: cat?.abc ?? '', costoPresupuesto,
      aprobadoMes, realMes, aprobadoCerradoU: sumaCerrada(aprobadoU), realU: realU.reduce((s, v) => s + v, 0), aprobadoCerrado, real,
      desvio: real - aprobadoCerrado, cumplimiento: div(real, aprobadoCerrado), facturado,
    });
  }
  filas.sort((a, b) => b.aprobadoCerrado - a.aprobadoCerrado || b.aprobadoMes.reduce((s, v) => s + v, 0) - a.aprobadoMes.reduce((s, v) => s + v, 0));

  const porCat = new Map<string, FilaSeguimiento[]>();
  for (const f of filas) porCat.set(f.cat, [...(porCat.get(f.cat) ?? []), f]);
  const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
  const sumMes = (fs: FilaSeguimiento[], k: 'aprobadoMes' | 'realMes') => meses.map((_, i) => sum(fs.map((f) => f[k][i] ?? 0)));
  const categorias: CategoriaSeguimiento[] = [...porCat]
    .sort((a, b) => a[0].localeCompare(b[0], 'es'))
    .map(([categoria, fs]) => {
      const aprobadoCerrado = sum(fs.map((f) => f.aprobadoCerrado)), real = sum(fs.map((f) => f.real));
      return { categoria, aprobadoMes: sumMes(fs, 'aprobadoMes'), realMes: sumMes(fs, 'realMes'), aprobadoCerrado, real, cumplimiento: div(real, aprobadoCerrado), desvio: real - aprobadoCerrado, facturado: sum(fs.map((f) => f.facturado)) };
    });
  const aprobadoCerrado = sum(filas.map((f) => f.aprobadoCerrado)), real = sum(filas.map((f) => f.real));

  // Precisión del pronóstico: consumo proyectado en la versión vs consumo real, en el último mes cerrado de la versión.
  const iPrec = flags.lastIndexOf(true);
  const mesPrec = iPrec >= 0 ? (meses[iPrec] ?? null) : null;
  const precisionPorCat = new Map<string, { pron: number; real: number }>();
  if (mesPrec) {
    const costoDe = (id: number) => porProducto.get(id)?.[0]?.costo ?? inp.catalogo.get(id)?.costoActual ?? 0;
    for (const id of ids) {
      const fv = porProducto.get(id)?.find((x) => x.mes === mesPrec);
      const pron = (fv?.consumoProyU ?? 0) * costoDe(id);
      const consumo = (inp.consumo.get(id)?.get(mesPrec) ?? 0) * costoDe(id);
      if (!pron && !consumo) continue;
      const cat = porProducto.get(id)?.[0]?.cat ?? inp.catalogo.get(id)?.cat ?? 'Otros';
      const a = precisionPorCat.get(cat) ?? { pron: 0, real: 0 };
      precisionPorCat.set(cat, { pron: a.pron + pron, real: a.real + consumo });
    }
  }
  const mkPrec = (categoria: string, a: { pron: number; real: number }): PrecisionCategoria => ({
    categoria, pronostico: a.pron, consumoReal: a.real, errorPct: a.real > 0 ? (a.pron - a.real) / a.real : null,
  });
  const porCategoriaPrec = [...precisionPorCat].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([c, a]) => mkPrec(c, a));
  const totalPrec = porCategoriaPrec.length
    ? mkPrec('Total', { pron: sum(porCategoriaPrec.map((c) => c.pronostico)), real: sum(porCategoriaPrec.map((c) => c.consumoReal)) })
    : null;

  return {
    meses: meses.map((mes, i) => ({ mes, cerrado: flags[i] ?? false, aprobado: sum(filas.map((f) => f.aprobadoMes[i] ?? 0)), real: sum(filas.map((f) => f.realMes[i] ?? 0)) })),
    mesesCerrados: meses.filter((_, i) => flags[i]),
    filas, categorias,
    total: {
      aprobadoMes: sumMes(filas, 'aprobadoMes'), realMes: sumMes(filas, 'realMes'), aprobadoCerrado, real, cumplimiento: div(real, aprobadoCerrado),
      desvio: real - aprobadoCerrado, facturado: sum(filas.map((f) => f.facturado)),
    },
    precision: { mes: mesPrec, porCategoria: porCategoriaPrec, total: totalPrec },
  };
}

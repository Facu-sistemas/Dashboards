/**
 * Business rules for the Bandas cutting calculator — ported from the
 * standalone "Calculadora de Rollos de Bandas" tool. `MEDIDAS_LARGO` and the
 * timing constants below are curated shop-floor knowledge that has no
 * equivalent in Odoo (size → meters-per-band, time per cut/quilt/edge-bind).
 * The fabric color, en cambio, sí sale de Odoo: se resuelve del lado del
 * servidor a partir de la lista de materiales (BOM) de cada producto contra
 * la tabla "CODIGO DE COLORES TELAS" (ver `getBandasPlanificacion` en
 * lib/odoo/bandas.ts) — `tela` llega ya resuelta en cada fila, no se deriva
 * más del código del producto acá.
 * Pure/isomorphic on purpose (no Odoo, no DOM) so it runs client-side.
 */

/** Vocabulario de colores para el selector manual de stock — no participa en ningún cálculo, solo llena el <select>. */
export const TELAS_LIST: string[] = ['AZUL', 'BORDO', 'GRIS OSCURO', 'MARRON', 'NEGRO', 'TELA INFANTIL'];

export const MEDIDAS_LARGO: Record<string, number> = {
  '70X190': 5.22,
  '80X190': 5.46,
  '80X200': 5.66,
  '90X190': 5.66,
  '90X200': 5.86,
  '100X190': 5.86,
  '100X200': 6.06,
  '130X190': 6.46,
  '140X190': 6.66,
  '140X200': 6.86,
  '150X190': 6.86,
  '150X200': 7.06,
  '160X190': 7.06,
  '160X200': 7.26,
  '180X190': 7.46,
  '180X200': 7.66,
  '200X190': 7.86,
  '200X200': 8.06,
};

export const ANCHO_ROLLO = 210;
export const MIN_ROLLO_GRANDE = 40;
export const SEG_ROLLO_CHICO = 106;

export function calcRollos(metros: number): number {
  return Math.ceil(metros / 50);
}

export function calcRollosGrandes(sumAltoRollo: number): number {
  const v = sumAltoRollo / 200;
  const d = v - Math.floor(v);
  return d < 0.05 ? Math.floor(v) : Math.ceil(v);
}

export function fmtTiempo(seg: number): string {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = Math.round(seg % 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min${s > 0 ? ` ${s} seg` : ''}`;
  return `${s} seg`;
}

export function extractMedida(producto: string): string | null {
  let m = producto.match(/([0-9]{5,6})/);
  if (m) {
    const n = m[1]!;
    return n.slice(0, -3) + 'X' + n.slice(-3);
  }
  m = producto.match(/([0-9]{2,3}X[0-9]{3})/i);
  return m ? m[1]!.toUpperCase() : null;
}

export function extractAlto(producto: string): number | null {
  const m = producto.match(/ALTO([0-9]+)/);
  return m ? parseInt(m[1]!, 10) : null;
}

export interface RawRow {
  fecha: string;
  producto: string;
  cantidad: number;
  /** Ya resuelto del lado del servidor (BOM → tabla de colores). */
  tela: string | null;
}

export interface ParsedRow {
  fecha: string;
  producto: string;
  cantidad: number;
  tela: string | null;
  medida: string | null;
  alto: number | null;
  largo: number | null;
  metros: number;
}

export function parseRows(data: RawRow[]): { rows: ParsedRow[]; warns: string[] } {
  const rows: ParsedRow[] = [];
  const warns: string[] = [];
  for (const r of data) {
    const producto = String(r.producto || '').trim().toUpperCase();
    const cantidad = Number(r.cantidad) || 0;
    if (!producto.includes('BANDA-')) continue;
    const tela = r.tela;
    const medida = extractMedida(producto);
    const alto = extractAlto(producto);
    const largo = medida ? (MEDIDAS_LARGO[medida] ?? null) : null;
    if (!largo) warns.push(`Sin largo para medida "${medida}" → ${producto}`);
    const metros = largo ? largo * cantidad : 0;
    rows.push({ fecha: r.fecha, producto, cantidad, tela, medida, alto, largo: largo ?? null, metros });
  }
  return { rows, warns };
}

export type StockMap = Record<string, number>; // "TELA||ALTO" -> cantidad

export function stockKey(tela: string, alto: number): string {
  return `${tela}||${alto}`;
}

export interface CorteRow {
  fecha: string;
  tela: string | null;
  alto: number | null;
  metros: number;
  rollos: number;
  rollosDescontados: number;
  altoRollo: number;
}

/** Groups by fecha+tela+alto, converts meters to small rolls, and discounts any manually-tracked leftover stock for that tela+alto. */
export function calcCorte(rows: ParsedRow[], stock: StockMap): CorteRow[] {
  const map = new Map<string, { fecha: string; tela: string | null; alto: number | null; metros: number }>();
  for (const r of rows) {
    if (!r.metros) continue;
    const k = `${r.fecha}||${r.tela ?? ''}||${r.alto ?? ''}`;
    const existing = map.get(k);
    if (existing) existing.metros += r.metros;
    else map.set(k, { fecha: r.fecha, tela: r.tela, alto: r.alto, metros: r.metros });
  }

  const stockRestante = { ...stock };

  return [...map.values()].map((g) => {
    const sk = stockKey(g.tela ?? '', g.alto ?? 0);
    let rollosNecesarios = calcRollos(g.metros);
    let rollosDescontados = 0;

    const disponible = stockRestante[sk] ?? 0;
    if (disponible > 0) {
      rollosDescontados = Math.min(disponible, rollosNecesarios);
      stockRestante[sk] = disponible - rollosDescontados;
      rollosNecesarios -= rollosDescontados;
    }

    const rollos = rollosNecesarios;
    const altoRollo = (g.alto ?? 0) * rollos;
    return { ...g, rollos, rollosDescontados, altoRollo };
  });
}

/**
 * Vista de la tabla "Corte de bandas" (y su PDF) para altos con pillow — un
 * alto como 34 no se corta de un solo tirón, se arma con la receta de la
 * tabla "CORTE ALTO DE BANDA" de Odoo (ej. "8, 18, 8" para el 34: 2 rollos
 * de 8cm + 1 de 18cm por cada rollo de 34 — la cantidad de cada componente
 * es literal, sin multiplicar por ningún factor extra). Los componentes
 * resultantes se fusionan con cualquier otra fila (nativa o de otra receta)
 * que termine teniendo el mismo tela+alto ese día — por eso el 18cm de dos
 * recetas distintas se suma en una sola fila, mientras que sus otros
 * componentes (7cm, 8cm, etc.) quedan separados por ser altos distintos.
 * Los altos sin receta (pillow=no) se muestran igual que antes, tal cual.
 * Solo afecta esta vista: Matelaseadora y Optimización de corte siguen
 * trabajando con `calcCorte` sin expandir, tal como se venía haciendo.
 */
export function calcCorteVisual(corte: CorteRow[], recetaPorAlto: Record<number, Record<number, number>>): CorteRow[] {
  const map = new Map<string, CorteRow>();

  const add = (fecha: string, tela: string | null, alto: number | null, rollos: number, rollosDescontados: number) => {
    const k = `${fecha}||${tela ?? ''}||${alto ?? ''}`;
    const existing = map.get(k);
    if (existing) {
      existing.rollos += rollos;
      existing.rollosDescontados += rollosDescontados;
      existing.altoRollo = (alto ?? 0) * existing.rollos;
    } else {
      map.set(k, { fecha, tela, alto, metros: 0, rollos, rollosDescontados, altoRollo: (alto ?? 0) * rollos });
    }
  };

  for (const r of corte) {
    const receta = r.alto !== null ? recetaPorAlto[r.alto] : undefined;
    if (receta && Object.keys(receta).length > 0) {
      for (const [altoComponenteStr, cantidadPorUnidad] of Object.entries(receta)) {
        add(r.fecha, r.tela, Number(altoComponenteStr), cantidadPorUnidad * r.rollos, 0);
      }
    } else {
      add(r.fecha, r.tela, r.alto, r.rollos, r.rollosDescontados);
    }
  }

  return [...map.values()];
}

export interface MatelRow {
  fecha: string;
  tela: string | null;
  sumAltoRollo: number;
  rollosGrandes: number;
}

export function calcMatel(corte: CorteRow[]): MatelRow[] {
  const map = new Map<string, { fecha: string; tela: string | null; sumAltoRollo: number }>();
  for (const r of corte) {
    const k = `${r.fecha}||${r.tela ?? ''}`;
    const existing = map.get(k);
    if (existing) existing.sumAltoRollo += r.altoRollo;
    else map.set(k, { fecha: r.fecha, tela: r.tela, sumAltoRollo: r.altoRollo });
  }
  return [...map.values()].map((g) => ({ ...g, rollosGrandes: calcRollosGrandes(g.sumAltoRollo) }));
}

export interface RolloGrande {
  id: number;
  tiras: number[];
  usado: number;
  desp: number;
}

export interface OptimizacionTela {
  tela: string;
  rollones: RolloGrande[];
  totalRollos: number;
  totalDesp: number;
  eficiencia: string;
}

/**
 * Bin packing (best-fit decreasing) per tela: combines all its cut heights
 * (regardless of fecha) into as few 210cm-wide big rolls as possible.
 */
export function optimizarCorte(corteRows: CorteRow[]): OptimizacionTela[] {
  const porTela = new Map<string, Map<number, number>>();
  for (const r of corteRows) {
    if (!r.alto || !r.rollos) continue;
    const t = r.tela || 'Sin tela';
    let altoMap = porTela.get(t);
    if (!altoMap) {
      altoMap = new Map();
      porTela.set(t, altoMap);
    }
    altoMap.set(r.alto, (altoMap.get(r.alto) ?? 0) + r.rollos);
  }

  const resultados: OptimizacionTela[] = [];

  for (const [tela, altoMap] of porTela) {
    const items: number[] = [];
    for (const [alto, qty] of altoMap) {
      for (let i = 0; i < qty; i++) items.push(alto);
    }
    items.sort((a, b) => b - a);

    const bins: number[][] = [];
    for (const item of items) {
      let bestBin = -1;
      let bestRem = ANCHO_ROLLO + 1;
      for (let i = 0; i < bins.length; i++) {
        const used = bins[i]!.reduce((s, x) => s + x, 0);
        const rem = ANCHO_ROLLO - used;
        if (rem >= item && rem - item < bestRem) {
          bestBin = i;
          bestRem = rem - item;
        }
      }
      if (bestBin >= 0) bins[bestBin]!.push(item);
      else bins.push([item]);
    }

    let totalDesp = 0;
    const rollones: RolloGrande[] = bins.map((bin, idx) => {
      const usado = bin.reduce((s, x) => s + x, 0);
      const desp = ANCHO_ROLLO - usado;
      totalDesp += desp;
      return { id: idx + 1, tiras: [...bin].sort((a, b) => b - a), usado, desp };
    });

    const totalUsado = bins.length * ANCHO_ROLLO - totalDesp;
    const eficiencia = ((totalUsado / (bins.length * ANCHO_ROLLO || 1)) * 100).toFixed(1);

    resultados.push({ tela, rollones, totalRollos: bins.length, totalDesp, eficiencia });
  }

  return resultados;
}

/**
 * Última foto conocida de las tablas "Corte Banda (cm)/Pillow", "TIEMPO" y
 * "CORTE ALTO DE BANDA" del dashboard Odoo "Indicador_cierre" — se usa solo
 * si Odoo no responde; en uso normal, `BandasTablasOdoo` llega en vivo desde
 * `/api/bandas-tablas-odoo` (ver `getBandasTablasOdoo` en lib/odoo/bandas.ts).
 */
export const PILLOW_POR_ALTO_FALLBACK: Record<number, boolean> = {
  14: false,
  16: false,
  20: false,
  21: false,
  23: false,
  25: false,
  27: false,
  28: false,
  29: false,
  32: true,
  34: true,
  35: true,
  38: true,
};

export const TIEMPO_EURO_SEG_FALLBACK = 540;
export const TIEMPO_NOVOL_SEG_FALLBACK = 840;

export const RECETA_ALTO_FALLBACK: Record<number, Record<number, number>> = {
  32: { 7: 2, 18: 1 },
  34: { 8: 2, 18: 1 },
  35: { 8.5: 2, 18: 1 },
  38: { 10: 2, 18: 1 },
};

/** Códigos de tela (componente de la BOM) → color, tal como figuran en "CODIGO DE COLORES TELAS". */
export const COLOR_POR_CODIGO_FALLBACK: Record<string, string> = {
  V368: 'NEGRO',
  V406: 'GRIS OSCURO',
  V379: 'AZUL',
  V370: 'MARRON',
  V377: 'BORDO',
};

export interface BandasTablasOdoo {
  pillowPorAlto: Record<number, boolean>;
  euroSeg: number;
  novolSeg: number;
  recetaPorAlto: Record<number, Record<number, number>>;
  colorPorCodigo: Record<string, string>;
}

export const BANDAS_TABLAS_FALLBACK: BandasTablasOdoo = {
  pillowPorAlto: PILLOW_POR_ALTO_FALLBACK,
  euroSeg: TIEMPO_EURO_SEG_FALLBACK,
  novolSeg: TIEMPO_NOVOL_SEG_FALLBACK,
  recetaPorAlto: RECETA_ALTO_FALLBACK,
  colorPorCodigo: COLOR_POR_CODIGO_FALLBACK,
};

/** Altos fuera de la tabla caen al mismo corte (>=29 = con pillow) que separa los valores conocidos. */
function tienePillow(alto: number | null, pillowPorAlto: Record<number, boolean>): boolean {
  if (alto === null) return false;
  const conocido = pillowPorAlto[alto];
  return conocido !== undefined ? conocido : alto >= 29;
}

export interface EnvivadoRow {
  fecha: string;
  tela: string | null;
  alto: number | null;
  seg: number;
  tipo: string;
  totalSeg: number;
  rollos: number;
}

export const TIPO_NOVOL = 'NOVOL';
export const TIPO_EURO = 'EURO P';

/**
 * Agrupa por fecha+tela+alto+tipo — antes había una fila por cada línea de
 * Odoo (una por medida), y como todas las medidas de un mismo tela+alto
 * comparten el mismo `rollos`, se veían filas repetidas y el tiempo total
 * las sumaba todas, inflándolo. Filtra las bandas sin pillow (no llevan
 * envivado, no deben verse en el resumen ni en el PDF) — salvo que sean
 * NOVOL, que siempre se muestran aunque su alto figure como "sin pillow" en
 * la tabla. `rollos` es el mismo valor de la fila fecha+tela+alto en
 * `calcCorte` (sin expandir por receta: el envivado se hace sobre la pieza
 * terminada, no sobre las tiras en las que se corta después).
 */
export function calcEnvivado(rows: ParsedRow[], config: BandasTablasOdoo, corte: CorteRow[]): { envRows: EnvivadoRow[]; totalSeg: number } {
  const rollosPorGrupo = new Map<string, number>();
  for (const c of corte) {
    rollosPorGrupo.set(`${c.fecha}||${c.tela ?? ''}||${c.alto ?? ''}`, c.rollos);
  }

  const grupos = new Map<string, { fecha: string; tela: string | null; alto: number | null; tipo: string; seg: number }>();
  for (const r of rows) {
    const esNovol = r.producto.toUpperCase().includes('NOVOL');
    if (!esNovol && !tienePillow(r.alto, config.pillowPorAlto)) continue;
    const seg = esNovol ? config.novolSeg : config.euroSeg;
    const tipo = esNovol ? TIPO_NOVOL : TIPO_EURO;
    const k = `${r.fecha}||${r.tela ?? ''}||${r.alto ?? ''}||${tipo}`;
    if (!grupos.has(k)) grupos.set(k, { fecha: r.fecha, tela: r.tela, alto: r.alto, tipo, seg });
  }

  let totalSeg = 0;
  const envRows: EnvivadoRow[] = [];
  for (const g of grupos.values()) {
    const rollos = rollosPorGrupo.get(`${g.fecha}||${g.tela ?? ''}||${g.alto ?? ''}`) ?? 0;
    const rowTotalSeg = g.seg * rollos;
    totalSeg += rowTotalSeg;
    envRows.push({ ...g, totalSeg: rowTotalSeg, rollos });
  }
  return { envRows, totalSeg };
}

export interface SobranteTira {
  alto: number;
  cantidad: number;
}

const MINIMO_TIRA = 16;

/** Given a leftover width and a list of heights ordered by how often they appear, greedily cuts strips worth saving (>= 16cm). */
export function calcularTirasSobrantes(desperdicio: number, altosOrdenados: number[]): { tiras: SobranteTira[]; descarte: number } {
  const tiras: SobranteTira[] = [];
  let resto = desperdicio;
  for (const alto of altosOrdenados) {
    if (resto < MINIMO_TIRA) break;
    if (alto <= resto) {
      const cantidad = Math.floor(resto / alto);
      if (cantidad > 0) {
        tiras.push({ alto, cantidad });
        resto -= alto * cantidad;
      }
    }
  }
  return { tiras, descarte: resto < MINIMO_TIRA ? resto : 0 };
}

export interface SobranteRollo {
  tela: string;
  rolloId: number;
  desperdicio: number;
  tiras: SobranteTira[];
  descarte: number;
}

/** For every big roll left with waste, suggests how to cut that waste into strips worth keeping as stock, based on which heights are actually needed most for this tela. */
export function calcularSobrantes(optData: OptimizacionTela[], corteRows: CorteRow[]): SobranteRollo[] {
  const freqPorTela = new Map<string, Map<number, number>>();
  for (const r of corteRows) {
    if (!r.tela || !r.alto || !r.rollos) continue;
    let freq = freqPorTela.get(r.tela);
    if (!freq) {
      freq = new Map();
      freqPorTela.set(r.tela, freq);
    }
    freq.set(r.alto, (freq.get(r.alto) ?? 0) + r.rollos);
  }

  const altosPorTela = new Map<string, number[]>();
  for (const [tela, freq] of freqPorTela) {
    altosPorTela.set(
      tela,
      [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([alto]) => alto),
    );
  }

  const sobrantes: SobranteRollo[] = [];
  for (const d of optData) {
    const altos = altosPorTela.get(d.tela) ?? [];
    for (const r of d.rollones) {
      if (r.desp === 0) continue;
      const { tiras, descarte } = calcularTirasSobrantes(r.desp, altos);
      if (tiras.length > 0) sobrantes.push({ tela: d.tela, rolloId: r.id, desperdicio: r.desp, tiras, descarte });
    }
  }
  return sobrantes;
}

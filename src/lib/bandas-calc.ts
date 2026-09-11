/**
 * Business rules for the Bandas cutting calculator — ported from the
 * standalone "Calculadora de Rollos de Bandas" tool. `TELAS`, `MEDIDAS_LARGO`
 * and the timing constants below are curated shop-floor knowledge that has
 * no equivalent in Odoo (fabric code → color, size → meters-per-band, time
 * per cut/quilt/edge-bind) — only the raw (fecha, producto, cantidad) rows
 * come from Odoo now; everything else here is unchanged from the original.
 * Pure/isomorphic on purpose (no Odoo, no DOM) so it runs client-side.
 */

export const TELAS: Record<string, string> = {
  BAZUL: 'AZUL',
  BBORD: 'BORDO',
  BGRIS: 'GRIS CLARO',
  BMARR: 'MARRON',
  BNEGR: 'NEGRO',
  EAPOL: 'BORDO',
  EARES: 'NEGRO',
  EBABY: 'TELA INFANTIL',
  ECOMF: 'NEGRO',
  ECOMFY: 'GRIS OSCURO',
  ECORO: 'NEGRO',
  EDIAM: 'NEGRO',
  EELIO: 'NEGRO',
  EESME: 'NEGRO',
  EHARM: 'GRIS OSCURO',
  EHEFE: 'GRIS OSCURO',
  EJENS: 'NEGRO',
  EMARK: 'MARRON',
  ERELA: 'NEGRO',
  EREST: 'NEGRO',
  ESELE: 'MARRON',
  ESENS: 'NEGRO',
  ESERE: 'GRIS OSCURO',
  ESIEN: 'GRIS CLARO',
  ETROP: 'NEGRO',
  EVIRT: 'AZUL',
  EZAFI: 'NEGRO',
  FHOTE: 'NEGRO',
  POSURE: 'NEGRO',
  POZINU: 'GRIS OSCURO',
  RARES: 'NEGRO',
  RCOMF: 'NEGRO',
  RCORO: 'NEGRO',
  RJENS: 'NEGRO',
  RRELA: 'NEGRO',
  RSENS: 'NEGRO',
  RVIRT: 'AZUL',
  POSELE: 'MARRON',
  TMAGN: 'GRIS OSCURO',
};

export const TELAS_LIST: string[] = [...new Set(Object.values(TELAS))].sort();

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

export function extractCodigo(producto: string): string | null {
  const m = producto.match(/BANDA-([A-Z]+)/);
  return m ? m[1]! : null;
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
    const codigo = extractCodigo(producto);
    const tela = codigo ? (TELAS[codigo] ?? null) : null;
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

export function tiempoEnvivadoPorBanda(producto: string, alto: number | null): number {
  if (producto && producto.toUpperCase().includes('NOVOL')) return 114; // 1:54
  if (alto && alto < 29) return 0;
  return 128; // 2:08
}

export interface EnvivadoRow extends ParsedRow {
  seg: number;
  tipo: string;
  totalSeg: number;
}

export const TIPO_NOVOL = 'NOVOL (1:54)';
export const TIPO_BAJO = 'Alto < 29 (sin envivado)';
export const TIPO_STD = 'Estándar (2:08)';

export function calcEnvivado(rows: ParsedRow[]): { envRows: EnvivadoRow[]; totalSeg: number } {
  let totalSeg = 0;
  const envRows = rows.map((r) => {
    const seg = tiempoEnvivadoPorBanda(r.producto, r.alto);
    const tipo = r.producto.toUpperCase().includes('NOVOL') ? TIPO_NOVOL : r.alto && r.alto < 29 ? TIPO_BAJO : TIPO_STD;
    const rowTotalSeg = seg * r.cantidad;
    totalSeg += rowTotalSeg;
    return { ...r, seg, tipo, totalSeg: rowTotalSeg };
  });
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

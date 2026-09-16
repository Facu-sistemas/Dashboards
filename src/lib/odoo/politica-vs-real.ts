import { searchReadAll } from './client';
import { fetchAverageDailyConsumption, MATERIA_PRIMA_CATEG_ID } from './raw-material-consumption';
import { getFronteraCompany } from './reference';

const DEMANDA_LOOKBACK_DAYS = 90;

export type ClaseAbc = 'A' | 'B' | 'C';

export interface PoliticaVsRealGroupRow {
  groupKey: string;
  groupName: string;
  capitalObjetivo: number;
  capitalReal: number;
  desviacionAbs: number;
  desviacionPct: number | null;
}

export interface PoliticaVsRealResult {
  porCategoria: PoliticaVsRealGroupRow[];
  porClaseAbc: PoliticaVsRealGroupRow[];
  total: PoliticaVsRealGroupRow;
}

type ProductRow = {
  id: number;
  name: string;
  categ_id: [number, string] | false;
  qty_available: number;
  standard_price: number;
};

/**
 * TODO: reemplazar por la fórmula real de Mínimo — bloqueante pendiente de
 * definir con negocio: fórmula exacta de Lead Time Efectivo, fórmula exacta
 * de Días de Stock de Seguridad, y dónde vive la Política Manual como
 * override (ver plan-tab-politica-vs-real.md §3.3). Mock: política de
 * cobertura fija de 30 días para todos los SKU.
 */
const POLITICA_COBERTURA_DIAS_MOCK = 30;
function calcularMinimo(demandaDiaria: number): number {
  return POLITICA_COBERTURA_DIAS_MOCK * demandaDiaria;
}

/**
 * TODO: reemplazar por la fórmula real de Clase ABC — bloqueante pendiente
 * de definir con negocio: criterio exacto de corte (% acumulado de valor de
 * consumo) y qué es la clase "S-M" (ver plan-tab-politica-vs-real.md §3.3).
 * Mock: corte tipo Pareto 80/15/5 sobre capital real, SKU ordenados
 * descendente por capital real.
 */
function calcularClaseABC(sortedByCapitalRealDesc: { productId: number; capitalReal: number }[]): Map<number, ClaseAbc> {
  const total = sortedByCapitalRealDesc.reduce((sum, p) => sum + p.capitalReal, 0);
  const result = new Map<number, ClaseAbc>();
  let cumulative = 0;
  for (const p of sortedByCapitalRealDesc) {
    cumulative += p.capitalReal;
    const cumulativePct = total > 0 ? cumulative / total : 0;
    result.set(p.productId, cumulativePct <= 0.8 ? 'A' : cumulativePct <= 0.95 ? 'B' : 'C');
  }
  return result;
}

function emptyGroupRow(groupKey: string, groupName: string): PoliticaVsRealGroupRow {
  return { groupKey, groupName, capitalObjetivo: 0, capitalReal: 0, desviacionAbs: 0, desviacionPct: null };
}

function finalizeGroupRow(row: PoliticaVsRealGroupRow): PoliticaVsRealGroupRow {
  return {
    ...row,
    desviacionAbs: row.capitalReal - row.capitalObjetivo,
    desviacionPct: row.capitalObjetivo > 0 ? row.capitalReal / row.capitalObjetivo - 1 : null,
  };
}

/**
 * Costo Unitario por SKU = costo promedio de Odoo (`standard_price`); si
 * viene vacío (0, sin costeo cargado) usa el promedio de su categoría entre
 * los SKU que sí tienen costo — por SKU sin costo en ninguna parte, queda 0.
 */
function buildCostoUnitarioLookup(products: ProductRow[]): (p: ProductRow) => number {
  const costsByCateg = new Map<number, number[]>();
  for (const p of products) {
    if (!p.categ_id || p.standard_price <= 0) continue;
    const categId = p.categ_id[0];
    if (!costsByCateg.has(categId)) costsByCateg.set(categId, []);
    costsByCateg.get(categId)!.push(p.standard_price);
  }
  const avgByCateg = new Map<number, number>();
  for (const [categId, costs] of costsByCateg) {
    avgByCateg.set(categId, costs.reduce((sum, c) => sum + c, 0) / costs.length);
  }
  return (p: ProductRow) => {
    if (p.standard_price > 0) return p.standard_price;
    return (p.categ_id ? avgByCateg.get(p.categ_id[0]) : undefined) ?? 0;
  };
}

/**
 * Compara, por SKU de Materia Prima, el Capital Objetivo (Mínimo de
 * reposición × costo unitario) contra el Capital Real (stock disponible ×
 * costo unitario), agregado por categoría y por Clase ABC. Ver
 * plan-tab-politica-vs-real.md — Mínimo y Clase ABC usan fórmulas mock
 * (`calcularMinimo`/`calcularClaseABC` arriba) hasta que negocio defina las
 * reglas reales.
 */
export async function getPoliticaVsReal(): Promise<PoliticaVsRealResult> {
  const { companyId } = await getFronteraCompany();

  const products = await searchReadAll<ProductRow>({
    model: 'product.product',
    domain: [['categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID]],
    fields: ['name', 'categ_id', 'qty_available', 'standard_price'],
    order: 'name asc',
  });

  if (products.length === 0) {
    return { porCategoria: [], porClaseAbc: [], total: emptyGroupRow('total', 'Total') };
  }

  const productIds = products.map((p) => p.id);
  const demandaByProduct = await fetchAverageDailyConsumption(productIds, companyId, DEMANDA_LOOKBACK_DAYS);
  const costoUnitario = buildCostoUnitarioLookup(products);

  const perSku = products.map((p) => {
    const demandaDiaria = demandaByProduct.get(p.id) ?? 0;
    const costo = costoUnitario(p);
    const capitalObjetivo = calcularMinimo(demandaDiaria) * costo;
    const capitalReal = p.qty_available * costo;
    return {
      productId: p.id,
      categId: p.categ_id ? p.categ_id[0] : 0,
      categName: p.categ_id ? p.categ_id[1] : 'Sin categoría',
      capitalObjetivo,
      capitalReal,
    };
  });

  const sortedByCapitalRealDesc = [...perSku]
    .sort((a, b) => b.capitalReal - a.capitalReal)
    .map((p) => ({ productId: p.productId, capitalReal: p.capitalReal }));
  const claseByProduct = calcularClaseABC(sortedByCapitalRealDesc);

  const byCategoriaMap = new Map<number, PoliticaVsRealGroupRow>();
  const byClaseMap = new Map<ClaseAbc, PoliticaVsRealGroupRow>(
    (['A', 'B', 'C'] as ClaseAbc[]).map((c) => [c, emptyGroupRow(c, `Clase ${c}`)])
  );

  let totalObjetivo = 0;
  let totalReal = 0;

  for (const p of perSku) {
    if (!byCategoriaMap.has(p.categId)) byCategoriaMap.set(p.categId, emptyGroupRow(String(p.categId), p.categName));
    const categoriaRow = byCategoriaMap.get(p.categId)!;
    categoriaRow.capitalObjetivo += p.capitalObjetivo;
    categoriaRow.capitalReal += p.capitalReal;

    const clase = claseByProduct.get(p.productId) ?? 'C';
    const claseRow = byClaseMap.get(clase)!;
    claseRow.capitalObjetivo += p.capitalObjetivo;
    claseRow.capitalReal += p.capitalReal;

    totalObjetivo += p.capitalObjetivo;
    totalReal += p.capitalReal;
  }

  const porCategoria = [...byCategoriaMap.values()].map(finalizeGroupRow).sort((a, b) => b.capitalReal - a.capitalReal);
  const porClaseAbc = (['A', 'B', 'C'] as ClaseAbc[]).map((c) => finalizeGroupRow(byClaseMap.get(c)!));
  const total = finalizeGroupRow({ ...emptyGroupRow('total', 'Total'), capitalObjetivo: totalObjetivo, capitalReal: totalReal });

  return { porCategoria, porClaseAbc, total };
}

import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { getUsdToArsRate } from './currency';
import { getBomExplosion, getActiveModelsWithBom } from './bom-explosion';
import { getModelSalesMix, getMonthlyUnitsSold, type BusinessUnit, type ModelSalesShare } from './sales-mix';
import { getInsumoCosts, type InsumoCost } from './insumo-costs';
import { getHistoricalUsdArsRates } from './fx-historical';
import { withTtlCache, cacheKey } from '../cache';
import { monthsBetween, monthBounds, lastMonthKeys, currentMonthKey } from '../date';
import type { OdooDomain } from './types';

// Confirmed live (2026-09): `product.category` id 14 is "Materia Prima" —
// same id raw-material-consumption.ts already relies on for a different
// feature. Everything under it in the category tree is what this
// dashboard's Categoría→Insumo view covers; anything else real spend
// touches is "Fuera de Alcance".
const MATERIA_PRIMA_CATEG_ID = 14;

// Real purchase-line enrichment (join order dates + historical FX) is
// expensive enough over a full year to cache briefly, same reasoning as
// bom-explosion.ts's BOM_EXPLOSION_TTL_MS — short enough that a newly
// confirmed purchase order still shows up within a couple of page loads.
const REAL_COMPRAS_TTL_MS = 2 * 60 * 1000;

// Regla 4.4 — generic shared component detection & redistribution.
// A component qualifies as a "generic" candidate purely by BOM shape
// (referenced by many models, always ~1 per unit); confirming it's a
// TRUE generic (not a real, priced sub-assembly like a $600k upholstered
// "TAP ..." component that happens to also be used at qty≈1 everywhere)
// requires cost === 0, which is why this check lives here and not in
// bom-explosion.ts (which has no cost data). Confirmed live (2026-09):
// with a >=15-reference threshold, exactly two products in this catalog
// have cost 0 AND match the shape — "CORTE DE TELA 1" (4890 refs, the
// doc's own worked example) and "ETIQUETA BORDADA CALM" (36 refs).
const GENERIC_MIN_TEMPLATE_REFERENCES = 15;
const GENERIC_QTY_TOLERANCE = 0.05;

// How many fully-closed months of real spend/sales feed the empirical
// $/unit ratio calibration (section 4.4: "gasto real en tela de los
// últimos meses cerrados ÷ unidades reales producidas en esos mismos
// meses"). Never includes the current, still-open month.
const RATIO_CALIBRATION_MONTHS = 6;

// "Un mes donde un solo color se dispara... señal de error de compra
// puntual" — a month's spend on one specific insumo counts as an
// isolated spike (excluded from its historical mix weight) when it's
// more than this multiple of that insumo's own median non-zero month,
// AND no other insumo in the same family spiked the same month (a
// shared spike is real demand, not a data error — never excluded).
const OUTLIER_MULTIPLIER = 3;

/**
 * Maps a detected generic (by product name — like reference.ts elsewhere
 * in this codebase, matched by business identifier rather than a raw id
 * that isn't guaranteed stable across Odoo instances/upgrades) to the
 * real Materia Prima category its cost should be redistributed into, per
 * business unit. A generic with no entry here still gets detected and
 * listed as a gap (`componente-generico-sin-repartir`) — it just isn't
 * safe to redistribute without a human-confirmed target family, per the
 * doc's own instruction not to guess this from code alone.
 */
interface GenericFamilyConfig {
  genericProductName: string;
  targetCategoryNameByUnit: Partial<Record<BusinessUnit, string>>;
}
const GENERIC_FAMILY_CONFIG: GenericFamilyConfig[] = [
  {
    genericProductName: 'CORTE DE TELA 1',
    targetCategoryNameByUnit: { colchones: 'Tela Colchon', living: 'Tela Living' },
  },
];

export type ComplianceStatus = 'green' | 'yellow' | 'red' | 'no-data';

export interface InsumoMonthFigure {
  presupuestado: number | null;
  real: number;
  variancePct: number | null;
  compliancePct: number | null;
  status: ComplianceStatus;
}

export interface InsumoRow {
  productId: number;
  productName: string;
  months: Record<string, InsumoMonthFigure>;
  annual: InsumoMonthFigure;
}

export interface CategoryGroup {
  categoryId: number;
  categoryName: string;
  insumos: InsumoRow[];
  months: Record<string, InsumoMonthFigure>;
  annual: InsumoMonthFigure;
}

export type GapReason = 'sin-costo' | 'componente-generico-sin-repartir' | 'no-es-materia-prima' | 'posible-bom-circular';

export interface GapInsumo {
  productId: number;
  productName: string;
  reason: GapReason;
}

export interface PresupuestoDinamicoResult {
  year: number;
  months: string[];
  categories: CategoryGroup[];
  gaps: GapInsumo[];
  missingConsensoMonths: string[];
  missingTcMonths: string[];
  monthlyComplianceSummary: { month: string; compliancePct: number | null }[];
}

export interface FueraDeAlcanceCategoryRow {
  categoryId: number;
  categoryName: string;
  months: Record<string, number>;
  annual: number;
}

export interface FueraDeAlcanceResult {
  year: number;
  months: string[];
  categories: FueraDeAlcanceCategoryRow[];
}

// Tolerance band from INSTRUCCIONES_Dashboard_Presupuesto_Dinamico.md
// section 5. Yellow is a buffer zone the doc doesn't pin down exactly —
// adjust with Marlynet if it doesn't match her Excel's coloring.
const GREEN_MIN_PCT = 85;
const GREEN_MAX_PCT = 110;
const YELLOW_MIN_PCT = 70;
const YELLOW_MAX_PCT = 130;

function complianceStatus(pct: number | null): ComplianceStatus {
  if (pct === null) return 'no-data';
  if (pct >= GREEN_MIN_PCT && pct <= GREEN_MAX_PCT) return 'green';
  if (pct >= YELLOW_MIN_PCT && pct <= YELLOW_MAX_PCT) return 'yellow';
  return 'red';
}

function buildFigure(presupuestado: number | null, real: number): InsumoMonthFigure {
  const compliancePct = presupuestado !== null && presupuestado > 0 ? (real / presupuestado) * 100 : null;
  const variancePct = presupuestado !== null && presupuestado > 0 ? ((real - presupuestado) / presupuestado) * 100 : null;
  return { presupuestado, real, variancePct, compliancePct, status: complianceStatus(compliancePct) };
}

interface EnrichedPurchaseLines {
  /** key `${productId}|${YYYY-MM}` -> amount in ARS (USD lines converted at the historical rate of their order date; dropped, not guessed, if no rate is found for that date). */
  byProductMonth: Map<string, number>;
  involvedProductIds: Set<number>;
}

/** Real purchase spend for an explicit date range, by insumo and month, ARS (see fetchRealPurchaseLines for the conversion rule). Not filtered by category. */
async function fetchRealPurchaseLinesInRange(start: string, endExclusive: string): Promise<EnrichedPurchaseLines> {
  return withTtlCache(cacheKey('presupuesto-dinamico:real-range', { start, endExclusive }), REAL_COMPRAS_TTL_MS, async () => {
    const { companyId } = await getFronteraCompany();

    type LineRow = {
      id: number;
      price_subtotal: number;
      currency_id: [number, string];
      order_id: [number, string];
      product_id: [number, string] | false;
    };
    const domain: OdooDomain = [
      ['company_id', '=', companyId],
      ['order_id.state', '=', 'purchase'],
      ['order_id.date_order', '>=', start],
      ['order_id.date_order', '<', endExclusive],
    ];
    const lines = await searchReadAll<LineRow>({
      model: 'purchase.order.line',
      domain,
      fields: ['price_subtotal', 'currency_id', 'order_id', 'product_id'],
    });
    const withProduct = lines.filter((l): l is LineRow & { product_id: [number, string] } => Boolean(l.product_id));

    const orderIds = [...new Set(withProduct.map((l) => l.order_id[0]))];
    const orders = orderIds.length
      ? await searchReadAll<{ id: number; date_order: string }>({ model: 'purchase.order', domain: [['id', 'in', orderIds]], fields: ['date_order'] })
      : [];
    const orderDateById = new Map(orders.map((o) => [o.id, o.date_order]));

    const usdDates = [
      ...new Set(
        withProduct
          .filter((l) => l.currency_id[1] === 'USD')
          .map((l) => orderDateById.get(l.order_id[0]))
          .filter((d): d is string => Boolean(d))
      ),
    ];
    const fxRates = usdDates.length ? await getHistoricalUsdArsRates(usdDates) : new Map<string, number>();

    const byProductMonth = new Map<string, number>();
    const involvedProductIds = new Set<number>();
    for (const line of withProduct) {
      const dateOrder = orderDateById.get(line.order_id[0]);
      if (!dateOrder) continue; // orphaned reference, skip rather than mis-bucket

      let amountArs = line.price_subtotal;
      if (line.currency_id[1] === 'USD') {
        const rate = fxRates.get(dateOrder);
        if (rate === undefined) continue; // no historical rate for that exact date — drop rather than guess
        amountArs = line.price_subtotal * rate;
      }

      const productId = line.product_id[0];
      const key = `${productId}|${dateOrder.slice(0, 7)}`;
      byProductMonth.set(key, (byProductMonth.get(key) ?? 0) + amountArs);
      involvedProductIds.add(productId);
    }

    return { byProductMonth, involvedProductIds };
  });
}

/**
 * Real purchase spend for a whole year, by insumo and month. Not filtered
 * by category — getPresupuestoDinamicoData and getFueraDeAlcance each
 * slice this by Materia-Prima membership after the fact, so both views
 * share one fetch.
 */
async function fetchRealPurchaseLines(year: number): Promise<EnrichedPurchaseLines> {
  return fetchRealPurchaseLinesInRange(`${year}-01-01`, `${year + 1}-01-01`);
}

function isMateriaPrima(categId: number | null, parentById: Map<number, number | null>): boolean {
  let cur = categId;
  let guard = 0;
  while (cur !== null && guard++ < 10) {
    if (cur === MATERIA_PRIMA_CATEG_ID) return true;
    cur = parentById.get(cur) ?? null;
  }
  return false;
}

async function getCategoryParentMap(): Promise<Map<number, number | null>> {
  const rows = await searchReadAll<{ id: number; parent_id: [number, string] | false }>({
    model: 'product.category',
    fields: ['parent_id'],
  });
  return new Map(rows.map((r) => [r.id, r.parent_id ? r.parent_id[0] : null]));
}

/** median of a numeric array (0 for an empty array — "no history" reads as "no baseline", not zero spend). */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Historical consumption mix (0-1 share per product) for a family of
 * specific insumos, per regla 4.4: weighted by real spend over the
 * calibration window, EXCLUDING isolated outlier months — a month where
 * one product's spend spikes far above its own typical level while nothing
 * else in the family does. A spike shared across several products the
 * same month is a real business event (promo, big order) and is kept.
 */
function computeHistoricalMix(monthlyByProduct: Map<number, Map<string, number>>, months: string[]): Map<number, number> {
  const productIds = [...monthlyByProduct.keys()];

  const baselineByProduct = new Map<number, number>();
  for (const productId of productIds) {
    const monthly = monthlyByProduct.get(productId)!;
    const nonZero = months.map((m) => monthly.get(m) ?? 0).filter((v) => v > 0);
    baselineByProduct.set(productId, median(nonZero));
  }

  const isSpike = new Map<string, boolean>();
  for (const productId of productIds) {
    const monthly = monthlyByProduct.get(productId)!;
    const baseline = baselineByProduct.get(productId)!;
    for (const month of months) {
      const amount = monthly.get(month) ?? 0;
      isSpike.set(`${productId}|${month}`, baseline > 0 && amount > OUTLIER_MULTIPLIER * baseline);
    }
  }

  const spikeCountByMonth = new Map<string, number>();
  for (const month of months) {
    let count = 0;
    for (const productId of productIds) if (isSpike.get(`${productId}|${month}`)) count++;
    spikeCountByMonth.set(month, count);
  }

  const totalByProduct = new Map<number, number>();
  let grandTotal = 0;
  for (const productId of productIds) {
    const monthly = monthlyByProduct.get(productId)!;
    let sum = 0;
    for (const month of months) {
      const spike = isSpike.get(`${productId}|${month}`) ?? false;
      const isolated = spike && (spikeCountByMonth.get(month) ?? 0) <= 1;
      if (isolated) continue; // regla 4.4 — isolated outlier, excluded from the mix
      sum += monthly.get(month) ?? 0;
    }
    totalByProduct.set(productId, sum);
    grandTotal += sum;
  }

  const mix = new Map<number, number>();
  if (grandTotal <= 0) return mix;
  for (const [productId, sum] of totalByProduct) {
    if (sum > 0) mix.set(productId, sum / grandTotal);
  }
  return mix;
}

/**
 * Full regla 4.4 redistribution: for every configured generic family
 * actually present this year, calibrate a $/unit ratio from real closed-
 * month history (spend in the target category ÷ real units sold) and
 * spread each month's generic budget across the specific real insumos
 * using their historical purchase mix. Mutates `presupuestadoByProductMonth`
 * in place and returns which specific products received a redistributed
 * amount, so the caller can make sure they're included in the tree even
 * if they have no real spend in the requested year.
 */
async function redistributeGenericBudgets(params: {
  genericProductIds: Set<number>;
  costs: Map<number, InsumoCost>;
  consensoByMonthUnit: Map<string, number>;
  months: string[];
  missingConsensoMonths: Set<string>;
  presupuestadoByProductMonth: Map<string, number>;
}): Promise<{ redistributedProductIds: Set<number> }> {
  const { genericProductIds, costs, consensoByMonthUnit, months, missingConsensoMonths, presupuestadoByProductMonth } = params;
  const redistributedProductIds = new Set<number>();

  const genericNamesPresent = new Set(
    [...genericProductIds].map((id) => costs.get(id)?.productName?.trim().toUpperCase()).filter((n): n is string => Boolean(n))
  );

  for (const config of GENERIC_FAMILY_CONFIG) {
    if (!genericNamesPresent.has(config.genericProductName.toUpperCase())) continue; // not present in this catalog/year — nothing to redistribute

    for (const unit of ['colchones', 'living'] as const) {
      const targetCategoryName = config.targetCategoryNameByUnit[unit];
      if (!targetCategoryName) continue;

      // Last N fully-closed months — never the current, still-open one.
      const recent = lastMonthKeys(RATIO_CALIBRATION_MONTHS + 1);
      const calibrationMonths = recent.slice(0, -1);
      const calibrationStart = monthBounds(calibrationMonths[0]!).start;
      const calibrationEndExclusive = monthBounds(calibrationMonths[calibrationMonths.length - 1]!).endExclusive;

      const [calibrationLines, unitsSoldByMonth] = await Promise.all([
        fetchRealPurchaseLinesInRange(calibrationStart, calibrationEndExclusive),
        getMonthlyUnitsSold(unit, calibrationMonths),
      ]);

      const candidateIds = [...calibrationLines.involvedProductIds];
      if (candidateIds.length === 0) continue;
      const candidateCosts = await getInsumoCosts(candidateIds);
      const specificProductIds = candidateIds.filter(
        (id) => candidateCosts.get(id)?.categName?.trim().toUpperCase() === targetCategoryName.toUpperCase()
      );
      if (specificProductIds.length === 0) continue; // no real historical purchases to calibrate from — can't safely redistribute

      const monthlyByProduct = new Map<number, Map<string, number>>();
      let totalSpend = 0;
      for (const productId of specificProductIds) {
        const monthly = new Map<string, number>();
        for (const month of calibrationMonths) {
          const amount = calibrationLines.byProductMonth.get(`${productId}|${month}`) ?? 0;
          monthly.set(month, amount);
          totalSpend += amount;
        }
        monthlyByProduct.set(productId, monthly);
      }

      const totalUnits = calibrationMonths.reduce((sum, m) => sum + (unitsSoldByMonth.get(m) ?? 0), 0);
      if (totalUnits <= 0 || totalSpend <= 0) continue; // nothing to calibrate a $/unit ratio from

      const ratioArsPerUnit = totalSpend / totalUnits;
      const mix = computeHistoricalMix(monthlyByProduct, calibrationMonths);
      if (mix.size === 0) continue;

      // Merge cost/name info for these specific products into the outer
      // costs map so the tree-building step downstream can render them
      // even if they have no real purchase in the requested year.
      for (const productId of specificProductIds) {
        const c = candidateCosts.get(productId);
        if (c && !costs.has(productId)) costs.set(productId, c);
      }

      for (const month of months) {
        if (missingConsensoMonths.has(month)) continue; // presupuestado stays null for this month, same rule as everywhere else
        const unidades = consensoByMonthUnit.get(`${month}|${unit}`) ?? 0;
        if (unidades === 0) continue;
        const genericBudget = unidades * ratioArsPerUnit;

        for (const [productId, share] of mix) {
          const key = `${productId}|${month}`;
          presupuestadoByProductMonth.set(key, (presupuestadoByProductMonth.get(key) ?? 0) + genericBudget * share);
          redistributedProductIds.add(productId);
        }
      }
    }
  }

  return { redistributedProductIds };
}

/**
 * The full Presupuestado (BOM-driven) vs. Real dashboard data for one
 * year, per INSTRUCCIONES_Dashboard_Presupuesto_Dinamico.md sections 3-5.
 * `consensoByMonthUnit` (key `${month}|colchones`/`${month}|living`) and
 * `tcAsumidoByMonth` (key month) are business inputs that don't live in
 * Odoo — callers read them from Supabase and pass them in here.
 */
export async function getPresupuestoDinamicoData(
  year: number,
  consensoByMonthUnit: Map<string, number>,
  tcAsumidoByMonth: Map<string, number>
): Promise<PresupuestoDinamicoResult> {
  const months = monthsBetween(`${year}-01`, `${year}-12`);
  const currentMonth = currentMonthKey();

  const missingConsensoMonths = new Set<string>();
  for (const month of months) {
    const hasColchones = consensoByMonthUnit.has(`${month}|colchones`);
    const hasLiving = consensoByMonthUnit.has(`${month}|living`);
    if (!hasColchones || !hasLiving) missingConsensoMonths.add(month);
  }

  const [bomExplosion, spotFx, realLines] = await Promise.all([
    getBomExplosion(),
    getUsdToArsRate(),
    fetchRealPurchaseLines(year),
  ]);

  const eligibleTemplateIds = new Set(bomExplosion.byTemplateId.keys());
  const [colchonesMix, livingMix] = await Promise.all([
    getModelSalesMix('colchones', eligibleTemplateIds),
    getModelSalesMix('living', eligibleTemplateIds),
  ]);
  const mixByUnit: Record<BusinessUnit, ModelSalesShare[]> = { colchones: colchonesMix, living: livingMix };

  // Step 1-3 of section 3: consenso × mix × BOM, accumulated per insumo/month.
  const neededByProductMonth = new Map<string, number>(); // key `${productId}|${month}`
  for (const month of months) {
    if (missingConsensoMonths.has(month)) continue; // presupuestado stays null for this month, see below
    for (const unit of ['colchones', 'living'] as const) {
      const unidades = consensoByMonthUnit.get(`${month}|${unit}`)!;
      for (const model of mixByUnit[unit]) {
        const modelUnits = unidades * (model.sharePct / 100);
        if (modelUnits === 0) continue;
        for (const leaf of bomExplosion.byTemplateId.get(model.templateId) ?? []) {
          const key = `${leaf.productId}|${month}`;
          neededByProductMonth.set(key, (neededByProductMonth.get(key) ?? 0) + modelUnits * leaf.qtyPerUnit);
        }
      }
    }
  }

  const presupuestadoProductIds = new Set([...neededByProductMonth.keys()].map((k) => Number(k.split('|')[0])));
  const parentById = await getCategoryParentMap();

  const allCostLookupIds = [...new Set([...presupuestadoProductIds, ...realLines.involvedProductIds, ...bomExplosion.possibleCircularComponentIds])];
  const costs = await getInsumoCosts(allCostLookupIds);

  // Regla 4.4 — detect generic-shaped leaf components (referenced by many
  // models at qty≈1) that also have zero cost, confirming they're a true
  // shared placeholder and not a real, priced sub-assembly that merely
  // happens to be used once per unit (see bom-explosion.ts's doc comment
  // for the "TAP ONIX RINCONERO" case this used to misfire on).
  const templateCountByLeaf = new Map<number, { count: number; allNearlyOne: boolean }>();
  for (const leaves of bomExplosion.byTemplateId.values()) {
    for (const leaf of leaves) {
      const stat = templateCountByLeaf.get(leaf.productId) ?? { count: 0, allNearlyOne: true };
      stat.count += 1;
      if (Math.abs(leaf.qtyPerUnit - 1) > GENERIC_QTY_TOLERANCE) stat.allNearlyOne = false;
      templateCountByLeaf.set(leaf.productId, stat);
    }
  }
  const genericProductIds = new Set<number>();
  for (const productId of presupuestadoProductIds) {
    const cost = costs.get(productId);
    if (!cost || cost.hasCost) continue;
    const stat = templateCountByLeaf.get(productId);
    if (stat && stat.count >= GENERIC_MIN_TEMPLATE_REFERENCES && stat.allNearlyOne) genericProductIds.add(productId);
  }

  // Step 4 of section 3: cost the presupuestado quantities, converting
  // USD-costed insumos to ARS. "Costo vigente" (regla 4.5) means the SAME
  // current cost is applied to every month, not a month-specific
  // historical one — only the ARS/USD leg for future months can differ,
  // via the assumed TC business input (section 6).
  const presupuestadoByProductMonth = new Map<string, number>();
  const missingTcMonths = new Set<string>();
  for (const [key, qty] of neededByProductMonth) {
    const productId = Number(key.split('|')[0]);
    const month = key.split('|')[1]!;
    if (genericProductIds.has(productId)) continue; // regla 4.4 — costed separately via redistributeGenericBudgets, not as this placeholder's own line

    const cost = costs.get(productId);
    if (!cost || !cost.hasCost || !isMateriaPrima(cost.categId, parentById)) continue; // gap — excluded from the total, reported separately

    let priceArs = cost.standardPrice;
    if (cost.costCurrency === 'USD') {
      if (month > currentMonth) {
        const assumed = tcAsumidoByMonth.get(month);
        if (assumed === undefined) missingTcMonths.add(month);
        priceArs = cost.standardPrice * (assumed ?? spotFx.arsPerUnit);
      } else {
        priceArs = cost.standardPrice * spotFx.arsPerUnit;
      }
    }
    presupuestadoByProductMonth.set(key, qty * priceArs);
  }

  const { redistributedProductIds } = await redistributeGenericBudgets({
    genericProductIds,
    costs,
    consensoByMonthUnit,
    months,
    missingConsensoMonths,
    presupuestadoByProductMonth,
  });

  // Gaps: generics (regla 4.4 — listed regardless of whether they were
  // successfully redistributed, so it's always visible which insumos are
  // riding on this heuristic rather than a direct BOM cost), no cost
  // loaded, BOM pointing outside Materia Prima, or a circular branch that
  // got cut short. Deduped by productId, first reason wins.
  const gapsById = new Map<number, GapInsumo>();
  function addGap(productId: number, reason: GapReason) {
    if (gapsById.has(productId)) return;
    const cost = costs.get(productId);
    gapsById.set(productId, { productId, productName: cost?.productName ?? `#${productId}`, reason });
  }
  for (const id of genericProductIds) addGap(id, 'componente-generico-sin-repartir');
  for (const id of bomExplosion.possibleCircularComponentIds) addGap(id, 'posible-bom-circular');
  for (const productId of presupuestadoProductIds) {
    if (genericProductIds.has(productId)) continue;
    const cost = costs.get(productId);
    if (!cost) addGap(productId, 'sin-costo');
    else if (!isMateriaPrima(cost.categId, parentById)) addGap(productId, 'no-es-materia-prima');
    else if (!cost.hasCost) addGap(productId, 'sin-costo');
  }

  // Real, restricted to Materia Prima insumos (the counterpart of the
  // presupuestado universe) — anything else real spend touched belongs
  // to getFueraDeAlcance instead. Includes redistributedProductIds so a
  // specific tela/etc. shows its (now non-zero) presupuestado even in a
  // year where it happens to have no real purchase yet.
  const materiaPrimaProductIds = new Set<number>();
  for (const productId of new Set([...presupuestadoProductIds, ...realLines.involvedProductIds, ...redistributedProductIds])) {
    if (genericProductIds.has(productId)) continue; // the placeholder itself never shows as a tree row
    const cost = costs.get(productId);
    if (cost && cost.hasCost && isMateriaPrima(cost.categId, parentById)) materiaPrimaProductIds.add(productId);
  }

  const categoryGroups = new Map<number, CategoryGroup>();
  for (const productId of materiaPrimaProductIds) {
    const cost = costs.get(productId)!;
    const categId = cost.categId!;
    if (!categoryGroups.has(categId)) {
      categoryGroups.set(categId, {
        categoryId: categId,
        categoryName: cost.categName ?? `#${categId}`,
        insumos: [],
        months: {},
        annual: buildFigure(0, 0),
      });
    }

    const monthFigures: Record<string, InsumoMonthFigure> = {};
    let annualPresupuestado = 0;
    let annualReal = 0;
    let anyMissingMonth = false;
    for (const month of months) {
      const key = `${productId}|${month}`;
      const presupuestado = missingConsensoMonths.has(month) ? null : presupuestadoByProductMonth.get(key) ?? 0;
      const real = realLines.byProductMonth.get(key) ?? 0;
      monthFigures[month] = buildFigure(presupuestado, real);
      if (presupuestado === null) anyMissingMonth = true;
      else annualPresupuestado += presupuestado;
      annualReal += real;
    }

    categoryGroups.get(categId)!.insumos.push({
      productId,
      productName: cost.productName,
      months: monthFigures,
      annual: buildFigure(anyMissingMonth ? null : annualPresupuestado, annualReal),
    });
  }

  // Roll each category up from its own insumo rows, then sort insumos and
  // categories by annual real spend (biggest first — most actionable).
  const categories: CategoryGroup[] = [];
  for (const group of categoryGroups.values()) {
    group.insumos.sort((a, b) => b.annual.real - a.annual.real);

    const monthFigures: Record<string, InsumoMonthFigure> = {};
    let annualPresupuestado = 0;
    let annualReal = 0;
    let anyMissingMonth = false;
    for (const month of months) {
      let presupuestadoSum: number | null = missingConsensoMonths.has(month) ? null : 0;
      let realSum = 0;
      for (const insumo of group.insumos) {
        const figure = insumo.months[month]!;
        if (presupuestadoSum !== null) presupuestadoSum += figure.presupuestado ?? 0;
        realSum += figure.real;
      }
      monthFigures[month] = buildFigure(presupuestadoSum, realSum);
      if (presupuestadoSum === null) anyMissingMonth = true;
      else annualPresupuestado += presupuestadoSum;
      annualReal += realSum;
    }
    categories.push({
      ...group,
      months: monthFigures,
      annual: buildFigure(anyMissingMonth ? null : annualPresupuestado, annualReal),
    });
  }
  categories.sort((a, b) => b.annual.real - a.annual.real);

  const monthlyComplianceSummary = months.map((month) => {
    let presupuestadoSum: number | null = missingConsensoMonths.has(month) ? null : 0;
    let realSum = 0;
    for (const category of categories) {
      const figure = category.months[month]!;
      if (presupuestadoSum !== null) presupuestadoSum += figure.presupuestado ?? 0;
      realSum += figure.real;
    }
    const compliancePct = presupuestadoSum !== null && presupuestadoSum > 0 ? (realSum / presupuestadoSum) * 100 : null;
    return { month, compliancePct };
  });

  return {
    year,
    months,
    categories,
    gaps: [...gapsById.values()],
    missingConsensoMonths: [...missingConsensoMonths].sort(),
    missingTcMonths: [...missingTcMonths].sort(),
    monthlyComplianceSummary,
  };
}

/** Real purchase categories that aren't Materia Prima (services, indumentaria, reventa, ...) — kept separate so they never dilute the Materia Prima % de Cumplimiento. */
export async function getFueraDeAlcance(year: number): Promise<FueraDeAlcanceResult> {
  const months = monthsBetween(`${year}-01`, `${year}-12`);
  const realLines = await fetchRealPurchaseLines(year);
  const parentById = await getCategoryParentMap();
  const costs = await getInsumoCosts([...realLines.involvedProductIds]);

  const categoryGroups = new Map<number, FueraDeAlcanceCategoryRow>();
  for (const [key, amount] of realLines.byProductMonth) {
    const productId = Number(key.split('|')[0]);
    const month = key.split('|')[1]!;
    const cost = costs.get(productId);
    if (!cost || cost.categId === null || isMateriaPrima(cost.categId, parentById)) continue;

    if (!categoryGroups.has(cost.categId)) {
      categoryGroups.set(cost.categId, { categoryId: cost.categId, categoryName: cost.categName ?? `#${cost.categId}`, months: {}, annual: 0 });
    }
    const row = categoryGroups.get(cost.categId)!;
    row.months[month] = (row.months[month] ?? 0) + amount;
    row.annual += amount;
  }

  const categories = [...categoryGroups.values()].sort((a, b) => b.annual - a.annual);
  return { year, months, categories };
}

/** Confirms the year's BOM/sales-mix universe has active, BOM-explodable models — cheap sanity check for the UI's "no models found" empty state. */
export async function hasEligibleModels(): Promise<boolean> {
  const models = await getActiveModelsWithBom();
  return models.length > 0;
}

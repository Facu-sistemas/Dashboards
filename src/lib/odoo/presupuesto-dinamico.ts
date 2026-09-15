import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { getUsdToArsRate } from './currency';
import { getBomByModeloBaseKey } from '../bom-csv';
import { getProduccionConsenso } from '../consenso-csv';
import { getModelSalesMix, getMonthlyUnitsSold, type BusinessUnit, type ModelSalesShare } from './sales-mix';
import { getInsumoCosts, resolveInsumoProductIds, type InsumoCost } from './insumo-costs';
import { getHistoricalUsdArsRates } from './fx-historical';
import { withTtlCache, cacheKey, invalidateByPrefix } from '../cache';
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
// TRUE generic (not a real, priced material that happens to be used at
// qty≈1 everywhere) requires cost === 0. Confirmed live (2026-09) against
// the flattened BOM CSV: with a >=15-reference threshold, "CORTE DE TELA
// 1" (the doc's own worked example) and "ETIQUETA BORDADA CALM" both
// match cost=0 + the qty≈1 shape.
const GENERIC_MIN_MODEL_REFERENCES = 15;
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

export type GapReason = 'sin-costo' | 'componente-generico-sin-repartir' | 'no-es-materia-prima' | 'insumo-no-encontrado';

export interface GapInsumo {
  productId: number | null;
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
  /** "Modelo (base)" names from the BOM CSV that have real sales but couldn't be matched to any live Odoo product.template by name — their contribution is silently absent from Presupuestado, not just a $0 gap row, so this needs separate visibility. */
  modelosSinBomReconocido: string[];
}

export type InsumoBreakdownSource = 'bom' | 'reparto-generico';

/** One contributor to an insumo's Presupuestado figure for a single month — either a model's own BOM consumption, or a share of a redistributed generic (regla 4.4). `detail` is a ready-to-render string built server-side, since the two sources have genuinely different units (kg/m²/etc. of BOM vs. a % share of a $ pool) and forcing them into shared numeric fields would misrepresent one or the other. */
export interface InsumoBreakdownEntry {
  source: InsumoBreakdownSource;
  label: string;
  businessUnit: BusinessUnit;
  detail: string;
  subtotalArs: number;
}

export interface InsumoBreakdownResult {
  productId: number;
  productName: string;
  month: string;
  entries: InsumoBreakdownEntry[];
  totalArs: number;
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
  breakdownTarget?: { productId: number; month: string };
}): Promise<{ redistributedProductIds: Set<number>; breakdownEntries: InsumoBreakdownEntry[] }> {
  const { genericProductIds, costs, consensoByMonthUnit, months, missingConsensoMonths, presupuestadoByProductMonth, breakdownTarget } = params;
  const redistributedProductIds = new Set<number>();
  const breakdownEntries: InsumoBreakdownEntry[] = [];

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
          const shareAmount = genericBudget * share;
          presupuestadoByProductMonth.set(key, (presupuestadoByProductMonth.get(key) ?? 0) + shareAmount);
          redistributedProductIds.add(productId);

          if (breakdownTarget && productId === breakdownTarget.productId && month === breakdownTarget.month) {
            breakdownEntries.push({
              source: 'reparto-generico',
              label: `Reparto de "${config.genericProductName}"`,
              businessUnit: unit,
              detail: `${(share * 100).toFixed(1)}% del mix histórico de compras · ${unidades.toFixed(0)} u de ${unit === 'colchones' ? 'Colchones' : 'Living'} consensuadas`,
              subtotalArs: shareAmount,
            });
          }
        }
      }
    }
  }

  return { redistributedProductIds, breakdownEntries };
}

/**
 * "Consenso de unidades", layered from most to least authoritative:
 *
 * 1. Manual entry (Supabase, typed into the Compras form) — an explicit
 *    override always wins, for any month.
 * 2. The real "Producción Consensuado" plan (consenso-csv.ts) — confirmed
 *    live (2026-09) this is the dominant input: loading January's real
 *    values (6,480 colchones / 792 sillones) instead of a guess moved
 *    TDI's presupuestado from 4% to 60% of Marlynet's reference number.
 *    Applies to ANY month it covers, past or future — it's Producción's
 *    own forward plan, which is exactly what "presupuestado" is supposed
 *    to project from, not a backward-looking actual.
 * 3. Real units sold (getMonthlyUnitsSold) — last-resort fallback, only
 *    for already-CLOSED months the CSV doesn't cover, so the dashboard
 *    still shows something better than a gap for old data the planning
 *    sheet doesn't reach back to.
 *
 * Deliberately NOT sourced from OEE's mrp.production `qty_produced`
 * (oee.ts) for tier 3 — confirmed live that figure sums across the ENTIRE
 * Colchones/Living category tree, including every intermediate
 * manufacturing order (foam blocks, bases, etc.), not just finished
 * units — January 2026 came back as 7,221 "units" whose top entries were
 * "ESPUMA CORONA..." and "BASE OLIMPO...", component-stage production.
 */
async function buildEffectiveConsenso(
  months: string[],
  manualConsensoByMonthUnit: Map<string, number>,
  currentMonth: string
): Promise<{ effective: Map<string, number>; missingConsensoMonths: Set<string> }> {
  const effective = new Map<string, number>();

  // Tier 3: real sales, closed months only — the weakest source, applied first so anything better overwrites it.
  const closedMonths = months.filter((m) => m < currentMonth);
  const [colchonesSold, livingSold] = closedMonths.length
    ? await Promise.all([getMonthlyUnitsSold('colchones', closedMonths), getMonthlyUnitsSold('living', closedMonths)])
    : [new Map<string, number>(), new Map<string, number>()];
  const soldByUnit: Record<BusinessUnit, Map<string, number>> = { colchones: colchonesSold, living: livingSold };
  for (const month of closedMonths) {
    for (const unit of ['colchones', 'living'] as const) {
      const sold = soldByUnit[unit].get(month);
      if (sold !== undefined) effective.set(`${month}|${unit}`, sold);
    }
  }

  // Tier 2: the real Producción Consensuado plan, for any month it covers.
  const produccionConsenso = await getProduccionConsenso();
  const produccionByUnit: Record<BusinessUnit, Map<string, number>> = produccionConsenso;
  for (const month of months) {
    for (const unit of ['colchones', 'living'] as const) {
      const planned = produccionByUnit[unit].get(month);
      if (planned !== undefined) effective.set(`${month}|${unit}`, planned);
    }
  }

  // Tier 1: manual override, always wins.
  for (const [key, value] of manualConsensoByMonthUnit) effective.set(key, value);

  const missingConsensoMonths = new Set<string>();
  for (const month of months) {
    const hasColchones = effective.has(`${month}|colchones`);
    const hasLiving = effective.has(`${month}|living`);
    if (!hasColchones || !hasLiving) missingConsensoMonths.add(month);
  }

  return { effective, missingConsensoMonths };
}

/**
 * The full Presupuestado (BOM-driven) vs. Real dashboard data for one
 * year, per INSTRUCCIONES_Dashboard_Presupuesto_Dinamico.md sections 3-5.
 * `consensoByMonthUnit` (key `${month}|colchones`/`${month}|living`) and
 * `tcAsumidoByMonth` (key month) are the MANUAL business inputs that don't
 * live in Odoo — callers read them from Supabase and pass them in here.
 * They're the last-resort override; see buildEffectiveConsenso for the
 * full priority order (manual > Producción Consensuado CSV > real sales
 * fallback for closed months) — manual entry is rarely actually needed.
 */
async function computeCore(
  year: number,
  consensoByMonthUnit: Map<string, number>,
  tcAsumidoByMonth: Map<string, number>,
  breakdownTarget?: { productId: number; month: string }
): Promise<{ result: PresupuestoDinamicoResult; breakdownEntries: InsumoBreakdownEntry[]; breakdownProductName: string }> {
  const months = monthsBetween(`${year}-01`, `${year}-12`);
  const currentMonth = currentMonthKey();

  const { effective: effectiveConsensoByMonthUnit, missingConsensoMonths } = await buildEffectiveConsenso(
    months,
    consensoByMonthUnit,
    currentMonth
  );

  const [bomByModel, spotFx, realLines] = await Promise.all([
    getBomByModeloBaseKey(),
    getUsdToArsRate(),
    fetchRealPurchaseLines(year),
  ]);

  const eligibleBaseNameKeys = new Set(bomByModel.keys());
  const [colchonesMix, livingMix] = await Promise.all([
    getModelSalesMix('colchones', eligibleBaseNameKeys),
    getModelSalesMix('living', eligibleBaseNameKeys),
  ]);
  const mixByUnit: Record<BusinessUnit, ModelSalesShare[]> = { colchones: colchonesMix.shares, living: livingMix.shares };
  const modelosSinBomReconocido = [...new Set([...colchonesMix.unmatchedBaseNames, ...livingMix.unmatchedBaseNames])].sort();

  // Resolve every insumo name the sold-and-matched models' BOM rows
  // reference to a live Odoo product_id — regla 4.1 ("cruzar por
  // product_id, nunca por texto"): from here on, every join uses the id.
  const referencedInsumoKeys = new Set<string>();
  for (const mix of [colchonesMix.shares, livingMix.shares]) {
    for (const model of mix) {
      for (const row of bomByModel.get(model.baseNameKey) ?? []) referencedInsumoKeys.add(row.insumoKey);
    }
  }
  const productIdByInsumoKey = await resolveInsumoProductIds([...referencedInsumoKeys]);
  const unresolvedInsumoNames = new Map<string, string>(); // insumoKey -> display name

  // Step 1-3 of section 3: consenso × mix × BOM, accumulated per insumo/month.
  // When breakdownTarget is set, also keep each individual model's raw
  // contribution to that one (productId, month) — the aggregate map above
  // only keeps the sum, which is all the main table needs, but a drill-down
  // needs the per-model detail before it's collapsed.
  const neededByProductMonth = new Map<string, number>(); // key `${productId}|${month}`
  const rawBomBreakdown: { modelBaseName: string; unit: BusinessUnit; modelUnits: number; qtyPerUnit: number; udm: string; totalQty: number }[] = [];
  for (const month of months) {
    if (missingConsensoMonths.has(month)) continue; // presupuestado stays null for this month, see below
    for (const unit of ['colchones', 'living'] as const) {
      const unidades = effectiveConsensoByMonthUnit.get(`${month}|${unit}`)!;
      for (const model of mixByUnit[unit]) {
        const modelUnits = unidades * (model.sharePct / 100);
        if (modelUnits === 0) continue;
        for (const row of bomByModel.get(model.baseNameKey) ?? []) {
          const productId = productIdByInsumoKey.get(row.insumoKey);
          if (productId === undefined) {
            unresolvedInsumoNames.set(row.insumoKey, row.insumoNombre);
            continue;
          }
          const key = `${productId}|${month}`;
          neededByProductMonth.set(key, (neededByProductMonth.get(key) ?? 0) + modelUnits * row.qty);

          if (breakdownTarget && productId === breakdownTarget.productId && month === breakdownTarget.month) {
            rawBomBreakdown.push({ modelBaseName: model.baseName, unit, modelUnits, qtyPerUnit: row.qty, udm: row.udm, totalQty: modelUnits * row.qty });
          }
        }
      }
    }
  }

  const presupuestadoProductIds = new Set([...neededByProductMonth.keys()].map((k) => Number(k.split('|')[0])));
  const parentById = await getCategoryParentMap();

  const allCostLookupIds = [...new Set([...presupuestadoProductIds, ...realLines.involvedProductIds])];
  const costs = await getInsumoCosts(allCostLookupIds);

  // Regla 4.4 — detect generic-shaped insumos (referenced by many models
  // at qty≈1) that also have zero cost, confirming they're a true shared
  // placeholder and not a real, priced material that merely happens to be
  // used once per unit.
  const shapeStatsByInsumoKey = new Map<string, { count: number; allNearlyOne: boolean }>();
  for (const rows of bomByModel.values()) {
    for (const row of rows) {
      const stat = shapeStatsByInsumoKey.get(row.insumoKey) ?? { count: 0, allNearlyOne: true };
      stat.count += 1;
      if (Math.abs(row.qty - 1) > GENERIC_QTY_TOLERANCE) stat.allNearlyOne = false;
      shapeStatsByInsumoKey.set(row.insumoKey, stat);
    }
  }
  const insumoKeyByProductId = new Map([...productIdByInsumoKey.entries()].map(([k, id]) => [id, k]));
  const genericProductIds = new Set<number>();
  for (const productId of presupuestadoProductIds) {
    const cost = costs.get(productId);
    if (!cost || cost.hasCost) continue;
    const insumoKey = insumoKeyByProductId.get(productId);
    const stat = insumoKey ? shapeStatsByInsumoKey.get(insumoKey) : undefined;
    if (stat && stat.count >= GENERIC_MIN_MODEL_REFERENCES && stat.allNearlyOne) genericProductIds.add(productId);
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

  const { redistributedProductIds, breakdownEntries: repartoBreakdown } = await redistributeGenericBudgets({
    genericProductIds,
    costs,
    consensoByMonthUnit: effectiveConsensoByMonthUnit,
    months,
    missingConsensoMonths,
    presupuestadoByProductMonth,
    breakdownTarget,
  });

  // Gaps: generics (regla 4.4 — listed regardless of whether they were
  // successfully redistributed, so it's always visible which insumos are
  // riding on this heuristic rather than a direct BOM cost), no cost
  // loaded, BOM pointing outside Materia Prima, or a circular branch that
  // got cut short. Deduped by productId, first reason wins.
  const gapsById = new Map<string, GapInsumo>();
  function addGap(dedupeKey: string, productId: number | null, productName: string, reason: GapReason) {
    if (gapsById.has(dedupeKey)) return;
    gapsById.set(dedupeKey, { productId, productName, reason });
  }
  for (const id of genericProductIds) {
    addGap(`p${id}`, id, costs.get(id)?.productName ?? `#${id}`, 'componente-generico-sin-repartir');
  }
  for (const [insumoKey, insumoName] of unresolvedInsumoNames) {
    addGap(`u${insumoKey}`, null, insumoName, 'insumo-no-encontrado');
  }
  for (const productId of presupuestadoProductIds) {
    if (genericProductIds.has(productId)) continue;
    const cost = costs.get(productId);
    if (!cost) addGap(`p${productId}`, productId, `#${productId}`, 'sin-costo');
    else if (!isMateriaPrima(cost.categId, parentById)) addGap(`p${productId}`, productId, cost.productName, 'no-es-materia-prima');
    else if (!cost.hasCost) addGap(`p${productId}`, productId, cost.productName, 'sin-costo');
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

  // Assemble the drill-down for breakdownTarget, if requested. BOM-sourced
  // raw contributions only carry quantities at this point — the per-model
  // unit cost is derived from the aggregate (qty × price = presupuestado,
  // already computed above), not recomputed, so it can never drift from
  // what the main table shows for that cell.
  let breakdownEntries: InsumoBreakdownEntry[] = [];
  let breakdownProductName = '';
  if (breakdownTarget) {
    const key = `${breakdownTarget.productId}|${breakdownTarget.month}`;
    const aggregatedSubtotal = presupuestadoByProductMonth.get(key);
    const aggregatedQty = neededByProductMonth.get(key);
    const unitCostArs = aggregatedSubtotal !== undefined && aggregatedQty ? aggregatedSubtotal / aggregatedQty : undefined;

    const bomEntries: InsumoBreakdownEntry[] = rawBomBreakdown.map((raw) => ({
      source: 'bom',
      label: raw.modelBaseName,
      businessUnit: raw.unit,
      detail: `${raw.modelUnits.toFixed(1)} u × ${raw.qtyPerUnit} ${raw.udm}/u = ${raw.totalQty.toFixed(3)} ${raw.udm}`,
      subtotalArs: unitCostArs !== undefined ? raw.totalQty * unitCostArs : 0,
    }));

    breakdownEntries = [...bomEntries, ...repartoBreakdown].sort((a, b) => b.subtotalArs - a.subtotalArs);
    breakdownProductName = costs.get(breakdownTarget.productId)?.productName ?? `#${breakdownTarget.productId}`;
  }

  return {
    result: {
      year,
      months,
      categories,
      gaps: [...gapsById.values()],
      missingConsensoMonths: [...missingConsensoMonths].sort(),
      missingTcMonths: [...missingTcMonths].sort(),
      monthlyComplianceSummary,
      modelosSinBomReconocido,
    },
    breakdownEntries,
    breakdownProductName,
  };
}

/**
 * The full Presupuestado (BOM-driven) vs. Real dashboard data for one
 * year, per INSTRUCCIONES_Dashboard_Presupuesto_Dinamico.md sections 3-5.
 * `consensoByMonthUnit` (key `${month}|colchones`/`${month}|living`) and
 * `tcAsumidoByMonth` (key month) are the MANUAL business inputs that don't
 * live in Odoo — callers read them from Supabase and pass them in here.
 * They're the last-resort override; see buildEffectiveConsenso for the
 * full priority order (manual > Producción Consensuado CSV > real sales
 * fallback for closed months) — manual entry is rarely actually needed.
 */
export async function getPresupuestoDinamicoData(
  year: number,
  consensoByMonthUnit: Map<string, number>,
  tcAsumidoByMonth: Map<string, number>
): Promise<PresupuestoDinamicoResult> {
  return (await computeCore(year, consensoByMonthUnit, tcAsumidoByMonth)).result;
}

/**
 * Drill-down for one insumo/month cell: every model's own BOM contribution
 * plus its share of any redistributed generic (regla 4.4), so Compras can
 * see exactly how a Presupuestado number was built instead of trusting the
 * final $ figure blind. Recomputes the same core pass as
 * getPresupuestoDinamicoData (same cached sub-fetches, so this is cheap
 * relative to the first call in a burst) rather than caching the full
 * per-model detail for every insumo/month up front — that detail is large
 * (~634 insumos × ~12 months × however many models touch each one) and
 * almost never looked at, so it isn't worth carrying in the main response.
 */
export async function getInsumoBreakdown(
  year: number,
  consensoByMonthUnit: Map<string, number>,
  tcAsumidoByMonth: Map<string, number>,
  productId: number,
  month: string
): Promise<InsumoBreakdownResult> {
  const { breakdownEntries, breakdownProductName } = await computeCore(year, consensoByMonthUnit, tcAsumidoByMonth, { productId, month });
  return {
    productId,
    productName: breakdownProductName || `#${productId}`,
    month,
    entries: breakdownEntries,
    totalArs: breakdownEntries.reduce((sum, e) => sum + e.subtotalArs, 0),
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

/**
 * Drops every short-TTL cache entry this dashboard's data passes through
 * (real purchase-line enrichment, the BOM/Producción CSVs, the insumo
 * name index, the spot FX rate), for the UI's manual "Recalcular" action.
 * Every one of these already expires on its own within minutes — this
 * only lets a user force that now instead of waiting it out, e.g. right
 * after confirming a purchase order or updating a cost in Odoo.
 */
export function invalidatePresupuestoDinamicoCache(): void {
  invalidateByPrefix('presupuesto-dinamico:real-range');
  invalidateByPrefix('bom-csv:rows');
  invalidateByPrefix('consenso-csv:produccion');
  invalidateByPrefix('insumo-costs:name-index');
  invalidateByPrefix('fx:usd-ars:latest');
}

/** Confirms the BOM CSV actually has data — cheap sanity check for the UI's "no models found" empty state. */
export async function hasEligibleModels(): Promise<boolean> {
  const bomByModel = await getBomByModeloBaseKey();
  return bomByModel.size > 0;
}

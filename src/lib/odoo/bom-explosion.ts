import { searchReadAll } from './client';
import { withTtlCache } from '../cache';

// Recursive BOM explosion is expensive (thousands of active models, each
// potentially multi-level) — cache the whole computation like
// raw-material-consumption.ts does for its (single-level) explosion.
const BOM_TREE_TTL_MS = 5 * 60 * 1000;

// Safety net against a circular BOM reference in the data (component A's
// recipe points back at a model that (in)directly needs A again) rather
// than trusting Odoo never has one — confirmed live this repo has no
// existing recursive explosion to learn from, so this is a fresh
// precaution, not a copied pattern.
const MAX_BOM_DEPTH = 10;

export interface BomComponentNeed {
  productId: number;
  /** Quantity of this leaf component needed per 1 unit of the finished model. */
  qtyPerUnit: number;
}

export interface ActiveModelWithBom {
  templateId: number;
  templateName: string;
}

interface RawBom {
  [key: string]: unknown;
  id: number;
  product_tmpl_id: [number, string];
  product_qty: number;
}

interface RawBomLine {
  [key: string]: unknown;
  bom_id: [number, string];
  product_id: [number, string];
  product_qty: number;
}

export interface BomExplosionResult {
  /** Active models with a usable BOM, recursively exploded down to leaf components (components with no BOM of their own). */
  byTemplateId: Map<number, BomComponentNeed[]>;
  /** product_id of components whose branch was cut short for exceeding MAX_BOM_DEPTH — surfaced as a data-quality warning, not silently dropped. */
  possibleCircularComponentIds: Set<number>;
}

/**
 * Recursively explodes every active `product.template`'s primary BOM down
 * to leaf components (a component that has no BOM of its own — i.e. real
 * raw material, not a sub-assembly). Unlike
 * raw-material-consumption.ts's fetchBomExplosionNeeds (explicitly
 * single-level, a different feature — do not confuse the two), this
 * follows a component into ITS OWN `mrp.bom` when it has one, per
 * INSTRUCCIONES_Dashboard_Presupuesto_Dinamico.md section 4.2.
 *
 * Deliberately does NOT try to detect "generic shared" components (regla
 * 4.4, e.g. "CORTE DE TELA 1") here — an earlier version did, using only
 * shape (referenced by many BOMs, qty always ~1), with no cost check
 * (this module has no access to cost data). That misclassified real,
 * priced sub-assemblies as free generics and silently excluded them from
 * every model's total — confirmed live: components like "TAP ONIX
 * RINCONERO 2 CPO" (cost ~$592,000, referenced by dozens of BOMs at
 * qty≈1 because it's one whole upholstered sub-assembly per unit) matched
 * that shape perfectly and got dropped. Recursion must always win when a
 * component has its own BOM, regardless of shape; genuine cost=0 generics
 * are detected downstream in presupuesto-dinamico.ts, where cost data is
 * actually available.
 */
async function computeBomExplosion(): Promise<BomExplosionResult> {
  const [templates, boms] = await Promise.all([
    searchReadAll<{ id: number; name: string }>({
      model: 'product.template',
      domain: [['active', '=', true]],
      fields: ['name'],
    }),
    searchReadAll<RawBom>({
      model: 'mrp.bom',
      domain: [['active', '=', true]],
      fields: ['product_tmpl_id', 'product_qty'],
    }),
  ]);

  const activeTemplateIds = new Set(templates.map((t) => t.id));

  // One BOM per template assumed (take the first found, deterministic by
  // id) — matches how fetchBomExplosionNeeds already treats bom_id
  // elsewhere in this codebase: production orders carry a single bom_id,
  // never a list.
  const bomByTemplateId = new Map<number, RawBom>();
  for (const b of boms.sort((a, b2) => a.id - b2.id)) {
    if (!activeTemplateIds.has(b.product_tmpl_id[0])) continue;
    if (!bomByTemplateId.has(b.product_tmpl_id[0])) bomByTemplateId.set(b.product_tmpl_id[0], b);
  }

  const bomIds = [...bomByTemplateId.values()].map((b) => b.id);
  const bomLines = bomIds.length
    ? await searchReadAll<RawBomLine>({
        model: 'mrp.bom.line',
        domain: [['bom_id', 'in', bomIds]],
        fields: ['bom_id', 'product_id', 'product_qty'],
      })
    : [];

  const linesByBomId = new Map<number, RawBomLine[]>();
  for (const line of bomLines) {
    const bomId = line.bom_id[0];
    if (!linesByBomId.has(bomId)) linesByBomId.set(bomId, []);
    linesByBomId.get(bomId)!.push(line);
  }

  // Map every component product (variant) to its template, so we can tell
  // whether a BOM line points at a sub-assembly (its template has its own
  // BOM) or a true leaf raw material.
  const componentProductIds = [...new Set(bomLines.map((l) => l.product_id[0]))];
  const componentProducts = componentProductIds.length
    ? await searchReadAll<{ id: number; product_tmpl_id: [number, string] }>({
        model: 'product.product',
        domain: [['id', 'in', componentProductIds]],
        fields: ['product_tmpl_id'],
      })
    : [];
  const templateIdByComponentProductId = new Map(componentProducts.map((p) => [p.id, p.product_tmpl_id[0]]));

  const possibleCircularComponentIds = new Set<number>();
  const memo = new Map<number, Map<number, number>>(); // templateId -> (leaf productId -> qty per 1 unit)

  function explodeTemplate(templateId: number, depth: number, ancestry: Set<number>): Map<number, number> {
    const cached = memo.get(templateId);
    if (cached) return cached;

    const bom = bomByTemplateId.get(templateId);
    const result = new Map<number, number>();
    if (!bom) {
      // No BOM at all for this template — nothing to explode (shouldn't
      // normally be called in that case, but stay defensive).
      memo.set(templateId, result);
      return result;
    }

    if (depth > MAX_BOM_DEPTH || ancestry.has(templateId)) {
      // Circular or pathologically deep — cut the branch, flag every
      // direct component of this BOM as "possible circular" so it's
      // visible instead of silently missing from the total.
      for (const line of linesByBomId.get(bom.id) ?? []) {
        possibleCircularComponentIds.add(line.product_id[0]);
      }
      return result; // not memoized: depends on the ancestry path, not just templateId
    }

    const yieldQty = bom.product_qty || 1;
    const nextAncestry = new Set(ancestry).add(templateId);

    for (const line of linesByBomId.get(bom.id) ?? []) {
      const componentProductId = line.product_id[0];
      const qtyPerParentUnit = line.product_qty / yieldQty;
      const componentTemplateId = templateIdByComponentProductId.get(componentProductId);
      const subBom = componentTemplateId !== undefined ? bomByTemplateId.get(componentTemplateId) : undefined;

      if (subBom && componentTemplateId !== undefined) {
        // Sub-assembly: recurse and scale its own leaf needs by this qty.
        // This always wins over any "looks generic" shape check — a
        // component with its own recipe is never a cost=0 placeholder.
        const subLeaves = explodeTemplate(componentTemplateId, depth + 1, nextAncestry);
        for (const [leafId, leafQtyPerSubUnit] of subLeaves) {
          const existing = result.get(leafId) ?? 0;
          result.set(leafId, existing + leafQtyPerSubUnit * qtyPerParentUnit);
        }
      } else {
        // Leaf raw material (or a cost=0 generic placeholder — that
        // distinction needs cost data, so it's made downstream).
        const existing = result.get(componentProductId) ?? 0;
        result.set(componentProductId, existing + qtyPerParentUnit);
      }
    }

    memo.set(templateId, result);
    return result;
  }

  const byTemplateId = new Map<number, BomComponentNeed[]>();
  for (const templateId of bomByTemplateId.keys()) {
    const leaves = explodeTemplate(templateId, 1, new Set());
    byTemplateId.set(
      templateId,
      [...leaves.entries()].map(([productId, qtyPerUnit]) => ({ productId, qtyPerUnit }))
    );
  }

  return { byTemplateId, possibleCircularComponentIds };
}

export async function getBomExplosion(): Promise<BomExplosionResult> {
  return withTtlCache('presupuesto-dinamico:bom-explosion', BOM_TREE_TTL_MS, computeBomExplosion);
}

/** Active models that have a usable (explodable) BOM — the universe the sales mix (regla 4.3) is restricted to. */
export async function getActiveModelsWithBom(): Promise<ActiveModelWithBom[]> {
  const { byTemplateId } = await getBomExplosion();
  const templates = await searchReadAll<{ id: number; name: string }>({
    model: 'product.template',
    domain: [['id', 'in', [...byTemplateId.keys()]], ['active', '=', true]],
    fields: ['name'],
  });
  return templates.map((t) => ({ templateId: t.id, templateName: t.name }));
}

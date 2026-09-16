import type { DemandaRow, PlacaSpec, BlockSpec } from './odoo/multicorte';

/**
 * Port of the multicorte cutting-stock optimizer (previously a Python/
 * Streamlit tool reading a Google Sheet + manually-uploaded Excel plans).
 * Pure, isomorphic business logic — no Odoo/DOM dependency, mirrors
 * lib/bandas-calc.ts in spirit.
 *
 * All internal geometry works in millimeters as integers (the Python
 * original scaled cm×10 for the same reason: an integer 1D knapsack DP
 * needs an integer capacity). Public inputs/outputs stay in cm, matching
 * `base_de_datos_colchones`/`base_de_datos_block`.
 *
 * Simplification vs. the Python original (see the approved plan): the 2D
 * bin packing uses a single MaxRects-BSSF-with-rotation strategy instead of
 * `rectpack`'s Skyline-seeded Guillotine-with-MaxRects-fallback hybrid —
 * same algorithm family (MaxRects WAS Python's own fallback path), no new
 * npm dependency. Packed layouts may differ cosmetically from the old tool;
 * overall efficiency should be comparable.
 */

// ---------------------------------------------------------------------------
// Scrap-reuse rule
// ---------------------------------------------------------------------------

/** Minimum usable offcut size (any orientation): thickness ≥ 20mm AND (width≥480mm & length≥950mm) OR (width≥950mm & length≥480mm). Inputs in cm. */
export function esDisponible(anchoCm: number, largoCm: number, espesorCm: number): boolean {
  const anchoMm = anchoCm * 10;
  const largoMm = largoCm * 10;
  const espesorMm = espesorCm * 10;
  if (espesorMm < 20) return false;
  const cond1 = anchoMm >= 480 && largoMm >= 950;
  const cond2 = anchoMm >= 950 && largoMm >= 480;
  return cond1 || cond2;
}

const COLOR_ORDER = ['verde oscuro', 'gris', 'blanco', 'celeste', 'verde', 'lila'];

export function getColorGroup(colorName: string): string {
  const c = colorName.toLowerCase().trim();
  if (c.includes('verde oscuro')) return 'verde oscuro';
  if (c.includes('gris')) return 'gris';
  if (c.includes('blanco')) return 'blanco';
  if (c.includes('celeste')) return 'celeste';
  if (c.includes('verde')) return 'verde';
  if (c.includes('lila')) return 'lila';
  return 'otros';
}

function colorSortIndex(colorName: string): number {
  const idx = COLOR_ORDER.indexOf(getColorGroup(colorName));
  return idx === -1 ? COLOR_ORDER.length : idx;
}

function fmtNum(v: number): number {
  return Number.isInteger(v) ? v : Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------------------
// 2D rectangle packing (MaxRects-BSSF, rotation allowed, multi-bin)
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  l: number;
}

interface PlateInput {
  uuid: number;
  w: number;
  l: number;
  prod: string;
}

interface PlacedRect extends Rect {
  uuid: number;
  prod: string;
  rotated: boolean;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.l && a.y + a.l > b.y;
}

function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.l <= outer.y + outer.l;
}

/** Packs `plates` (with rotation) into as many `binW`x`binL` bins as needed, best-short-side-fit. Plates that don't fit even an empty bin in either orientation are silently dropped (shouldn't happen for real block/plate data). */
function maxRectsPackMultiBin(binW: number, binL: number, plates: PlateInput[]): PlacedRect[][] {
  const sorted = [...plates].sort((a, b) => b.w * b.l - a.w * a.l);
  const bins: { freeRects: Rect[]; placed: PlacedRect[] }[] = [];

  function placeInBin(bin: { freeRects: Rect[]; placed: PlacedRect[] }, plate: PlateInput): boolean {
    let best: { rect: Rect; w: number; l: number; rotated: boolean; score: number } | null = null;
    for (const fr of bin.freeRects) {
      for (const rotated of [false, true]) {
        const w = rotated ? plate.l : plate.w;
        const l = rotated ? plate.w : plate.l;
        if (w <= fr.w && l <= fr.l) {
          const score = Math.min(fr.w - w, fr.l - l);
          if (!best || score < best.score) best = { rect: fr, w, l, rotated, score };
        }
      }
    }
    if (!best) return false;

    const placedRect: Rect = { x: best.rect.x, y: best.rect.y, w: best.w, l: best.l };
    bin.placed.push({ ...placedRect, uuid: plate.uuid, prod: plate.prod, rotated: best.rotated });

    const newFree: Rect[] = [];
    for (const fr of bin.freeRects) {
      if (!rectsOverlap(fr, placedRect)) {
        newFree.push(fr);
        continue;
      }
      if (placedRect.x > fr.x) newFree.push({ x: fr.x, y: fr.y, w: placedRect.x - fr.x, l: fr.l });
      if (placedRect.x + placedRect.w < fr.x + fr.w) {
        newFree.push({ x: placedRect.x + placedRect.w, y: fr.y, w: fr.x + fr.w - (placedRect.x + placedRect.w), l: fr.l });
      }
      if (placedRect.y > fr.y) newFree.push({ x: fr.x, y: fr.y, w: fr.w, l: placedRect.y - fr.y });
      if (placedRect.y + placedRect.l < fr.y + fr.l) {
        newFree.push({ x: fr.x, y: placedRect.y + placedRect.l, w: fr.w, l: fr.y + fr.l - (placedRect.y + placedRect.l) });
      }
    }
    const pruned = newFree.filter((r) => r.w > 0 && r.l > 0);
    bin.freeRects = pruned.filter((r, i) => !pruned.some((other, j) => j !== i && rectContains(other, r)));
    return true;
  }

  for (const plate of sorted) {
    let placed = false;
    for (const bin of bins) {
      if (placeInBin(bin, plate)) {
        placed = true;
        break;
      }
    }
    if (!placed) {
      const fitsNormal = plate.w <= binW && plate.l <= binL;
      const fitsRotated = plate.l <= binW && plate.w <= binL;
      if (!fitsNormal && !fitsRotated) continue;
      const newBin = { freeRects: [{ x: 0, y: 0, w: binW, l: binL }], placed: [] as PlacedRect[] };
      bins.push(newBin);
      placeInBin(newBin, plate);
    }
  }

  return bins.map((b) => b.placed);
}

/** Subtracts packed (non-filler) rects from the `binW`x`binL` area, returning the exact leftover free rectangles. */
function getEmptyRectangles(binW: number, binL: number, occupied: Rect[]): Rect[] {
  let free: Rect[] = [{ x: 0, y: 0, w: binW, l: binL }];
  for (const occ of occupied) {
    const next: Rect[] = [];
    for (const fr of free) {
      let { x: fx, y: fy, w: fw, l: fl } = fr;
      if (occ.x < fx + fw && occ.x + occ.w > fx && occ.y < fy + fl && occ.y + occ.l > fy) {
        if (occ.x > fx) {
          next.push({ x: fx, y: fy, w: occ.x - fx, l: fl });
          fw = fw - (occ.x - fx);
          fx = occ.x;
        }
        if (occ.x + occ.w < fx + fw) {
          next.push({ x: occ.x + occ.w, y: fy, w: fx + fw - (occ.x + occ.w), l: fl });
          fw = occ.x + occ.w - fx;
        }
        if (occ.y > fy) next.push({ x: fx, y: fy, w: fw, l: occ.y - fy });
        if (occ.y + occ.l < fy + fl) next.push({ x: fx, y: occ.y + occ.l, w: fw, l: fy + fl - (occ.y + occ.l) });
      } else {
        next.push(fr);
      }
    }
    free = next;
  }
  return free.filter((r) => r.w > 0 && r.l > 0);
}

// ---------------------------------------------------------------------------
// 1D knapsack — stacks layers (of possibly different thicknesses) into a
// block's height, maximizing used height without exceeding it.
// ---------------------------------------------------------------------------

/** Returns indices (into `thicknesses`) of the subset that best fills `capacity` without exceeding it. */
function knapsack1D(thicknesses: number[], capacity: number): number[] {
  const n = thicknesses.length;
  const dp = new Int32Array(capacity + 1);
  const chosen = new Int32Array(capacity + 1).fill(-1);

  for (let i = 0; i < n; i++) {
    const val = thicknesses[i]!;
    if (val <= 0 || val > capacity) continue;
    for (let w = capacity; w >= val; w--) {
      if (dp[w - val]! + val > dp[w]!) {
        dp[w] = dp[w - val]! + val;
        chosen[w] = i;
      }
    }
  }

  let maxVal = -1;
  let maxW = 0;
  for (let w = 0; w <= capacity; w++) {
    if (dp[w]! > maxVal) {
      maxVal = dp[w]!;
      maxW = w;
    }
  }

  const indices: number[] = [];
  let currW = maxW;
  while (currW > 0 && chosen[currW] !== -1) {
    const idx = chosen[currW]!;
    indices.push(idx);
    currW -= thicknesses[idx]!;
  }
  return indices;
}

// ---------------------------------------------------------------------------
// Working (mm-scale) types for one physical block
// ---------------------------------------------------------------------------

interface RawSlot extends Rect {
  prod: string;
  isFiller: boolean;
  rotated: boolean;
}

interface RawCapa {
  thicknessMm: number;
  slots: RawSlot[];
}

interface RawColumna {
  largoColumnaMm: number;
  capas: RawCapa[];
}

interface RawBlock {
  colorBlock: string;
  wMm: number; // ancho
  lMm: number; // largo
  hMm: number; // alto
  columnas: RawColumna[];
}

interface PoolPlate {
  uuid: number;
  prod: string;
  thicknessMm: number;
  wMm: number;
  lMm: number;
}

interface BlockTemplateMm {
  colorBlock: string;
  wMm: number;
  lMm: number;
  hMm: number;
}

function usefulVolumeMm3(block: RawBlock): number {
  let vol = 0;
  for (const col of block.columnas) {
    for (const capa of col.capas) {
      for (const s of capa.slots) {
        if (!s.isFiller) vol += s.w * s.l * capa.thicknessMm;
      }
    }
  }
  return vol;
}

function blockVolumeMm3(block: RawBlock): number {
  return block.wMm * block.lMm * block.hMm;
}

// ---------------------------------------------------------------------------
// Fast path: "pure" blocks (a single product/thickness tiling an entire
// block) whenever demand for that item alone reaches ≥70% volumetric
// efficiency on some block template.
// ---------------------------------------------------------------------------

function buildPureBlocks(pool: PoolPlate[], blocksColorMm: BlockTemplateMm[]): { pureBlocks: RawBlock[]; usedUuids: Set<number> } {
  const byKey = new Map<string, PoolPlate[]>();
  for (const p of pool) {
    const key = `${p.prod}|${p.thicknessMm}|${p.wMm}|${p.lMm}`;
    const arr = byKey.get(key);
    if (arr) arr.push(p);
    else byKey.set(key, [p]);
  }

  const pureBlocks: RawBlock[] = [];
  const usedUuids = new Set<number>();

  for (const items of byKey.values()) {
    const { prod, thicknessMm: thickness, wMm: w, lMm: l } = items[0]!;
    const qty = items.length;

    let best: { template: BlockTemplateMm; N: number; k: number; nRow: number; nCol: number; rot: boolean; efficiency: number } | null = null;

    for (const tpl of blocksColorMm) {
      const nRowNorm = Math.floor(tpl.wMm / w);
      const nColNorm = Math.floor(tpl.lMm / l);
      const nNorm = nRowNorm * nColNorm;
      const nRowRot = Math.floor(tpl.wMm / l);
      const nColRot = Math.floor(tpl.lMm / w);
      const nRot = nRowRot * nColRot;

      const rot = nRot > nNorm;
      const nMax = rot ? nRot : nNorm;
      const nRow = rot ? nRowRot : nRowNorm;
      const nCol = rot ? nColRot : nColNorm;

      const k = Math.floor(tpl.hMm / thickness);
      const N = k * nMax;
      if (N <= 0) continue;

      const pureVol = N * w * l * thickness;
      const blockVol = tpl.wMm * tpl.lMm * tpl.hMm;
      const efficiency = pureVol / blockVol;

      if (efficiency >= 0.7 && (!best || efficiency > best.efficiency)) {
        best = { template: tpl, N, k, nRow, nCol, rot, efficiency };
      }
    }

    if (best && qty >= best.N) {
      const { template: tpl, N, k, nRow, nCol, rot } = best;
      const numBlocks = Math.floor(qty / N);
      let itemIdx = 0;

      for (let bIdx = 0; bIdx < numBlocks; bIdx++) {
        const capas: RawCapa[] = [];
        for (let layer = 0; layer < k; layer++) {
          const itemW = rot ? l : w;
          const itemL = rot ? w : l;
          const slots: RawSlot[] = [];
          for (let r = 0; r < nRow; r++) {
            for (let c = 0; c < nCol; c++) {
              const item = items[itemIdx++]!;
              usedUuids.add(item.uuid);
              slots.push({ x: r * itemW, y: c * itemL, w: itemW, l: itemL, prod, isFiller: false, rotated: rot });
            }
          }
          const empty = getEmptyRectangles(tpl.wMm, tpl.lMm, slots);
          for (const e of empty) slots.push({ ...e, prod: 'scrap', isFiller: true, rotated: false });
          capas.push({ thicknessMm: thickness, slots });
        }
        pureBlocks.push({
          colorBlock: tpl.colorBlock,
          wMm: tpl.wMm,
          lMm: tpl.lMm,
          hMm: tpl.hMm,
          columnas: [{ largoColumnaMm: tpl.lMm, capas }],
        });
      }
    }
  }

  return { pureBlocks, usedUuids };
}

// ---------------------------------------------------------------------------
// Leftover packing: whatever didn't fit the "pure block" fast path gets
// greedily packed into single- or multi-column blocks, one block-worth
// (by strategy) at a time, always keeping the strategy with the best
// individual-block volumetric efficiency.
// ---------------------------------------------------------------------------

function generarParticiones(pool: PoolPlate[], lbMm: number): number[][] {
  const uniq = new Set<number>();
  for (const p of pool) {
    uniq.add(p.wMm);
    uniq.add(p.lMm);
  }
  const validos = [...uniq].filter((v) => v >= 480 && v <= lbMm - 480).sort((a, b) => b - a);

  const candidatos: number[][] = [];
  for (const corte of validos) candidatos.push([corte, lbMm - corte]);
  for (let i = 0; i < validos.length; i++) {
    for (let j = i; j < validos.length; j++) {
      const colA = validos[i]!;
      const colB = validos[j]!;
      const colC = lbMm - colA - colB;
      if (colC >= 480) candidatos.push([colA, colB, colC]);
    }
  }
  candidatos.sort((a, b) => b[0]! - a[0]!);
  return candidatos.slice(0, 20);
}

function asignarPlacasAColumnas(pool: PoolPlate[], columnLens: number[]): PoolPlate[][] {
  const columnas: PoolPlate[][] = columnLens.map(() => []);
  for (const p of pool) {
    const candidatos: [number, number][] = [];
    columnLens.forEach((colLen, i) => {
      if (p.lMm <= colLen || p.wMm <= colLen) candidatos.push([colLen, i]);
    });
    let idx: number;
    if (candidatos.length > 0) {
      candidatos.sort((a, b) => a[0] - b[0]);
      idx = candidatos[0]![1];
    } else {
      idx = columnLens.indexOf(Math.max(...columnLens));
    }
    columnas[idx]!.push(p);
  }
  return columnas;
}

function packColumnIntoLayers(binW: number, colLenMm: number, items: PoolPlate[]): { capas: RawCapa[]; usedUuids: Set<number> } {
  const byThickness = new Map<number, PoolPlate[]>();
  for (const it of items) {
    const arr = byThickness.get(it.thicknessMm);
    if (arr) arr.push(it);
    else byThickness.set(it.thicknessMm, [it]);
  }

  const capas: RawCapa[] = [];
  const usedUuids = new Set<number>();
  for (const [thickness, plates] of byThickness) {
    const bins = maxRectsPackMultiBin(
      binW,
      colLenMm,
      plates.map((p) => ({ uuid: p.uuid, w: p.wMm, l: p.lMm, prod: p.prod }))
    );
    for (const bin of bins) {
      const slots: RawSlot[] = bin.map((pl) => {
        usedUuids.add(pl.uuid);
        return { x: pl.x, y: pl.y, w: pl.w, l: pl.l, prod: pl.prod, isFiller: false, rotated: pl.rotated };
      });
      const empty = getEmptyRectangles(binW, colLenMm, slots);
      for (const e of empty) slots.push({ ...e, prod: 'scrap', isFiller: true, rotated: false });
      capas.push({ thicknessMm: thickness, slots });
    }
  }
  return { capas, usedUuids };
}

/** Stacks `capas` (possibly of mixed thickness) into as many height-limited groups as needed. */
function stackCapasIntoBlocks(capasIn: RawCapa[], hbMm: number): RawCapa[][] {
  const remaining = [...capasIn];
  const blocks: RawCapa[][] = [];

  while (remaining.length > 0) {
    const limitN = Math.min(remaining.length, 60);
    const thicknesses = remaining.slice(0, limitN).map((c) => c.thicknessMm);
    const chosenIdx = knapsack1D(thicknesses, hbMm);

    let blockCapas: RawCapa[] = [];
    if (chosenIdx.length > 0) {
      for (const idx of [...chosenIdx].sort((a, b) => b - a)) {
        blockCapas.push(remaining[idx]!);
        remaining.splice(idx, 1);
      }
    } else {
      let h = 0;
      let idx = 0;
      while (idx < remaining.length) {
        if (h + remaining[idx]!.thicknessMm <= hbMm) {
          blockCapas.push(remaining[idx]!);
          h += remaining[idx]!.thicknessMm;
          remaining.splice(idx, 1);
        } else {
          idx++;
        }
      }
    }
    if (blockCapas.length === 0) break; // nothing fits at all — avoid an infinite loop
    blocks.push(blockCapas);
  }

  return blocks;
}

/** Builds one physical block (and any height-overflow continuations) from a column-length split and the items assigned to each column. */
function buildBlockFromColumns(colLensMm: number[], columnItems: PoolPlate[][], template: BlockTemplateMm): { blocks: RawBlock[]; usedUuids: Set<number> } {
  const usedUuids = new Set<number>();
  const perColumn: { colLenMm: number; stacks: RawCapa[][] }[] = [];

  for (let i = 0; i < colLensMm.length; i++) {
    const { capas, usedUuids: used } = packColumnIntoLayers(template.wMm, colLensMm[i]!, columnItems[i]!);
    for (const u of used) usedUuids.add(u);
    perColumn.push({ colLenMm: colLensMm[i]!, stacks: stackCapasIntoBlocks(capas, template.hMm) });
  }

  const maxStacks = Math.max(1, ...perColumn.map((c) => c.stacks.length));
  const blocks: RawBlock[] = [];
  for (let s = 0; s < maxStacks; s++) {
    const columnas: RawColumna[] = [];
    for (const col of perColumn) {
      const capas = col.stacks[s] ?? [];
      if (capas.length === 0 && perColumn.length > 1) continue; // drop empty columns on height-overflow continuations
      columnas.push({ largoColumnaMm: col.colLenMm, capas });
    }
    if (columnas.length === 0) continue;
    blocks.push({ colorBlock: template.colorBlock, wMm: template.wMm, lMm: template.lMm, hMm: template.hMm, columnas });
  }
  return { blocks, usedUuids };
}

function packLeftoverGreedy(poolInit: PoolPlate[], blocksColorMm: BlockTemplateMm[]): RawBlock[] {
  let pool = [...poolInit];
  const result: RawBlock[] = [];

  while (pool.length > 0) {
    let bestBlocks: RawBlock[] | null = null;
    let bestUsedUuids: Set<number> | null = null;
    let bestEff = -1;

    for (const tpl of blocksColorMm) {
      const candidates: { colLens: number[]; columnItems: PoolPlate[][] }[] = [{ colLens: [tpl.lMm], columnItems: [pool] }];

      for (const partition of generarParticiones(pool, tpl.lMm)) {
        const columnItems = asignarPlacasAColumnas(pool, partition);
        if (columnItems.filter((c) => c.length > 0).length < 2) continue;
        candidates.push({ colLens: partition, columnItems });
      }

      for (const cand of candidates) {
        const { blocks, usedUuids } = buildBlockFromColumns(cand.colLens, cand.columnItems, tpl);
        if (blocks.length === 0 || usedUuids.size === 0) continue;
        const eff = usefulVolumeMm3(blocks[0]!) / blockVolumeMm3(blocks[0]!);
        if (eff > bestEff) {
          bestEff = eff;
          bestBlocks = blocks;
          bestUsedUuids = usedUuids;
        }
      }
    }

    if (!bestBlocks || !bestUsedUuids || bestUsedUuids.size === 0) break;
    result.push(...bestBlocks);
    const used = bestUsedUuids;
    pool = pool.filter((p) => !used.has(p.uuid));
  }

  return result;
}

// ---------------------------------------------------------------------------
// De-scaled (cm) output shape
// ---------------------------------------------------------------------------

export interface PackedSlot {
  x: number;
  y: number;
  w: number;
  l: number;
  prod: string;
  orient: 'Normal' | 'Rotada';
  isFiller: boolean;
}

export interface Capa {
  thicknessCm: number;
  packedSlots: PackedSlot[];
}

export interface Columna {
  largoColumnaCm: number;
  capas: Capa[];
}

export interface DesperdicioLateral {
  largoColumnaCm: number;
  desperdicioCm: number;
}

export interface Bloque {
  colorBloque: string;
  anchoBloqueCm: number;
  largoBloqueCm: number;
  altoBloqueCm: number;
  columnas: Columna[];
  /** How many placas of each type ended up in this block, e.g. "VERDE PLACA 200X200X3: 6 placas". */
  placasDetalle: string[];
  desperdiciosLaterales: DesperdicioLateral[];
  desperdicioFondoCm: number;
  eficiencia: number;
}

function rawBlockToBloque(b: RawBlock): Bloque {
  const placasMap = new Map<string, number>();
  for (const col of b.columnas) {
    for (const capa of col.capas) {
      for (const s of capa.slots) {
        if (!s.isFiller) placasMap.set(s.prod, (placasMap.get(s.prod) ?? 0) + 1);
      }
    }
  }
  const placasDetalle: string[] = [];
  for (const [prod, cant] of placasMap) {
    placasDetalle.push(`${prod.toUpperCase()}: ${cant} placas`);
  }

  let maxYVal = 0;
  for (const col of b.columnas) {
    for (const capa of col.capas) {
      for (const s of capa.slots) {
        if (!s.isFiller && s.y + s.l > maxYVal) maxYVal = s.y + s.l;
      }
    }
  }

  const desperdiciosLaterales: DesperdicioLateral[] = b.columnas.map((col) => {
    let maxXCol = 0;
    for (const capa of col.capas) {
      for (const s of capa.slots) {
        if (!s.isFiller && s.x + s.w > maxXCol) maxXCol = s.x + s.w;
      }
    }
    const desp = maxXCol > 0 ? b.wMm - maxXCol : b.wMm;
    return { largoColumnaCm: col.largoColumnaMm / 10, desperdicioCm: desp / 10 };
  });

  const desperdicioFondoCm = (maxYVal > 0 ? b.lMm - maxYVal : b.lMm) / 10;

  const volTotal = (b.wMm / 10) * (b.lMm / 10) * (b.hMm / 10);
  let volUtil = 0;
  for (const col of b.columnas) {
    for (const capa of col.capas) {
      for (const s of capa.slots) {
        if (!s.isFiller) volUtil += (s.w / 10) * (s.l / 10) * (capa.thicknessMm / 10);
      }
    }
  }
  const eficiencia = volTotal > 0 ? (volUtil / volTotal) * 100 : 0;

  const columnas: Columna[] = b.columnas.map((col) => ({
    largoColumnaCm: col.largoColumnaMm / 10,
    capas: col.capas.map((capa) => ({
      thicknessCm: capa.thicknessMm / 10,
      packedSlots: capa.slots.map(
        (s): PackedSlot => ({
          x: s.x / 10,
          y: s.y / 10,
          w: s.w / 10,
          l: s.l / 10,
          prod: s.prod,
          orient: s.rotated ? 'Rotada' : 'Normal',
          isFiller: s.isFiller,
        })
      ),
    })),
  }));

  return {
    colorBloque: b.colorBlock,
    anchoBloqueCm: b.wMm / 10,
    largoBloqueCm: b.lMm / 10,
    altoBloqueCm: b.hMm / 10,
    columnas,
    placasDetalle,
    desperdiciosLaterales,
    desperdicioFondoCm,
    eficiencia,
  };
}

// ---------------------------------------------------------------------------
// Per-color / top-level orchestration
// ---------------------------------------------------------------------------

interface DemandaPlaca {
  placa: PlacaSpec;
  cantidad: number;
}

function procesarOptimizacionColor(color: string, demandaPlacas: DemandaPlaca[], blocksColor: BlockSpec[]): Bloque[] {
  let uuidCounter = 0;
  const pool: PoolPlate[] = [];
  demandaPlacas.forEach((d) => {
    if (d.placa.colorBlock !== color) return;
    const totalPlacas = Math.round(d.cantidad);
    if (totalPlacas < 1) return;
    const wMm = Math.round(d.placa.corteAnchoCm * 10);
    const lMm = Math.round(d.placa.corteLargoCm * 10);
    const thicknessMm = Math.round(d.placa.corteAltoCm * 10);
    for (let i = 0; i < totalPlacas; i++) {
      pool.push({
        uuid: uuidCounter++,
        prod: d.placa.nombrePlaca,
        thicknessMm,
        wMm,
        lMm,
      });
    }
  });
  if (pool.length === 0) return [];

  const blocksColorMm: BlockTemplateMm[] = blocksColor
    .filter((b) => b.colorBlock === color)
    .map((b) => ({
      colorBlock: b.colorBlock,
      wMm: Math.round(b.anchoBlockCm * 10),
      lMm: Math.round(b.largoBlockCm * 10),
      hMm: Math.round(b.altoBlockCm * 10),
    }));
  if (blocksColorMm.length === 0) return [];

  const { pureBlocks, usedUuids: pureUsed } = buildPureBlocks(pool, blocksColorMm);
  const remainingPool = pool.filter((p) => !pureUsed.has(p.uuid));
  const leftoverBlocks = packLeftoverGreedy(remainingPool, blocksColorMm);

  return [...pureBlocks, ...leftoverBlocks].map(rawBlockToBloque);
}

export interface ProcesarOptimizacionResult {
  bloques: Bloque[];
  sinMatch: string[];
}

/**
 * Top-level entry: matches live Odoo demand (already denominated in placas —
 * one `mrp.production` order per placa type, see odoo/multicorte.ts) against
 * the base técnica by `nombrePlaca`, groups by block color, and optimizes
 * each color in isolation. Mirrors `procesar_optimizacion` in the original
 * Python tool (minus the mattress→placa unit conversion, which doesn't
 * apply to this data source).
 */
export function procesarOptimizacion(demanda: DemandaRow[], placas: PlacaSpec[], blocks: BlockSpec[], filtroColor?: string): ProcesarOptimizacionResult {
  const placaPorNombre = new Map<string, PlacaSpec>();
  for (const p of placas) placaPorNombre.set(p.nombrePlaca.trim().toLowerCase(), p);

  const sinMatch: string[] = [];
  const demandaPlacas: DemandaPlaca[] = [];
  for (const d of demanda) {
    const placa = placaPorNombre.get(d.producto.trim().toLowerCase());
    if (!placa) {
      sinMatch.push(d.producto);
      continue;
    }
    demandaPlacas.push({ placa, cantidad: d.cantidad });
  }

  const colores = new Set<string>();
  for (const d of demandaPlacas) {
    if (filtroColor && filtroColor !== 'Todos' && d.placa.colorBlock !== filtroColor.toLowerCase()) continue;
    colores.add(d.placa.colorBlock);
  }

  const bloques: Bloque[] = [];
  for (const color of colores) {
    bloques.push(...procesarOptimizacionColor(color, demandaPlacas, blocks));
  }

  bloques.sort((a, b) => colorSortIndex(a.colorBloque) - colorSortIndex(b.colorBloque) || b.eficiencia - a.eficiencia);

  return { bloques, sinMatch };
}

// ---------------------------------------------------------------------------
// Post-hoc analysis, used by both the UI filters and the Excel export
// ---------------------------------------------------------------------------

/** Whether a block has any reusable ("Disponible") offcut, vs. being a fully "Entero" (no leftovers worth keeping) block. */
export function tieneRetazosDisponibles(b: Bloque): boolean {
  for (const col of b.columnas) {
    const totalCapasColH = col.capas.reduce((s, c) => s + c.thicknessCm, 0);
    const scrapAltura = b.altoBloqueCm - totalCapasColH;
    if (scrapAltura > 0 && esDisponible(b.anchoBloqueCm, col.largoColumnaCm, scrapAltura)) return true;
  }
  const totalColumnsWidth = b.columnas.reduce((s, c) => s + c.largoColumnaCm, 0);
  const blockScrapWidth = b.largoBloqueCm - totalColumnsWidth;
  if (blockScrapWidth > 0 && esDisponible(b.anchoBloqueCm, blockScrapWidth, b.altoBloqueCm)) return true;

  for (const col of b.columnas) {
    for (const capa of col.capas) {
      for (const s of capa.packedSlots) {
        if (s.isFiller && esDisponible(s.w, s.l, capa.thicknessCm)) return true;
      }
      const totalUsedL = capa.packedSlots.reduce((s, sl) => s + sl.l, 0);
      const scrapWidth = col.largoColumnaCm - totalUsedL;
      if (scrapWidth > 0 && esDisponible(b.anchoBloqueCm, scrapWidth, capa.thicknessCm)) return true;
    }
  }
  return false;
}

export interface SobranteEntry {
  anchoCm: number;
  largoCm: number;
  espesorCm: number;
  eje: 'ancho' | 'largo' | 'alto';
  cantidad: number;
}

/** Classifies every leftover region of a block (per-column length tail, per-layer lateral strips, column height tail, block length excess) as "Disponible" (reusable) or "Scrap". Mirrors the leftover analysis in `render_panel_color`. */
export function analizarSobrantes(b: Bloque): { disponibles: SobranteEntry[]; scrap: SobranteEntry[] } {
  const disponibles = new Map<string, SobranteEntry>();
  const scrap = new Map<string, SobranteEntry>();
  const anchoB = b.anchoBloqueCm;

  function clasificar(anchoCm: number, largoCm: number, espesorCm: number, eje: SobranteEntry['eje']) {
    const map = esDisponible(anchoCm, largoCm, espesorCm) ? disponibles : scrap;
    const a = fmtNum(anchoCm);
    const l = fmtNum(largoCm);
    const e = fmtNum(espesorCm);
    const key = `${a}|${l}|${e}|${eje}`;
    const existing = map.get(key);
    if (existing) existing.cantidad += 1;
    else map.set(key, { anchoCm: a, largoCm: l, espesorCm: e, eje, cantidad: 1 });
  }

  for (const col of b.columnas) {
    const colLargo = col.largoColumnaCm;
    for (const capa of col.capas) {
      const t = capa.thicknessCm;
      const realSlots = capa.packedSlots.filter((s) => !s.isFiller);

      if (realSlots.length === 0) {
        if (colLargo > 0.1) clasificar(anchoB, colLargo, t, 'largo');
        continue;
      }

      const maxYEnd = Math.max(...realSlots.map((s) => s.y + s.l));
      const largoEnd = colLargo - maxYEnd;
      if (largoEnd > 0.1) clasificar(anchoB, largoEnd, t, 'largo');

      const yLimits = [...new Set([...realSlots.map((s) => s.y), ...realSlots.map((s) => s.y + s.l)])].sort((a, c) => a - c);
      let pendingLateral: { w: number; l: number } | null = null;
      const flush = () => {
        if (!pendingLateral) return;
        clasificar(pendingLateral.w, pendingLateral.l, t, 'ancho');
        pendingLateral = null;
      };

      for (let i = 0; i < yLimits.length - 1; i++) {
        const yA = yLimits[i]!;
        const yB = yLimits[i + 1]!;
        const segLen = yB - yA;
        if (segLen <= 0.1) continue;

        const slotsHere = realSlots.filter((s) => s.y < yB - 0.1 && s.y + s.l > yA + 0.1);
        if (slotsHere.length === 0) {
          flush();
          continue;
        }
        const maxXEnd = Math.max(...slotsHere.map((s) => s.x + s.w));
        const lateralW = anchoB - maxXEnd;
        if (lateralW > 0.1) {
          if (pendingLateral && Math.abs(pendingLateral.w - lateralW) < 0.1) pendingLateral.l += segLen;
          else {
            flush();
            pendingLateral = { w: lateralW, l: segLen };
          }
        } else {
          flush();
        }
      }
      flush();
    }
  }

  for (const col of b.columnas) {
    const alturaUsada = col.capas.reduce((s, c) => s + c.thicknessCm, 0);
    const sobranteAlto = b.altoBloqueCm - alturaUsada;
    if (sobranteAlto > 0) clasificar(anchoB, col.largoColumnaCm, sobranteAlto, 'alto');
  }

  const largoUsado = b.columnas.reduce((s, c) => s + c.largoColumnaCm, 0);
  const sobranteLargo = b.largoBloqueCm - largoUsado;
  if (sobranteLargo > 0) clasificar(anchoB, sobranteLargo, b.altoBloqueCm, 'largo');

  const byMagnitude = (a: SobranteEntry, c: SobranteEntry) => c.anchoCm - a.anchoCm || c.largoCm - a.largoCm || c.espesorCm - a.espesorCm;
  return {
    disponibles: [...disponibles.values()].sort(byMagnitude),
    scrap: [...scrap.values()].sort(byMagnitude),
  };
}

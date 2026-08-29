import { searchReadAll } from './client';
import { withTtlCache, cacheKey } from '../cache';

/**
 * Warehouse rack cells follow `WH/Existencias/<RACK>.<COLUMN>.<LEVEL>`
 * (e.g. `F.3.E`) — confirmed live. Anything else under WH/Existencias
 * (PALLET.*, PICKING*, `C.6.A.CHINA`, stray slash-typo names, etc.) simply
 * doesn't match this pattern and is skipped, no exclusion list needed.
 */
const LOCATION_CODE_RE = /^([A-F])\.(\d{1,2})\.([A-F])$/;

const LAYOUT_TTL_MS = 10 * 60 * 1000;
const UBICACION_TTL_MS = 60 * 1000;

export interface RackColumnData {
  column: number;
  levels: string[];
}

export interface RackData {
  rack: string;
  columns: RackColumnData[];
}

export interface WarehouseLayout {
  racks: RackData[];
  occupiedCodes: string[];
}

export interface UbicacionProducto {
  producto: string;
  cantidad: number;
  unidad: string;
}

/**
 * Odoo's `uom.uom` names are mostly fine to show as-is (kg, m, m², L, t...)
 * but the "Unit" category record is named "Units" in English regardless of
 * app language — shorten just that one to match how the rest of this
 * Spanish UI reads.
 */
function formatUom(name: string): string {
  return name === 'Units' ? 'u' : name;
}

export interface UbicacionStockResult {
  codigo: string;
  productos: UbicacionProducto[];
}

/**
 * The real rack grid isn't a clean rectangle — confirmed live that level
 * sets vary per column within the same rack (e.g. Rack A columns 6-12 are
 * missing level B while columns 1-5 have it). So this reads every real
 * `stock.location` under WH/Existencias and reports exactly what exists,
 * rather than a hand-typed columns×levels table that would either point
 * clickable cells at locations that don't exist, or hide real ones.
 */
export async function getWarehouseLayout(): Promise<WarehouseLayout> {
  return withTtlCache('almacen:layout', LAYOUT_TTL_MS, async () => {
    const rows = await searchReadAll<{ id: number; name: string }>({
      model: 'stock.location',
      domain: [
        ['complete_name', 'like', 'WH/Existencias/%'],
        ['usage', '=', 'internal'],
      ],
      fields: ['id', 'name'],
    });

    const racks = new Map<string, Map<number, Set<string>>>();
    const codigoById = new Map<number, string>();
    for (const row of rows) {
      const match = LOCATION_CODE_RE.exec(row.name);
      if (!match) continue;
      codigoById.set(row.id, row.name);
      const rack = match[1]!;
      const column = Number(match[2]!);
      const level = match[3]!;
      let columns = racks.get(rack);
      if (!columns) {
        columns = new Map<number, Set<string>>();
        racks.set(rack, columns);
      }
      let levels = columns.get(column);
      if (!levels) {
        levels = new Set<string>();
        columns.set(column, levels);
      }
      levels.add(level);
    }

    // Bulk "does this cell have any stock" check, so the map can shade
    // occupied vs. empty cells without a request per cell — one extra
    // Odoo call, cached alongside the layout itself.
    const occupiedCodes: string[] = [];
    const locationIds = [...codigoById.keys()];
    if (locationIds.length > 0) {
      const quants = await searchReadAll<{ location_id: [number, string] }>({
        model: 'stock.quant',
        domain: [
          ['location_id', 'in', locationIds],
          ['quantity', '>', 0],
        ],
        fields: ['location_id'],
      });
      const occupiedIds = new Set(quants.map((q) => q.location_id[0]));
      for (const id of occupiedIds) {
        const codigo = codigoById.get(id);
        if (codigo) occupiedCodes.push(codigo);
      }
    }

    return {
      racks: [...racks.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([rack, columns]) => ({
          rack,
          columns: [...columns.entries()]
            .sort(([a], [b]) => a - b)
            .map(([column, levels]) => ({ column, levels: [...levels].sort() })),
        })),
      occupiedCodes,
    };
  });
}

/**
 * Sums `quantity` per product across every `stock.quant` row at a
 * location, rather than returning raw quant rows — confirmed live that
 * lots are used extensively here (2578/3284 quants under WH/Existencias
 * carry a lot_id), so a single product routinely has several quant rows
 * at the same location that need merging into one figure.
 */
export async function getUbicacionStock(codigo: string): Promise<UbicacionStockResult> {
  return withTtlCache(cacheKey('almacen:ubicacion', { codigo }), UBICACION_TTL_MS, async () => {
    const locations = await searchReadAll<{ id: number }>({
      model: 'stock.location',
      domain: [['complete_name', '=', `WH/Existencias/${codigo}`]],
      fields: ['id'],
      limit: 1,
    });
    const location = locations[0];
    if (!location) {
      return { codigo, productos: [] };
    }

    const quants = await searchReadAll<{ product_id: [number, string]; quantity: number; product_uom_id: [number, string] }>({
      model: 'stock.quant',
      domain: [['location_id', '=', location.id]],
      fields: ['product_id', 'quantity', 'product_uom_id'],
    });

    const byProduct = new Map<string, { cantidad: number; unidad: string }>();
    for (const q of quants) {
      const name = q.product_id[1];
      const existing = byProduct.get(name);
      if (existing) {
        existing.cantidad += q.quantity;
      } else {
        byProduct.set(name, { cantidad: q.quantity, unidad: formatUom(q.product_uom_id[1]) });
      }
    }

    const productos = [...byProduct.entries()]
      .map(([producto, { cantidad, unidad }]) => ({ producto, cantidad, unidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    return { codigo, productos };
  });
}

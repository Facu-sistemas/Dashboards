/**
 * Physical floor-plan facts Odoo has no record of — everything else (which
 * columns/levels actually exist per rack) comes live from `stock.location`
 * via /api/almacen-layout. Confirmed live against real data:
 * - Rack row order top-to-bottom (entrance to back) with an aisle after A,
 *   after C, and after the D/E pair — matches the plan's "A↔B, C↔D, D/E↔F"
 *   description in one structure.
 * - The izquierdo/derecho split point per rack: exact for B/C/D (izq=5
 *   columns matches Odoo's real column counts there); best available
 *   reading for A/F without the original sketch.
 * - Rack E: 71 stock.location rows exist in Odoo but only 3 carry any
 *   stock — not physically built yet, so it stays a static "Próximamente"
 *   block regardless of what the live data says (deliberately NOT derived
 *   from stock levels, so it doesn't flip on its own from a one-off test
 *   entry).
 * - F.15.A: not a real stock.location (confirmed live) — a desk with a
 *   fixed PC. Rendered as an extra cell so the grid closes visually, but
 *   never queried against Odoo.
 */

// Top-to-bottom VISUAL order (F = fondo/back of the warehouse, at the top
// of the drawing; A = entrada, at the bottom) — confirmed against the
// user's floor-plan sketch.
export const RACK_ROW_ORDER = ['F', 'E', 'D', 'C', 'B', 'A'];

// Aisle rendered right after these racks (in RACK_ROW_ORDER's order) — so
// F/E, D/C and B/A each get a gap between them, while the D-E and B-C
// pairs stay flush ("comparten espalda", per the sketch).
export const AISLE_AFTER = new Set(['F', 'D', 'B']);

export const RACK_SIDE_SPLIT: Record<string, number> = { A: 5, B: 5, C: 5, D: 5, F: 4 };

export const INACTIVE_RACKS = new Set(['E']);

export const DESK_CELL = {
  rack: 'F',
  column: 15,
  level: 'A',
  codigo: 'F.15.A',
  label: 'Puesto de trabajo — PC (no es ubicación de stock)',
} as const;

// Almacén 2 is a single Odoo location (`WH/Existencias/Almacen 2`) with no
// internal rack/column breakdown — clicking it in the overview goes straight
// to the stock panel, skipping the rack-detail grid step.
export const ALMACEN_2_CODIGO = 'Almacen 2';

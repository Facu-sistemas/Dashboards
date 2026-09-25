import type { DemandaRow } from './odoo/multicorte';

export interface ParseManualDemandaResult {
  demanda: DemandaRow[];
  erroresLinea: string[];
}

/**
 * Parses a pasted PRODUCTO / CANTIDAD table (straight out of Excel/Sheets —
 * tab-separated, one optional header row, one entry per line) into demanda
 * rows, summing repeated products. Same shape `getMulticorteDemanda` returns
 * from Odoo, so it feeds directly into `procesarOptimizacion`.
 */
export function parseManualDemanda(raw: string): ParseManualDemandaResult {
  const lines = raw
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const totals = new Map<string, number>();
  const erroresLinea: string[] = [];

  for (const line of lines) {
    if (/^producto\b/i.test(line) && /cantidad/i.test(line)) continue; // header row

    let producto: string | undefined;
    let cantidadRaw: string | undefined;

    if (line.includes('\t')) {
      const parts = line
        .split('\t')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (parts.length >= 2) {
        producto = parts.slice(0, -1).join(' ');
        cantidadRaw = parts[parts.length - 1];
      }
    } else {
      // Fallback for space/comma-separated paste: last token is the qty,
      // everything before it (product names can end in a number, e.g.
      // "...X190X24") is the product.
      const m = /^(.*\S)[\s,;]+(\d+(?:[.,]\d+)?)$/.exec(line);
      if (m) {
        producto = m[1];
        cantidadRaw = m[2];
      }
    }

    const cantidad = cantidadRaw !== undefined ? Number(cantidadRaw.replace(',', '.')) : NaN;
    if (!producto || !Number.isFinite(cantidad) || cantidad <= 0) {
      erroresLinea.push(line);
      continue;
    }

    const key = producto.toUpperCase();
    totals.set(key, (totals.get(key) ?? 0) + cantidad);
  }

  const demanda: DemandaRow[] = [...totals.entries()].map(([producto, cantidad]) => ({ producto, cantidad }));
  return { demanda, erroresLinea };
}

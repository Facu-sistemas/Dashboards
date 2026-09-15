/**
 * Real "unidades consensuadas" — Producción's own forward plan for
 * Colchones/Sillones, from the same validated planning spreadsheet
 * Marlynet's Presupuesto Excel cites ("proyeccion vtas 2026", fila
 * "Consensuado Producción Sillones/Colchones"). Confirmed live (2026-09):
 * loading January's real values here (6.480 colchones, 792 sillones,
 * vs. a placeholder guess) moved TDI's presupuestado from 4% to 60% of
 * Marlynet's reference — this is the dominant input, more than any BOM
 * or cost-matching detail.
 *
 * The file has THREE near-identical "Consensuado" blocks (VENTAS
 * CONSENSUADO / PRODUCCION CONSENSUADO / FACTURACION CONSENSUADO), each
 * with a row literally named "Consensuado Sillones Equivalente" — only
 * PRODUCCION CONSENSUADO's is the one Marlynet's own worked example
 * cites, so this parser tracks which section it's currently inside
 * (an all-caps label row with empty month columns) rather than matching
 * the row label alone, to never silently grab the wrong block.
 *
 * This is a year-specific file, named "Proyeccion ventas {año}.csv", read
 * from `src/data/` (NOT `public/`) via Vite's `import.meta.glob` — every
 * matching file gets bundled at build time and the right one is picked at
 * runtime by PROYECCION_VENTAS_YEAR (default 2026, see .env.example).
 * Deliberately NOT a runtime `fetch()` of the site's own `public/` origin
 * (what this used to do, same pattern as bom-csv.ts): confirmed live
 * (2026-09-15) that self-fetch silently returns something that isn't the
 * CSV in production — most likely Vercel's deployment-protection
 * challenge page, HTTP 200 with HTML, not an error the fetch code could
 * catch — and the parser below has no way to tell that apart from a
 * genuinely empty file. Every month came back "missing consenso" with no
 * error anywhere. A build-time import removes the self-fetch entirely, so
 * there's nothing left to be protected, redirected, or time out.
 *
 * To add next year's file: drop "Proyeccion ventas {año}.csv" into
 * `src/data/` and set PROYECCION_VENTAS_YEAR — no other code change.
 */
const PROYECCION_YEAR = Number(import.meta.env.PROYECCION_VENTAS_YEAR) || 2026;
const TARGET_SECTION = 'PRODUCCION CONSENSUADO';
const SILLONES_ROW_LABEL = 'CONSENSUADO SILLONES EQUIVALENTE';
const COLCHONES_ROW_LABEL = 'CONSENSUADO COLCHONES UNIDAD';
const MONTH_COLUMN_INDEX_START = 3; // column 3 = ENERO, ... column 14 = DICIEMBRE

// Eager + raw: every "Proyeccion ventas *.csv" under src/data/ is bundled
// as a plain string at build time, keyed by its file path.
const PROYECCION_FILES = import.meta.glob('../data/Proyeccion ventas *.csv', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function getProyeccionCsvText(): string {
  const path = Object.keys(PROYECCION_FILES).find((p) => p.endsWith(`Proyeccion ventas ${PROYECCION_YEAR}.csv`));
  if (!path) {
    const available = Object.keys(PROYECCION_FILES).join(', ') || '(ninguno)';
    throw new Error(
      `No se encontró "Proyeccion ventas ${PROYECCION_YEAR}.csv" en src/data/ (PROYECCION_VENTAS_YEAR=${PROYECCION_YEAR}). Archivos disponibles: ${available}`
    );
  }
  return PROYECCION_FILES[path]!;
}

function parseNumberEsAr(raw: string): number | null {
  const cleaned = raw.trim().replace(/\$/g, '').replace(/\s/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

let cachedConsenso: { colchones: Map<string, number>; living: Map<string, number> } | undefined;

/** Returns `${YYYY-MM}` -> unidades, keyed `colchones`/`living`, only for months the CSV actually has a value for. */
function parseProduccionConsenso(): { colchones: Map<string, number>; living: Map<string, number> } {
  const colchones = new Map<string, number>();
  const living = new Map<string, number>();

  let currentSection = '';
  for (const line of getProyeccionCsvText().split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.split(';');
    const label = (fields[1] ?? '').trim();
    if (!label) continue;
    const monthCells = fields.slice(MONTH_COLUMN_INDEX_START, MONTH_COLUMN_INDEX_START + 12);
    const hasAnyMonthValue = monthCells.some((c) => (c ?? '').trim() !== '');

    if (!hasAnyMonthValue) {
      // A label row with no data in the month columns is a section header.
      currentSection = label.toUpperCase();
      continue;
    }

    if (currentSection !== TARGET_SECTION) continue;
    const labelUpper = label.toUpperCase();
    const target = labelUpper === SILLONES_ROW_LABEL ? living : labelUpper === COLCHONES_ROW_LABEL ? colchones : null;
    if (!target) continue;

    monthCells.forEach((cell, i) => {
      const value = parseNumberEsAr(cell ?? '');
      if (value === null) return;
      const month = `${PROYECCION_YEAR}-${String(i + 1).padStart(2, '0')}`;
      target.set(month, value);
    });
  }

  return { colchones, living };
}

/** Synchronous in practice (the CSV is bundled at build time) — kept async so callers don't need to change when this stops being a network fetch. */
export async function getProduccionConsenso(): Promise<{ colchones: Map<string, number>; living: Map<string, number> }> {
  if (!cachedConsenso) cachedConsenso = parseProduccionConsenso();
  return cachedConsenso;
}

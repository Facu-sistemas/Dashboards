import { withTtlCache } from './cache';

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
 * This is a year-specific file (named "Proyeccion ventas 2026.csv") —
 * PROYECCION_YEAR must be updated (and the file replaced in public/)
 * whenever a new year's version is dropped in.
 */
const CSV_PUBLIC_PATH = '/Proyeccion ventas 2026.csv';
const PROYECCION_YEAR = 2026;
const CSV_TTL_MS = 10 * 60 * 1000;
const TARGET_SECTION = 'PRODUCCION CONSENSUADO';
const SILLONES_ROW_LABEL = 'CONSENSUADO SILLONES EQUIVALENTE';
const COLCHONES_ROW_LABEL = 'CONSENSUADO COLCHONES UNIDAD';
const MONTH_COLUMN_INDEX_START = 3; // column 3 = ENERO, ... column 14 = DICIEMBRE

function getSiteOrigin(): string {
  const vercelUrl = import.meta.env.VERCEL_URL as string | undefined;
  if (vercelUrl) return `https://${vercelUrl}`;
  return 'http://localhost:4321';
}

function parseNumberEsAr(raw: string): number | null {
  const cleaned = raw.trim().replace(/\$/g, '').replace(/\s/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Returns `${YYYY-MM}` -> unidades, keyed `colchones`/`living`, only for months the CSV actually has a value for. */
async function fetchProduccionConsenso(): Promise<{ colchones: Map<string, number>; living: Map<string, number> }> {
  const colchones = new Map<string, number>();
  const living = new Map<string, number>();

  const url = `${getSiteOrigin()}${encodeURI(CSV_PUBLIC_PATH)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`No se pudo leer la Proyección de Ventas (${url})`, { cause: err });
  }
  if (!res.ok) throw new Error(`No se pudo leer la Proyección de Ventas (${url}): HTTP ${res.status}`);
  const text = await res.text();

  let currentSection = '';
  for (const line of text.split(/\r?\n/)) {
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

export async function getProduccionConsenso(): Promise<{ colchones: Map<string, number>; living: Map<string, number> }> {
  return withTtlCache('consenso-csv:produccion', CSV_TTL_MS, fetchProduccionConsenso);
}

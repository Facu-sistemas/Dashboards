import { withTtlCache } from './cache';

/**
 * The real "Presupuestado" BOM source — NOT Odoo's live `mrp.bom` (see
 * bom-explosion.ts's git history: a recursive live explosion produced
 * chemically implausible numbers, e.g. ~2,500kg of TDI per mattress,
 * because intermediate chemical-batch sub-assemblies like "POLIESTER
 * CILINDRO CELESTE 16V" have already-priced standalone costs and aren't
 * meant to be exploded further into their own internal recipe — but
 * Odoo's raw BOM data doesn't distinguish that on its own).
 *
 * This CSV ("BOM Crudo (fuente Sistemas)", confirmed live 2026-09 against
 * Marlynet's validated reference numbers — e.g. VORANOL 3011 (POLIOL) =
 * 4,209.8242g for model "ONIX, SOFA-1CPO(-76)" matches her worked example
 * exactly) is a pre-flattened Modelo→Insumo→Cantidad export someone
 * already resolved down to real base materials. It lives in `public/`
 * (served as a static asset) rather than being read from disk, because a
 * server-side filesystem read isn't guaranteed to see `public/` files on
 * Vercel's serverless runtime — fetching it over HTTP from the site's own
 * origin is the one access path guaranteed to work in both dev and prod.
 */
const CSV_PUBLIC_PATH = '/BOM_crudo.csv';
const CSV_TTL_MS = 10 * 60 * 1000;

function getSiteOrigin(): string {
  const vercelUrl = import.meta.env.VERCEL_URL as string | undefined;
  if (vercelUrl) return `https://${vercelUrl}`;
  return 'http://localhost:4321';
}

export interface BomCsvRow {
  modeloBase: string;
  modeloBaseKey: string;
  insumoNombre: string;
  insumoKey: string;
  /** Quantity per 1 finished unit, standardized (grams converted to kg; every other UdM — kg, m², ft², Unidad de Mil, Units, Par — kept as recorded, since Odoo's own cost for that product is priced against that same unit). */
  qty: number;
  udm: string;
}

/**
 * Normalizes a model or insumo name for matching against Odoo's live
 * `product.template`/`product.product` names, which use different
 * punctuation/spacing conventions than this CSV (e.g. CSV "ONIX,
 * SOFA-1CPO(-76)" vs Odoo "ONIX SOFA 1 CPO (-76)"). Confirmed live this
 * closes ~72% of models exactly — the rest differ by abbreviation
 * (e.g. "S1C" for "SOFA 1 CPO") that isn't safe to guess automatically;
 * those surface as unmatched rather than risk a wrong match.
 */
export function normalizeName(s: string): string {
  return s
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // strip accents (Unicode combining marks)
    .replace(/\(?\bCOPIA\)?\b/g, '') // Odoo duplicate-record artifact ("... (copia)") — never a real naming difference
    .replace(/(\d)([A-Z])/g, '$1 $2') // "1CPO" -> "1 CPO"
    .replace(/([A-Z])(\d)/g, '$1 $2') // "CPO76" -> "CPO 76"
    .replace(/[^A-Z0-9]+/g, ' ') // punctuation -> space
    .replace(/\bCPOS\b/g, 'CPO') // plural -> singular
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Known BOM-CSV insumo name ↔ Odoo cost-list name mismatches — same class
 * of problem regla 4.1 describes ("VORANOL 3011 (POLIOL)" in the BOM vs.
 * "VORANOL (POLIOL)" in costs, same insumo, different text), confirmed
 * against Marlynet's own worked example. Exact-normalized matching can't
 * close these safely on its own (the numeric grade code isn't just
 * punctuation to strip — dropping ALL digits would risk merging genuinely
 * different insumos). Add more entries here as Compras confirms them,
 * rather than guessing a fuzzy match that could silently merge two real,
 * different insumos.
 */
const INSUMO_NAME_ALIASES: Record<string, string> = {
  'VORANOL 3011 (POLIOL)': 'VORANOL (POLIOL)',
};

function resolveInsumoAlias(insumoName: string): string {
  return INSUMO_NAME_ALIASES[insumoName.toUpperCase()] ?? insumoName;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ';' && !inQuotes) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

async function fetchCsvRows(): Promise<BomCsvRow[]> {
  const url = `${getSiteOrigin()}${CSV_PUBLIC_PATH}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`No se pudo leer la Lista de Materiales (${url})`, { cause: err });
  }
  if (!res.ok) throw new Error(`No se pudo leer la Lista de Materiales (${url}): HTTP ${res.status}`);
  const text = await res.text();

  const rows: BomCsvRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = splitCsvLine(line);
    if (fields.length < 4) continue;
    const [modeloRaw, insumoRaw, cantidadRaw, udmRaw] = fields as [string, string, string, string];
    const cantidad = Number(cantidadRaw.trim().replace(/\./g, '').replace(',', '.'));
    const modelo = modeloRaw.trim();
    const insumo = insumoRaw.trim();
    // Skips the title/description/header rows at the top (their "cantidad" column isn't numeric) without needing to hardcode a line count.
    if (!modelo || !insumo || !Number.isFinite(cantidad)) continue;

    const udm = udmRaw.trim();
    const qty = udm.toLowerCase() === 'g' ? cantidad / 1000 : cantidad;
    rows.push({
      modeloBase: modelo,
      modeloBaseKey: normalizeName(modelo),
      insumoNombre: insumo,
      insumoKey: normalizeName(resolveInsumoAlias(insumo)),
      qty,
      udm,
    });
  }
  return rows;
}

export async function getBomCsvRows(): Promise<BomCsvRow[]> {
  return withTtlCache('bom-csv:rows', CSV_TTL_MS, fetchCsvRows);
}

/** Every CSV row, grouped by normalized "modelo base" — the BOM lookup this whole feature is built on. */
export async function getBomByModeloBaseKey(): Promise<Map<string, BomCsvRow[]>> {
  const rows = await getBomCsvRows();
  const map = new Map<string, BomCsvRow[]>();
  for (const r of rows) {
    if (!map.has(r.modeloBaseKey)) map.set(r.modeloBaseKey, []);
    map.get(r.modeloBaseKey)!.push(r);
  }
  return map;
}

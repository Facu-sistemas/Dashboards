import { withTtlCache } from './cache';

/**
 * Read-only source for the daily production "objetivo" (target) — the one
 * number Odoo genuinely doesn't have (it's built from "Tiempo disponible"
 * × "Personal", tracked by hand). Confirmed live with Nacho Rojas (FL)
 * that this public Google Sheet is the actual source of truth their own
 * dashboard reads from, published read-only (no auth needed), so this
 * fetches its CSV export directly. Everything else in Plan de Producción
 * (Planificado/Cumplimiento/Cerrado, both categories) is computed live
 * from Odoo — see plan-produccion.ts.
 */

const SHEET_ID = '1JqMW1K_i9iFiGJ7vswWPu3PbS1aha15ce-5rJZ8zQRM';
const GID_COLCHONES = '1615032894'; // "RESUMEN COLCHONES"
const GID_LIVING = '155254468'; // "RESUMEN LIVING"
const OBJETIVO_TTL_MS = 30 * 60 * 1000;

/** Cumulative "OBJETIVO" running total per calendar day, as published (resets at the start of each month block in the sheet). */
export type ObjetivoAcumuladoPorDia = Map<string, number>;

async function fetchCsv(gid: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo leer la planilla de objetivo (gid ${gid}): HTTP ${res.status}`);
  }
  return res.text();
}

/** Minimal RFC4180 parser — handles quoted fields with embedded commas/newlines, which the sheet uses for its comma-decimal numbers (e.g. `"87,7%"`). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Argentine locale: `.` thousands, `,` decimal — e.g. `"1.234,5"` → 1234.5. */
function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/%$/, '').replace(/\./g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** `DD/MM/YYYY` → `YYYY-MM-DD`. */
function parseFecha(raw: string | undefined): string | null {
  const match = raw ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim()) : null;
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/**
 * The sheet lays months out side by side, each with its own `OBJETIVO,
 * Fecha, ...` column pair (Colchones), or a single pair spanning every
 * month top to bottom (Living) — either way, every `OBJETIVO` header cell
 * is immediately followed by a `Fecha` column, so finding all of them and
 * reading straight down works for both layouts without hardcoding rows.
 * A blank OBJETIVO cell is skipped (not treated as 0) so it can't shadow
 * the last real value when looking up a period's end-of-range total.
 */
function extractObjetivos(rows: string[][]): ObjetivoAcumuladoPorDia {
  const headerRowIndex = rows.findIndex((r) => r.some((c) => c.trim() === 'OBJETIVO'));
  const map: ObjetivoAcumuladoPorDia = new Map();
  if (headerRowIndex === -1) return map;

  const header = rows[headerRowIndex]!;
  const objetivoCols: number[] = [];
  header.forEach((cell, i) => {
    if (cell.trim() === 'OBJETIVO') objetivoCols.push(i);
  });

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r]!;
    for (const col of objetivoCols) {
      const date = parseFecha(row[col + 1]);
      const objetivo = parseNumber(row[col]);
      if (date !== null && objetivo !== null) map.set(date, objetivo);
    }
  }
  return map;
}

export interface ObjetivoSheetData {
  colchones: ObjetivoAcumuladoPorDia;
  living: ObjetivoAcumuladoPorDia;
}

export async function getPlanProduccionSheetData(): Promise<ObjetivoSheetData> {
  return withTtlCache('plan-produccion:objetivo-sheet', OBJETIVO_TTL_MS, async () => {
    const [colchonesCsv, livingCsv] = await Promise.all([fetchCsv(GID_COLCHONES), fetchCsv(GID_LIVING)]);
    return {
      colchones: extractObjetivos(parseCsv(colchonesCsv)),
      living: extractObjetivos(parseCsv(livingCsv)),
    };
  });
}

/** Objetivo for a whole period = the running total as of the last day inside it (each month's counter starts fresh, no cross-month carryover). */
export function objetivoForPeriod(map: ObjetivoAcumuladoPorDia, start: string, endExclusive: string): number {
  let latestDate: string | null = null;
  let latestValue = 0;
  for (const [date, value] of map) {
    if (date >= start && date < endExclusive && (latestDate === null || date > latestDate)) {
      latestDate = date;
      latestValue = value;
    }
  }
  return latestValue;
}

/** Per-day target = that day's cumulative total minus the previous day's (within the same month) — day 1 of a month is its own full value. */
export function objetivoPerDay(map: ObjetivoAcumuladoPorDia, start: string, endExclusive: string): Map<string, number> {
  const dates = [...map.keys()].filter((d) => d >= start && d < endExclusive).sort();
  const perDay = new Map<string, number>();
  let prevDate: string | null = null;
  let prevValue = 0;
  for (const date of dates) {
    const value = map.get(date)!;
    const sameMonth = prevDate !== null && prevDate.slice(0, 7) === date.slice(0, 7);
    perDay.set(date, sameMonth ? value - prevValue : value);
    prevDate = date;
    prevValue = value;
  }
  return perDay;
}

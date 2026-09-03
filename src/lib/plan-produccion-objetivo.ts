import { withTtlCache } from './cache';

/**
 * Read-only source for whatever Odoo can't answer for Plan de Producción —
 * confirmed live with Nacho Rojas (FL) that this public Google Sheet is
 * the actual source of truth their own dashboard reads from, published
 * read-only (no auth needed), so this fetches its CSV export directly.
 *
 * - `OBJETIVO` (both categories): Odoo has no "Tiempo disponible" ×
 *   "Personal" data at all, so this is the only source.
 * - Living's Planificado/Cumplimiento/Cerrado ALSO come from here —
 *   confirmed live that `x_studio_ue_x_cant_1` (the UE multiplier) is
 *   unset (0) on 64% of Living's product variants (SIRIUS, DONATO,
 *   MISSANA, ONIX, ...) planned in a real month, undercounting Odoo's own
 *   live numbers by roughly half. Until that Studio field gets filled in,
 *   Living rides on the sheet entirely.
 * - Colchones' Planificado/Cumplimiento/Cerrado do NOT come from here —
 *   Odoo's own data is complete there (see plan-produccion.ts), so those
 *   stay computed live against Odoo, only `OBJETIVO` is read from the
 *   sheet for Colchones.
 */

const SHEET_ID = '1JqMW1K_i9iFiGJ7vswWPu3PbS1aha15ce-5rJZ8zQRM';
const GID_COLCHONES = '1615032894'; // "RESUMEN COLCHONES"
const GID_LIVING = '155254468'; // "RESUMEN LIVING"
const SHEET_TTL_MS = 30 * 60 * 1000;

export interface SheetDailyRow {
  /** Cumulative running total as published (resets at the start of each month block in the sheet) — `null` when that day's OBJETIVO cell is blank, which must NOT be treated as 0 (it just means "no update that day", not "target is zero"). */
  objetivoAcumulado: number | null;
  planificado: number;
  cumplimiento: number;
  cerrado: number;
}

export type SheetDailyData = Map<string, SheetDailyRow>;

async function fetchCsv(gid: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo leer la planilla de referencia (gid ${gid}): HTTP ${res.status}`);
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
 * Fecha, PLANIFICADO, CUMPLIMIENTO, CERRADO, % Cumpl.` column group
 * (Colchones), or a single such group spanning every month top to bottom
 * (Living) — either way, every `OBJETIVO` header cell is followed by that
 * exact fixed column order, so finding all `OBJETIVO` cells and reading
 * the 4 columns after each one works for both layouts without hardcoding
 * rows.
 */
function extractDailyRows(rows: string[][]): SheetDailyData {
  const headerRowIndex = rows.findIndex((r) => r.some((c) => c.trim() === 'OBJETIVO'));
  const map: SheetDailyData = new Map();
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
      if (date === null) continue;
      map.set(date, {
        objetivoAcumulado: parseNumber(row[col]),
        planificado: parseNumber(row[col + 2]) ?? 0,
        cumplimiento: parseNumber(row[col + 3]) ?? 0,
        cerrado: parseNumber(row[col + 4]) ?? 0,
      });
    }
  }
  return map;
}

export interface PlanProduccionSheetData {
  colchones: SheetDailyData;
  living: SheetDailyData;
}

export async function getPlanProduccionSheetData(): Promise<PlanProduccionSheetData> {
  return withTtlCache('plan-produccion:sheet', SHEET_TTL_MS, async () => {
    const [colchonesCsv, livingCsv] = await Promise.all([fetchCsv(GID_COLCHONES), fetchCsv(GID_LIVING)]);
    return {
      colchones: extractDailyRows(parseCsv(colchonesCsv)),
      living: extractDailyRows(parseCsv(livingCsv)),
    };
  });
}

/** Objetivo for a whole period = the running total as of the last day inside it (each month's counter starts fresh, no cross-month carryover). */
export function objetivoForPeriod(map: SheetDailyData, start: string, endExclusive: string): number {
  let latestDate: string | null = null;
  let latestValue = 0;
  for (const [date, row] of map) {
    if (row.objetivoAcumulado === null) continue;
    if (date >= start && date < endExclusive && (latestDate === null || date > latestDate)) {
      latestDate = date;
      latestValue = row.objetivoAcumulado;
    }
  }
  return latestValue;
}

/** Per-day target = that day's cumulative total minus the previous day's (within the same month) — day 1 of a month is its own full value. Days with a blank OBJETIVO cell are skipped entirely, not treated as 0. */
export function objetivoPerDay(map: SheetDailyData, start: string, endExclusive: string): Map<string, number> {
  const dates = [...map.entries()]
    .filter(([date, row]) => date >= start && date < endExclusive && row.objetivoAcumulado !== null)
    .map(([date]) => date)
    .sort();
  const perDay = new Map<string, number>();
  let prevDate: string | null = null;
  let prevValue = 0;
  for (const date of dates) {
    const value = map.get(date)!.objetivoAcumulado!;
    const sameMonth = prevDate !== null && prevDate.slice(0, 7) === date.slice(0, 7);
    perDay.set(date, sameMonth ? value - prevValue : value);
    prevDate = date;
    prevValue = value;
  }
  return perDay;
}

/** Sums Planificado/Cumplimiento/Cerrado across every day the sheet has in range — these are already daily figures (not cumulative), unlike `objetivoAcumulado`. */
export function sheetTotalsForPeriod(map: SheetDailyData, start: string, endExclusive: string): { planificado: number; cumplimiento: number; cerrado: number } {
  let planificado = 0;
  let cumplimiento = 0;
  let cerrado = 0;
  for (const [date, row] of map) {
    if (date >= start && date < endExclusive) {
      planificado += row.planificado;
      cumplimiento += row.cumplimiento;
      cerrado += row.cerrado;
    }
  }
  return { planificado, cumplimiento, cerrado };
}

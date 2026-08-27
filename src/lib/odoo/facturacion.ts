import { searchRead, searchReadAll } from './client';
import { parseOdooDomainLiteral } from './domain-parser';
import { monthBounds, lastMonthKeys } from '../date';
import { OdooError } from './types';
import type { OdooDomain, OdooDomainLeaf } from './types';

/**
 * Names exactly as saved in Odoo (Ajustes > Técnico > Filtros de usuario,
 * modelo account.move.line) — confirmed live on 2026-08-27. Note the casing
 * differs from the working title used while scoping this feature ("Bancos"
 * plural, lowercase "completo").
 */
const BANCO_FILTER_NAME = 'Objetivo finanzas Bancos completo';
const EFECTIVO_FILTER_NAME = 'Objetivo finanzas efectivo completo';
const MOVE_LINE_MODEL = 'account.move.line';

export type FacturacionSource = 'banco' | 'efectivo';

export interface FacturacionLine {
  id: number;
  date: string;
  partnerId: number | null;
  partnerName: string | null;
  /** The saved Odoo filters both use `credit` as "the amount" — confirmed against their live domain (`credit >= 1`, sorted `credit desc`). */
  amount: number;
  matchingNumber: string | null;
  moveId: number;
  moveName: string;
}

export interface FacturacionSourceResult {
  source: FacturacionSource;
  filterName: string;
  total: number;
  lines: FacturacionLine[];
}

export interface FacturacionComparison {
  month: string;
  banco: FacturacionSourceResult;
  efectivo: FacturacionSourceResult;
}

/** One month of the Banco vs. Efectivo trend, plus their ratio (null when Efectivo is 0 — division would be meaningless). */
export interface FacturacionTrendPoint {
  month: string; // YYYY-MM
  banco: number;
  efectivo: number;
  ratio: number | null;
}

async function getFilterDomain(filterName: string): Promise<OdooDomain> {
  type Row = { id: number; domain: string };
  const rows = await searchRead<Row>({
    model: 'ir.filters',
    domain: [
      ['name', '=', filterName],
      ['model_id', '=', MOVE_LINE_MODEL],
    ],
    fields: ['domain'],
    limit: 1,
  });
  const row = rows[0];
  if (!row) {
    throw new OdooError(`Odoo filter "${filterName}" not found (ir.filters, model ${MOVE_LINE_MODEL})`);
  }
  return parseOdooDomainLiteral(row.domain);
}

/**
 * Strips the saved filter's own `date` bounds and replaces them with an
 * explicit range. The filters as configured in Odoo hardcode a fixed month
 * (Finance edits them by hand); honoring that literally would freeze this
 * dashboard on whatever month someone last set in Odoo instead of
 * following the month picker. Everything else in the filter (accounts,
 * exclusions, parent_state) is kept exactly as Finance configured it.
 *
 * Assumes the saved domain is a pure conjunction ("&" only), which is true
 * for both filters as inspected live — throws instead of silently
 * mis-combining if that ever stops being the case (e.g. someone adds an
 * "|" branch in Odoo).
 */
function withDateRange(domain: OdooDomain, start: string, endExclusive: string): OdooDomain {
  const leaves: OdooDomainLeaf[] = [];
  for (const item of domain) {
    if (Array.isArray(item)) {
      if (item[0] === 'date') continue; // drop the filter's own fixed dates
      leaves.push(item);
    } else if (item !== '&') {
      throw new OdooError(
        `Saved Odoo filter has a "${item}" connector — expected a pure AND. Refusing to guess how to recombine it.`
      );
    }
  }
  leaves.push(['date', '>=', start]);
  leaves.push(['date', '<', endExclusive]);
  return leaves;
}

async function fetchLines(filterName: string, start: string, endExclusive: string): Promise<FacturacionLine[]> {
  const baseDomain = await getFilterDomain(filterName);
  const domain = withDateRange(baseDomain, start, endExclusive);

  type Row = {
    id: number;
    date: string;
    partner_id: [number, string] | false;
    credit: number;
    matching_number: string | false;
    move_id: [number, string];
  };

  const rows = await searchReadAll<Row>({
    model: MOVE_LINE_MODEL,
    domain,
    fields: ['date', 'partner_id', 'credit', 'matching_number', 'move_id'],
    order: 'date asc',
  });

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    partnerId: r.partner_id ? r.partner_id[0] : null,
    partnerName: r.partner_id ? r.partner_id[1] : null,
    amount: r.credit,
    matchingNumber: r.matching_number || null,
    moveId: r.move_id[0],
    moveName: r.move_id[1],
  }));
}

async function fetchSourceLines(filterName: string, monthKey: string): Promise<{ lines: FacturacionLine[]; total: number }> {
  const { start, endExclusive } = monthBounds(monthKey);
  const lines = await fetchLines(filterName, start, endExclusive);
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return { lines, total };
}

/**
 * Facturación 1 (Banco) vs. Facturación 2 (Efectivo) for one month —
 * read-only, live from Odoo. When `monthKey` is the current month, the
 * upper bound is still "first day of next month" but Odoo simply has no
 * rows past today yet, so this naturally returns everything booked
 * through today without needing special-casing for an unfinished month.
 */
export async function getFacturacionComparison(monthKey: string): Promise<FacturacionComparison> {
  const [banco, efectivo] = await Promise.all([
    fetchSourceLines(BANCO_FILTER_NAME, monthKey),
    fetchSourceLines(EFECTIVO_FILTER_NAME, monthKey),
  ]);

  return {
    month: monthKey,
    banco: { source: 'banco', filterName: BANCO_FILTER_NAME, total: banco.total, lines: banco.lines },
    efectivo: { source: 'efectivo', filterName: EFECTIVO_FILTER_NAME, total: efectivo.total, lines: efectivo.lines },
  };
}

function sumByMonth(lines: FacturacionLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const l of lines) {
    const month = l.date.slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + l.amount);
  }
  return totals;
}

/**
 * Monthly Banco/Efectivo totals for the last `monthsBack` months (oldest
 * first), ending at the current month — one range query per source instead
 * of one per month, so a 12-month chart doesn't cost 24 Odoo round trips.
 */
export async function getFacturacionTrend(monthsBack: number): Promise<FacturacionTrendPoint[]> {
  const months = lastMonthKeys(monthsBack);
  const rangeStart = monthBounds(months[0]!).start;
  const rangeEndExclusive = monthBounds(months[months.length - 1]!).endExclusive;

  const [bancoLines, efectivoLines] = await Promise.all([
    fetchLines(BANCO_FILTER_NAME, rangeStart, rangeEndExclusive),
    fetchLines(EFECTIVO_FILTER_NAME, rangeStart, rangeEndExclusive),
  ]);

  const bancoByMonth = sumByMonth(bancoLines);
  const efectivoByMonth = sumByMonth(efectivoLines);

  return months.map((month) => {
    const banco = bancoByMonth.get(month) ?? 0;
    const efectivo = efectivoByMonth.get(month) ?? 0;
    return { month, banco, efectivo, ratio: efectivo > 0 ? banco / efectivo : null };
  });
}

import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { OdooError } from './types';

/**
 * Historical ARS-per-USD rate as of a set of specific dates — distinct
 * from currency.ts's getUsdToArsRate(), which only reads the LATEST rate
 * and is explicitly informational-only there. Here the conversion is
 * actually applied (INSTRUCCIONES_Dashboard_Presupuesto_Dinamico.md
 * section 4: real USD purchase-order lines must convert to ARS using the
 * TC of the day the order was placed, never a fixed rate).
 *
 * Confirmed live (2026-09): `res.currency.rate` has one row per calendar
 * day, so fetching every rate up to the latest requested date and
 * resolving each requested date to the most recent rate on/before it (in
 * memory) is cheap and avoids one round trip per distinct order date.
 */
export async function getHistoricalUsdArsRates(dates: string[]): Promise<Map<string, number>> {
  if (dates.length === 0) return new Map();
  const { companyId } = await getFronteraCompany();

  const usdRows = await searchReadAll<{ id: number }>({ model: 'res.currency', domain: [['name', '=', 'USD']], fields: [] });
  const usd = usdRows[0];
  if (!usd) throw new OdooError('Currency "USD" not found in Odoo');

  const maxDate = dates.reduce((a, b) => (b > a ? b : a));
  const rates = await searchReadAll<{ name: string; inverse_company_rate: number }>({
    model: 'res.currency.rate',
    domain: [
      ['currency_id', '=', usd.id],
      ['company_id', '=', companyId],
      ['name', '<=', maxDate],
    ],
    fields: ['name', 'inverse_company_rate'],
    order: 'name asc',
  });

  const result = new Map<string, number>();
  for (const date of new Set(dates)) {
    let latest: number | undefined;
    for (const r of rates) {
      if (r.name > date) break;
      latest = r.inverse_company_rate;
    }
    if (latest !== undefined) result.set(date, latest);
  }
  return result;
}

import { searchRead } from './client';
import { getFronteraCompany } from './reference';
import { withTtlCache } from '../cache';
import { OdooError } from './types';

export interface FxRateInfo {
  currency: string;
  arsPerUnit: number;
  asOfDate: string; // ISO date the rate is dated
}

/**
 * Informational only — NOT used to convert amounts anywhere in this app.
 * Purchase spend/budget are shown in their own loading currency (ARS or
 * USD), never blended; this just tells the viewer what today's USD is
 * worth so they can eyeball a comparison themselves.
 *
 * `inverse_company_rate` is confirmed (against a real line: 3549 USD ×
 * 1511.5 ≈ 5,364,313 ARS, a plausible real-world rate) to be "ARS per 1
 * unit of foreign currency" — the direct multiplier, no inversion needed.
 */
export async function getUsdToArsRate(): Promise<FxRateInfo> {
  return withTtlCache('fx:usd-ars:latest', 5 * 60 * 1000, async () => {
    const { companyId } = await getFronteraCompany();

    type CurrencyRow = { id: number };
    const currencies = await searchRead<CurrencyRow>({
      model: 'res.currency',
      domain: [['name', '=', 'USD']],
      fields: [],
      limit: 1,
    });
    const usd = currencies[0];
    if (!usd) throw new OdooError('Currency "USD" not found in Odoo');

    type RateRow = { name: string; inverse_company_rate: number };
    const rates = await searchRead<RateRow>({
      model: 'res.currency.rate',
      domain: [
        ['currency_id', '=', usd.id],
        ['company_id', '=', companyId],
      ],
      fields: ['name', 'inverse_company_rate'],
      order: 'name desc',
      limit: 1,
    });
    const latest = rates[0];
    if (!latest) throw new OdooError('No USD exchange rate found for Frontera Living S.A');

    return { currency: 'USD', arsPerUnit: latest.inverse_company_rate, asOfDate: latest.name };
  });
}

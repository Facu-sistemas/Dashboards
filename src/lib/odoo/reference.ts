import { searchRead } from './client';
import { withTtlCache } from '../cache';
import { OdooError } from './types';

/**
 * Resolves IDs that are stable in practice (company, its currency, the
 * COMPRAS analytic account) by name instead of hardcoding them — per
 * project requirement, nothing here should assume a fixed numeric ID.
 * Cached for an hour: these don't change during a running process, and
 * re-resolving them on every request would waste a round trip.
 */

const REFERENCE_TTL_MS = 60 * 60 * 1000;

const FRONTERA_COMPANY_NAME = 'Frontera Living S.A';
const COMPRAS_PLAN_NAME = 'COMPRAS';
const COMPRAS_ACCOUNT_NAME = 'COMPRAS';

export interface CompanyReference {
  companyId: number;
  currencyId: number;
  currencyName: string;
}

export async function getFronteraCompany(): Promise<CompanyReference> {
  return withTtlCache('ref:company:frontera', REFERENCE_TTL_MS, async () => {
    type Row = { id: number; currency_id: [number, string] };
    const rows = await searchRead<Row>({
      model: 'res.company',
      domain: [['name', '=', FRONTERA_COMPANY_NAME]],
      fields: ['currency_id'],
      limit: 1,
    });
    const company = rows[0];
    if (!company) {
      throw new OdooError(`Company "${FRONTERA_COMPANY_NAME}" not found in Odoo`);
    }
    return {
      companyId: company.id,
      currencyId: company.currency_id[0],
      currencyName: company.currency_id[1],
    };
  });
}

/**
 * The analytic account purchase-category budgets are expected to live
 * under, once Accounting loads them: plan "COMPRAS", account "COMPRAS",
 * scoped to Frontera Living S.A (the same account name exists duplicated
 * under the "Presupuesto" company — must not be confused with it).
 */
export async function getComprasAnalyticAccountId(): Promise<number | null> {
  return withTtlCache('ref:analytic:compras', REFERENCE_TTL_MS, async () => {
    const { companyId } = await getFronteraCompany();
    type Row = { id: number };
    const rows = await searchRead<Row>({
      model: 'account.analytic.account',
      domain: [
        ['name', '=', COMPRAS_ACCOUNT_NAME],
        ['plan_id.name', '=', COMPRAS_PLAN_NAME],
        ['company_id', '=', companyId],
      ],
      fields: ['id'],
      limit: 1,
    });
    return rows[0]?.id ?? null;
  });
}

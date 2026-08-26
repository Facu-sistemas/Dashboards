export type OdooDomainOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'like'
  | 'ilike'
  | 'in'
  | 'not in'
  | 'child_of';

export type OdooDomainLeaf = [string, OdooDomainOperator, unknown];
export type OdooDomainConnector = '&' | '|' | '!';
export type OdooDomain = (OdooDomainLeaf | OdooDomainConnector)[];

export interface SearchReadParams {
  model: string;
  domain?: OdooDomain;
  fields?: string[];
  limit?: number;
  offset?: number;
  order?: string;
}

export interface ReadGroupParams {
  model: string;
  domain?: OdooDomain;
  fields: string[];
  groupBy: string[];
  limit?: number;
  orderby?: string;
  lazy?: boolean;
}

export interface OdooReadGroupResult {
  [key: string]: unknown;
  __count: number;
  __domain?: OdooDomain;
  // Present when grouping by a date/datetime field with a granularity
  // suffix (e.g. "date:day"). The bucket's own key comes back as a
  // locale-formatted label ("28 may. 2026"), unusable for sorting/parsing —
  // __range carries the actual ISO bucket boundaries to read the real date from.
  __range?: Record<string, { from: string | false; to: string | false }>;
}

export interface ProductCategoryOption {
  id: number;
  name: string;
}

/** 'ARS' for most categories, 'USD' for USD-loaded ones (chemicals) — never blended. */
export type PurchaseCurrency = 'ARS' | 'USD';

export type ComplianceStatus = 'green' | 'yellow' | 'red' | 'no-budget';

/** Real vs. budgeted purchase spend for one category, for one month, in its own currency. */
export interface CategoryBudgetStatus {
  categoryId: number;
  categoryName: string;
  currency: PurchaseCurrency;
  realAmount: number;
  budgetAmount: number | null;
  compliancePct: number | null;
  status: ComplianceStatus;
}

/** One month of aggregated compliance, kept separate per currency (see CategoryBudgetStatus). */
export interface MonthlyCompliancePoint {
  month: string; // YYYY-MM
  currency: PurchaseCurrency;
  totalReal: number;
  totalBudget: number | null;
  compliancePct: number | null;
}

export class OdooError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'OdooError';
  }
}

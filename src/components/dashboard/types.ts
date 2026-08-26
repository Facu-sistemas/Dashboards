export type PurchaseCurrency = 'ARS' | 'USD';
export type ComplianceStatus = 'green' | 'yellow' | 'red' | 'no-budget';

export interface CategoryBudgetStatus {
  categoryId: number;
  categoryName: string;
  currency: PurchaseCurrency;
  realAmount: number;
  budgetAmount: number | null;
  compliancePct: number | null;
  status: ComplianceStatus;
}

export interface MonthlyCompliancePoint {
  month: string; // YYYY-MM
  currency: PurchaseCurrency;
  totalReal: number;
  totalBudget: number | null;
  compliancePct: number | null;
}

export interface CategoryOption {
  id: number;
  name: string;
}

export interface FxRateInfo {
  currency: string;
  arsPerUnit: number;
  asOfDate: string;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface DashboardFilters {
  month: string; // YYYY-MM
  categoryId?: number;
}

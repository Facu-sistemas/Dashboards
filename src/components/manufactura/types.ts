export type TopProductsRange = 'all' | 'this-year' | 'last-12-months' | 'last-6-months';

export interface TopProductRow {
  productTemplateId: number;
  productName: string;
  subcategoryName: string;
  unitsSold: number;
}

export interface TopProductsResult {
  colchones: TopProductRow[];
  living: TopProductRow[];
}

export type OeePeriodKind = 'day' | 'week' | 'month';

export interface OeeCategoryGauge {
  planned: number;
  produced: number;
  pctComplete: number;
}

export interface OeeOrderSummary {
  id: number;
  reference: string;
  productName: string;
}

export interface OeeMonthlyRow {
  month: string;
  colchones: OeeCategoryGauge;
  living: OeeCategoryGauge;
  total: OeeCategoryGauge;
}

export interface OeeResult {
  period: { kind: OeePeriodKind; date: string; start: string; endInclusive: string };
  colchones: OeeCategoryGauge;
  living: OeeCategoryGauge;
  total: OeeCategoryGauge;
  closedOrders: OeeOrderSummary[];
  closedTotal: number;
  pendingOrders: OeeOrderSummary[];
  pendingTotal: number;
  monthly: OeeMonthlyRow[];
}

export interface RawMaterialCategoryOption {
  id: number;
  name: string;
}

export interface RawMaterialRow {
  productId: number;
  productName: string;
  currentStock: number;
  reorderPoint: number | null;
  projectedConsumption: number;
  avgDailyConsumption: number;
  daysUntilStockout: number | null;
  isLow: boolean;
}

export interface RawMaterialConsumptionResult {
  categories: RawMaterialCategoryOption[];
  rows: RawMaterialRow[];
  lowCount: number;
}

export type ConsumptionLookbackDays = 30 | 60 | 90 | 180;

export interface MaterialMonthlyPoint {
  month: string;
  consumption: number;
}

export interface MaterialHistory {
  productId: number;
  productName: string;
  currentStock: number;
  reorderPoint: number | null;
  points: MaterialMonthlyPoint[];
}

export type PlanProduccionPeriodKind = 'day' | 'week' | 'month' | 'year';

export interface PlanProduccionGauge {
  planificado: number;
  producido: number;
  cerrado: number;
  cumplimientoPct: number;
  cerradoPct: number;
}

export interface PlanProduccionResult {
  period: { kind: PlanProduccionPeriodKind; date: string; start: string; endExclusive: string };
  colchones: PlanProduccionGauge;
  living: PlanProduccionGauge;
}

export interface PlanProduccionDailyRow {
  date: string;
  colchones: PlanProduccionGauge;
  living: PlanProduccionGauge;
}

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

export type OeeGranularity = 'day' | 'week' | 'month';
export type OeeCategoryFilter = 'all' | 'colchones' | 'living';

export interface OeeOrderSummary {
  id: number;
  reference: string;
  productName: string;
}

export interface OeeResult {
  plannedQty: number;
  producedQty: number;
  pctComplete: number;
  closedOrders: OeeOrderSummary[];
  closedTotal: number;
  pendingOrders: OeeOrderSummary[];
  pendingTotal: number;
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

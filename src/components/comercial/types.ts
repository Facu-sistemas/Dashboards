export type PriceSource = 'lista' | 'venta' | 'arrastrado';

export interface ProductPricePoint {
  month: string; // YYYY-MM
  price: number;
  source: PriceSource;
}

export interface ProductPriceTrend {
  productId: number;
  productName: string;
  hasHistory: boolean;
  points: ProductPricePoint[];
}

export interface SellableProductOption {
  id: number;
  name: string;
  listPrice: number;
}

export interface SellableProductPage {
  items: SellableProductOption[];
  total: number;
}

export type ParetoRange = 'all' | 'this-year' | 'last-12-months' | 'last-6-months';

export interface ParetoClientRow {
  partnerId: number;
  partnerName: string;
  amount: number;
  unitsSold: number;
  cumulativePct: number;
}

export interface ParetoClientsResult {
  rows: ParetoClientRow[];
  grandTotal: number;
}

export interface ClientMonthlyPoint {
  month: string; // YYYY-MM
  amount: number;
}

export interface ClientMonthlySeries {
  partnerId: number;
  partnerName: string;
  points: ClientMonthlyPoint[];
}

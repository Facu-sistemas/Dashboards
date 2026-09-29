export type PriceSource = 'lista' | 'venta' | 'arrastrado';

export interface ProductPricePoint {
  month: string; // YYYY-MM
  price: number;
  source: PriceSource;
  min?: number;
  max?: number;
  count?: number;
}

export interface ProductQuotationDetail {
  orderId: number;
  orderName: string;
  date: string;
  month: string;
  price: number;
  qty: number;
}

export interface ProductPriceTrend {
  productId: number;
  productName: string;
  hasHistory: boolean;
  points: ProductPricePoint[];
  quotationDetails: ProductQuotationDetail[];
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


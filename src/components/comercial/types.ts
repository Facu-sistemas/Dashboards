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


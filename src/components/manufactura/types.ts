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

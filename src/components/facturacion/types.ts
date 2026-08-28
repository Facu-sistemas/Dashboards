export type FacturacionSource = 'banco' | 'efectivo';

export interface FacturacionLine {
  id: number;
  date: string;
  partnerId: number | null;
  partnerName: string | null;
  amount: number;
  matchingNumber: string | null;
  moveId: number;
  moveName: string;
}

export interface FacturacionSourceResult {
  source: FacturacionSource;
  filterName: string;
  total: number;
  lines: FacturacionLine[];
}

export interface FacturacionComparison {
  month: string;
  banco: FacturacionSourceResult;
  efectivo: FacturacionSourceResult;
}

export interface FacturacionTrendPoint {
  month: string; // YYYY-MM
  banco: number;
  efectivo: number;
  ratio: number | null;
}

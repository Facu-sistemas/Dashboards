// --- Presupuesto Dinámico (BOM) — mirrors src/lib/odoo/presupuesto-dinamico.ts ---

export type PresupuestoComplianceStatus = 'green' | 'yellow' | 'red' | 'no-data';

export interface InsumoMonthFigure {
  presupuestado: number | null;
  real: number;
  variancePct: number | null;
  compliancePct: number | null;
  status: PresupuestoComplianceStatus;
}

export interface InsumoRow {
  productId: number;
  productName: string;
  months: Record<string, InsumoMonthFigure>;
  annual: InsumoMonthFigure;
}

export interface CategoryGroup {
  categoryId: number;
  categoryName: string;
  insumos: InsumoRow[];
  months: Record<string, InsumoMonthFigure>;
  annual: InsumoMonthFigure;
}

export type GapReason = 'sin-costo' | 'componente-generico-sin-repartir' | 'no-es-materia-prima' | 'posible-bom-circular';

export interface GapInsumo {
  productId: number;
  productName: string;
  reason: GapReason;
}

export interface PresupuestoDinamicoResult {
  year: number;
  months: string[];
  categories: CategoryGroup[];
  gaps: GapInsumo[];
  missingConsensoMonths: string[];
  missingTcMonths: string[];
  monthlyComplianceSummary: { month: string; compliancePct: number | null }[];
}

export interface FueraDeAlcanceCategoryRow {
  categoryId: number;
  categoryName: string;
  months: Record<string, number>;
  annual: number;
}

export interface FueraDeAlcanceResult {
  year: number;
  months: string[];
  categories: FueraDeAlcanceCategoryRow[];
}

export type BusinessUnit = 'colchones' | 'living';

export interface ConsensoUnidadesRow {
  mes: string;
  unidadNegocio: BusinessUnit;
  unidades: number;
}

export interface TcAsumidoRow {
  mes: string;
  tc: number;
}

export interface PresupuestoDinamicoInputs {
  consenso: ConsensoUnidadesRow[];
  tc: TcAsumidoRow[];
}

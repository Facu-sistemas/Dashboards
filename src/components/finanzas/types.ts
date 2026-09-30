// --- Política vs Real — mirrors src/lib/odoo/politica-vs-real.ts ---

export interface PoliticaVsRealGroupRow {
  groupKey: string;
  groupName: string;
  capitalObjetivo: number;
  capitalReal: number;
  desviacionAbs: number;
  desviacionPct: number | null;
}

export interface PoliticaVsRealResult {
  porCategoria: PoliticaVsRealGroupRow[];
  porClaseAbc: PoliticaVsRealGroupRow[];
  total: PoliticaVsRealGroupRow;
}

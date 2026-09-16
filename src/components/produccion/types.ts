export interface ModeloCarpinteriaOption {
  name: string;
}

export interface ModeloCarpinteriaPage {
  items: ModeloCarpinteriaOption[];
  total: number;
}

export type ListonColor = 'NEGRO' | 'BLANCO';

export interface RecetaListonRow {
  medida: string;
  largoCm: number;
  piezasPorUnidad: number;
  color: ListonColor;
  noTraer: boolean;
}

export interface PedidoListonRow {
  medida: string;
  largoCm: number;
  piezas: number;
  color: ListonColor;
  noTraer: boolean;
}

export interface PedidoAgregado {
  modelo: string;
  cantidad: number;
}

// Re-exported here so components can import Multicorte types alongside the
// Carpintería ones already living in this file; the actual definitions live
// with the business logic in src/lib/multicorte-calc.ts.
export type { Bloque, Columna, Capa, PackedSlot, DesperdicioLateral, SobranteEntry } from '../../lib/multicorte-calc';

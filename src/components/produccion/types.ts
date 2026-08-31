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
}

export interface PedidoListonRow {
  medida: string;
  largoCm: number;
  piezas: number;
  color: ListonColor;
}

export interface PedidoAgregado {
  modelo: string;
  cantidad: number;
}

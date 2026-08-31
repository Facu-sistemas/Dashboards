export interface ModeloCarpinteriaOption {
  name: string;
}

export interface ModeloCarpinteriaPage {
  items: ModeloCarpinteriaOption[];
  total: number;
}

export interface RecetaListonRow {
  medida: string;
  largoCm: number;
  piezasPorUnidad: number;
}

export interface PedidoListonRow {
  medida: string;
  largoCm: number;
  piezas: number;
}

export interface PedidoAgregado {
  modelo: string;
  cantidad: number;
}

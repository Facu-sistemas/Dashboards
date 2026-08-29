export interface RackColumnData {
  column: number;
  levels: string[];
}

export interface RackData {
  rack: string;
  columns: RackColumnData[];
}

export interface WarehouseLayout {
  racks: RackData[];
  occupiedCodes: string[];
}

export type RackSide = 'izquierdo' | 'derecho';

export interface UbicacionProducto {
  producto: string;
  cantidad: number;
  unidad: string;
}

export interface UbicacionStockResult {
  codigo: string;
  productos: UbicacionProducto[];
}

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

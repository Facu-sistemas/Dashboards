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
}

export interface UbicacionStockResult {
  codigo: string;
  productos: UbicacionProducto[];
}

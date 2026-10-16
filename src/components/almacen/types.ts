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

export type HistorialRango = 'hoy' | '7d' | '30d' | '12m';
export type MovimientoTipo = 'entrada' | 'salida' | 'interno';

export interface HistorialMovimiento {
  id: number;
  producto: string;
  cantidad: number;
  unidad: string;
  origen: string;
  destino: string;
  tipo: MovimientoTipo;
  fecha: string;
}

export interface HistorialTop {
  nombre: string;
  movimientos: number;
}

export interface HistorialResult {
  rango: HistorialRango;
  totales: { total: number; entradas: number; salidas: number; internos: number; productos: number; ubicaciones: number };
  totalAnterior: number;
  serie: { label: string; entradas: number; salidas: number; internos: number }[];
  heatmap: number[][];
  porRack: HistorialTop[];
  topProductos: HistorialTop[];
  topUbicaciones: HistorialTop[];
  recientes: HistorialMovimiento[];
  truncado: boolean;
}

export interface MovimientoRow {
  id: number;
  producto: string;
  cantidad: number;
  unidad: string;
  origen: string;
  destino: string;
  fecha: string;
}

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
export type MovimientoTipo = 'entrada' | 'salida' | 'interno' | 'consumo';

export interface HistorialMovimiento {
  id: number;
  producto: string;
  cantidad: number;
  unidad: string;
  origen: string;
  destino: string;
  tipo: MovimientoTipo;
  fecha: string;
  /** Orden que originó el movimiento (WH/MO/…, WH/RO/…). Solo viene en los consumos. */
  referencia?: string;
}

export interface HistorialConsumos {
  /** Líneas consumidas de PRE-PRODUCCION en el período. */
  total: number;
  fabricacion: number;
  reparacion: number;
  otros: number;
  topProductos: HistorialTop[];
  /** Los más recientes (con tope), para mezclar en la línea de tiempo. */
  recientes: HistorialMovimiento[];
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
  consumos: HistorialConsumos;
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

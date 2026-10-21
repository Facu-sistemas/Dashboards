/**
 * Tipos compartidos del módulo Rentabilidad (Rentabilidad & Contribución). Sin
 * imports de servidor: los usan tanto los endpoints como las islas React.
 */

export type EstadoSemaforo = 'verde' | 'amarillo' | 'rojo' | 'sin_costo';

export interface UmbralesRentabilidad {
  /** Objetivo de contribución, en % de la venta. */
  objetivo: number;
  /** Contribución >= verde => verde. */
  verde: number;
  /** Contribución >= amarillo (y < verde) => amarillo; menos => rojo. */
  amarillo: number;
}

export interface RentabilidadConfig {
  /** false si las tablas rentabilidad_* no existen o no se pudieron leer: se usan los valores por defecto. */
  disponible: boolean;
  global: UmbralesRentabilidad;
  /** Objetivo/umbrales por categoría raíz (Sillon, Colchones, ...). Lo que no esté acá usa `global`. */
  categorias: Record<string, UmbralesRentabilidad>;
}

/**
 * Métricas de una fila (cliente / categoría / subcategoría / producto).
 * Venta y cantidad siempre salen de Odoo. Todo lo que depende de costos es
 * null cuando ninguna línea de la fila tiene costo (provider sin datos):
 * nunca se inventa un número.
 */
export interface Metricas {
  /** Monto s/flete (subtotal facturado sin el recargo regional). */
  venta: number;
  /** Subtotal facturado (price_subtotal neto de NC), con recargo. */
  subtotal: number;
  cantidad: number;
  /** Parte de `venta` que tiene costo conocido (base de la contribución). */
  ventaConCosto: number;
  /** ventaConCosto / venta, 0..1. */
  cobertura: number;
  costoMp: number | null;
  costoMod: number | null;
  costoFijos: number | null;
  costoTotal: number | null;
  contribucion: number | null;
  /** contribución / ventaConCosto * 100 */
  contribucionPct: number | null;
  objetivoPct: number;
  /** contribucionPct - objetivoPct */
  gapPct: number | null;
  /** max(objetivoPct% * ventaConCosto - contribución, 0) */
  margenPerdido: number | null;
  estado: EstadoSemaforo;
}

export interface FiltrosRentabilidad {
  anio: number;
  /** 1..12 inclusive; null = sin límite. */
  mesIni: number | null;
  mesFin: number | null;
  categoria: string | null;
  /** id de res.partner comercial. */
  clienteId: number | null;
  /** id de res.company; null = ambas compañías. */
  empresaId: number | null;
  /** Fuente de los costos: 'planilla' (coincide con el Excel) u 'odoo' (dinámico). */
  costos: ModoCostos;
}

export type ModoCostos = 'planilla' | 'odoo';

export interface OpcionesRentabilidad {
  anios: number[];
  categorias: string[];
  empresas: { id: number; nombre: string }[];
}

export interface ProveedorCostoInfo {
  id: string;
  descripcion: string;
  /** false = stub: no hay costos, la UI muestra "sin costo". */
  activo: boolean;
  modo: ModoCostos;
}

export interface ClienteFila extends Metricas {
  clienteId: number;
  cliente: string;
  /** Venta por mes (12 posiciones, enero..diciembre) dentro del año filtrado, ignorando mesIni/mesFin. */
  meses: number[];
}

export interface ProductoFila extends Metricas {
  templateId: number;
  producto: string;
  categoria: string;
  subcategoria: string;
}

export interface ClientesResultado {
  filtros: FiltrosRentabilidad;
  opciones: OpcionesRentabilidad;
  config: RentabilidadConfig;
  costos: ProveedorCostoInfo;
  totales: Metricas;
  filas: ClienteFila[];
  /** ISO de generación (servidor). */
  generado: string;
}

export interface ClienteDetalleResultado {
  clienteId: number;
  cliente: string;
  productos: ProductoFila[];
}

export interface SubcategoriaFila extends Metricas {
  subcategoria: string;
}

export interface CategoriaFila extends Metricas {
  categoria: string;
  subcategorias: SubcategoriaFila[];
}

export interface CategoriasResultado {
  filtros: FiltrosRentabilidad;
  opciones: OpcionesRentabilidad;
  /** Clientes con ventas en el año (para el filtro), orden alfabético. */
  clientes: { id: number; nombre: string }[];
  config: RentabilidadConfig;
  costos: ProveedorCostoInfo;
  totales: Metricas;
  filas: CategoriaFila[];
  generado: string;
}

export interface ProductosResultado {
  categoria: string;
  subcategoria: string | null;
  productos: ProductoFila[];
}

export interface EvolucionMes {
  mes: number;
  venta: number;
  cantidad: number;
  /** venta / cantidad, null si la cantidad es 0. */
  precioUnitario: number | null;
  costoUnitario: number | null;
  contribucionPct: number | null;
}

export interface EvolucionResultado {
  templateId: number;
  producto: string;
  categoria: string;
  subcategoria: string;
  meses: EvolucionMes[];
}

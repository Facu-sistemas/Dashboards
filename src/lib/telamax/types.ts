/**
 * Tipos del motor Telamax (flujo de telas: tendido → corte CNC → armado).
 * Port de `telamax_v01_ejecutable.py`. Los tiempos de las bases vienen en
 * SEGUNDOS enteros (así se guardan en el tablero "Telamax" de Odoo); el motor
 * trabaja en minutos.
 */

export type Procedencia = 'ATRASADOS' | 'DIA' | 'SIGUIENTE';
export type Proceso = 'T' | 'C' | 'A';
export type TipoMaterial = 'Tela' | 'Guata' | 'Lienzo' | 'Armado';

/** Una fila de planilla de pedidos tal como sale del .xlsx (clave = encabezado exacto). */
export type FilaPlanilla = Record<string, unknown>;

export interface CncRow {
  nombre: string;
  categoria: string;
  segTela: number;
  segGuata: number;
  segLienzo: number;
}

export interface ConsTelaRow {
  producto: string;
  forma: string;
  metros: number;
}

/** Fila de consumo de guata o lienzo (misma forma). */
export interface ConsInsumoRow {
  producto: string;
  nombre: string;
  metros: number;
  salidas: number;
}

export interface RestInsumoRow {
  nombre: string;
  maxCapas: number;
}

export interface ArmadoRow {
  nombre: string;
  /** Segundos de cada estación (est1..est9). */
  segEst: number[];
}

export interface BasesTelamax {
  /** nombre_tela (tal cual) → max_capas_tela. */
  famTelas: { nombre: string; maxCapas: number }[];
  consTela: ConsTelaRow[];
  consGuata: ConsInsumoRow[];
  restGuata: RestInsumoRow[];
  consLienzo: ConsInsumoRow[];
  restLienzo: RestInsumoRow[];
  cnc: CncRow[];
  armado: ArmadoRow[];
  /** operacion_tendido → segundos. */
  tendido: Record<string, number>;
}

export interface Planillas {
  atrasados: FilaPlanilla[];
  dia: FilaPlanilla[];
  siguiente: FilaPlanilla[];
}

/** Una línea de las hojas de ruta. `inicio`/`fin` son minutos desde las 06:00 del día 1 (jornadas de 488 min). */
export interface Registro {
  proceso: Proceso;
  inicio: number;
  fin: number;
  modelo: string;
  parte: string;
  insumo: string;
  sillones: number;
  capas: number | '-';
  metros: number | '-';
  tipoMaterial: TipoMaterial;
  m: number;
  procedencia: Procedencia;
}

export interface MesaOcupacion {
  L: number;
  iniT: number;
  iniC: number;
  finC: number;
}

export interface ResultadoTelamax {
  plan: Registro[];
  /** Log de planta (ocio, cierres de jornada, excedentes, adelantos). Mismos textos que el Python. */
  bitacora: string[];
  /** Productos de las planillas que no se pueden planificar (no están en la base o les falta receta). */
  alertasPlanillas: string[];
  tTendido: number;
  tCnc: number;
  tArmadores: number[];
  mesa: MesaOcupacion[];
}

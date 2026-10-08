// Datos de cada pantalla de Compras MP, ya agregados y livianos, a partir de lo guardado de una corrida.
// Son funciones puras: el navegador solo los muestra.
import type { CorridaGuardada } from './corrida';
import type { Control } from './controles';
import type { FilaDesembolso } from './lectura';
import type { FilaControlOc } from './control-oc';
import type { DecisionOc } from './decisiones-oc';
import type { CabeceraVersion } from './versiones';
import type { SeguimientoCompleto } from './seguimiento-datos';
import type { CategoriaSeguimiento, ResultadoSeguimiento } from './seguimiento';
import type { Cierre } from './cierres';
import {
  compraPorCategoria, inventarioPorCategoria, inventarioPorClase, kpisCompras, kpisInventario,
  type CompraPorCategoria, type FilaCompleta, type InventarioPorCategoria, type InventarioPorClase, type InventarioResumen, type KpisCompras, type KpisInventario,
} from './indicadores';

export interface CabeceraCorrida {
  id: string;
  fechaDatos: string;
  creadaEn: string;
  origen: string;
  disparadaPor: string | null;
  /** AAAA-MM del último mes cerrado y meses del horizonte. */
  corte: string;
  horizonte: string[];
  tipoCambio: number;
  skus: number;
}

function cabecera(c: CorridaGuardada): CabeceraCorrida {
  const r = c.resumen;
  return {
    id: c.id, fechaDatos: c.fechaDatos, creadaEn: c.creadaEn, origen: c.origen, disparadaPor: c.disparadaPor,
    corte: r?.corte ?? '', horizonte: r?.horizonte ?? [], tipoCambio: r?.tipoCambio ?? 0, skus: r?.skus ?? 0,
  };
}

// ----------------------------------------------------------------------------- Rendición de cuentas
export interface DesembolsoMes {
  mes: string;
  /** Real pagado (meses del año). */
  pagado: { neto: number; iva: number; percepciones: number; gastosImportacion: number; total: number } | null;
  /** Proyectado del horizonte, por origen del dato. */
  proyectado: { facturas: number; oc: number; compras: number; gastosImportacion: number; total: number; neto: number; iva: number; percepciones: number } | null;
}

export interface VistaRendicion {
  corrida: CabeceraCorrida;
  controles: Control[];
  compras: KpisCompras;
  /** Compra y órdenes a emitir por categoría y mes del horizonte. */
  compraPorCategoria: CompraPorCategoria[];
  compraPorOrigen: Record<string, number[]>;
  compraPorMes: number[];
  /** Compras de urgencia por mes ($): respaldo de China + (mes 1) faltante antes de poder recibir. */
  urgenciaPorMes: number[];
  /** Faltante bajo seguridad antes de poder recibir ($): se suma al denominador del % de urgencia. */
  faltantePorMes: number[];
  desembolsos: DesembolsoMes[];
  /** Pagado a la fecha en el mes en curso (de los pagos reales). */
  inventario: {
    kpis: KpisInventario;
    total: InventarioResumen;
    porCategoria: InventarioPorCategoria[];
    porClase: InventarioPorClase[];
    totalClase: InventarioPorClase;
  };
  /** Versión aprobada vigente y su cumplimiento (null mientras no se apruebe ninguna). */
  versionAprobada: {
    version: CabeceraVersion;
    /** Aprobado y real por categoría y mes del horizonte de la versión. */
    categorias: CategoriaSeguimiento[];
    meses: { mes: string; cerrado: boolean; aprobado: number; real: number }[];
    total: ResultadoSeguimiento['total'];
  } | null;
}

export function desembolsosPorMes(filas: FilaDesembolso[]): DesembolsoMes[] {
  const meses = [...new Set(filas.map((f) => f.mes))].sort((a, b) => (a === 'posterior' ? 1 : b === 'posterior' ? -1 : a.localeCompare(b)));
  return meses.map((mes) => {
    const g = (tipo: 'pagado' | 'proyectado', concepto: string) => filas.find((f) => f.mes === mes && f.tipo === tipo && f.concepto === concepto)?.valor ?? 0;
    const hayPagado = filas.some((f) => f.mes === mes && f.tipo === 'pagado');
    const hayProy = filas.some((f) => f.mes === mes && f.tipo === 'proyectado');
    const pagado = hayPagado
      ? (() => {
          const neto = g('pagado', 'neto'), iva = g('pagado', 'iva'), percepciones = g('pagado', 'percepciones'), gi = g('pagado', 'gastos_importacion');
          return { neto, iva, percepciones, gastosImportacion: gi, total: neto + iva + percepciones + gi };
        })()
      : null;
    const proyectado = hayProy
      ? (() => {
          const bloque = (b: string) => g('proyectado', `${b}_neto`) + g('proyectado', `${b}_iva`) + g('proyectado', `${b}_percepciones`);
          const facturas = bloque('facturas'), oc = bloque('oc'), compras = bloque('compras'), gi = g('proyectado', 'gastos_importacion');
          const neto = g('proyectado', 'facturas_neto') + g('proyectado', 'oc_neto') + g('proyectado', 'compras_neto');
          const iva = g('proyectado', 'facturas_iva') + g('proyectado', 'oc_iva') + g('proyectado', 'compras_iva');
          const percepciones = g('proyectado', 'facturas_percepciones') + g('proyectado', 'oc_percepciones') + g('proyectado', 'compras_percepciones');
          return { facturas, oc, compras, gastosImportacion: gi, total: facturas + oc + compras + gi, neto, iva, percepciones };
        })()
      : null;
    return { mes, pagado, proyectado };
  });
}

export function vistaRendicion(c: CorridaGuardada, filas: FilaCompleta[], desembolsos: FilaDesembolso[], seguimiento: SeguimientoCompleto | null = null): VistaRendicion {
  const porOrigen: Record<string, number[]> = {};
  for (const f of filas) {
    const a = (porOrigen[f.ori] ??= [0, 0, 0, 0]);
    a[0]! += f.rd1; a[1]! += f.rd2; a[2]! += f.rd3; a[3]! += f.rd4;
  }
  const cat = inventarioPorCategoria(filas);
  const cls = inventarioPorClase(filas);
  return {
    corrida: cabecera(c),
    controles: c.controles,
    compras: kpisCompras(filas),
    compraPorCategoria: compraPorCategoria(filas),
    compraPorOrigen: porOrigen,
    compraPorMes: [1, 2, 3, 4].map((j) => filas.reduce((s, f) => s + ((f as unknown as Record<string, number>)[`rd${j}`] ?? 0), 0)),
    urgenciaPorMes: [1, 2, 3, 4].map((j) => filas.reduce((s, f) => s + ((f as unknown as Record<string, number>)[`bk${j}`] ?? 0) * f.costo + (j === 1 ? f.o0 : 0), 0)),
    faltantePorMes: [1, 2, 3, 4].map((j) => (j === 1 ? filas.reduce((s, f) => s + f.o0, 0) : 0)),
    desembolsos: desembolsosPorMes(desembolsos),
    inventario: { kpis: kpisInventario(filas), total: cat.total, porCategoria: cat.categorias, porClase: cls.clases, totalClase: cls.total },
    versionAprobada: seguimiento
      ? { version: seguimiento.version, categorias: seguimiento.resultado.categorias, meses: seguimiento.resultado.meses, total: seguimiento.resultado.total }
      : null,
  };
}

// ----------------------------------------------------------------------------- Presupuesto
const COLS_PRESUPUESTO = [
  'clave', 'productId', 'sku', 'cat', 'lin', 'ori', 'resp', 'abc', 'met', 'drv', 'prov', 'costo', 'disp', 'ent', 'lt', 'ss', 'obs',
  'p1', 'p2', 'p3', 'p4', 'p5', 'r1', 'r2', 'r3', 'r4', 'rd1', 'rd2', 'rd3', 'rd4', 'rt', 'rdt',
  'rg1', 'rg2', 'rg3', 'rg4', 'ch1', 'ch2', 'ch3', 'ch4', 'bk1', 'bk2', 'bk3', 'bk4', 'fal1', 'fal2', 'fal3', 'fal4',
  'o0u', 'o1u', 'o2u', 'o3u', 'o4u', 'o0', 'o1', 'o2', 'o3', 'o4', 'en1', 'en2', 'en3', 'en4', 'e1', 'e2', 'e3', 'e4', 'qm', 'ev',
] as const;

const pick = <K extends keyof FilaCompleta>(f: FilaCompleta, cols: readonly K[]): Pick<FilaCompleta, K> => {
  const o = {} as Pick<FilaCompleta, K>;
  for (const k of cols) o[k] = f[k];
  return o;
};

export type FilaPresupuesto = Pick<FilaCompleta, (typeof COLS_PRESUPUESTO)[number]>;

export interface VistaPresupuesto {
  corrida: CabeceraCorrida;
  versionVigente: CabeceraVersion | null;
  porCategoria: CompraPorCategoria[];
  total: number;
  filas: FilaPresupuesto[];
  /** Compras de urgencia: respaldo de China + faltante bajo seguridad antes de poder recibir. */
  urgencia: number;
}

export function vistaPresupuesto(c: CorridaGuardada, filas: FilaCompleta[], versionVigente: CabeceraVersion | null = null): VistaPresupuesto {
  const k = kpisCompras(filas);
  return {
    corrida: cabecera(c), versionVigente, porCategoria: compraPorCategoria(filas), total: k.totalCompra, urgencia: k.urgencia,
    filas: filas.map((f) => pick(f, COLS_PRESUPUESTO)),
  };
}

// ----------------------------------------------------------------------------- Inventario
const COLS_INVENTARIO = [
  'clave', 'productId', 'sku', 'cat', 'ori', 'met', 'abc', 'estado', 'disp', 'ent', 'costo', 'ss', 'obs', 'mxs', 'el', 'eh', 'ej', 'ek', 'es', 'ep', 'eq', 'er', 'et', 'eu',
  'ff', 'fg', 'fi', 'fj', 'c3t',
] as const;
export type FilaInventarioVista = Pick<FilaCompleta, (typeof COLS_INVENTARIO)[number]>;

export interface VistaInventario {
  corrida: CabeceraCorrida;
  kpis: KpisInventario;
  total: InventarioResumen;
  porCategoria: InventarioPorCategoria[];
  porClase: InventarioPorClase[];
  totalClase: InventarioPorClase;
  filas: FilaInventarioVista[];
}

export function vistaInventario(c: CorridaGuardada, filas: FilaCompleta[]): VistaInventario {
  const cat = inventarioPorCategoria(filas);
  const cls = inventarioPorClase(filas);
  return {
    corrida: cabecera(c), kpis: kpisInventario(filas), total: cat.total, porCategoria: cat.categorias, porClase: cls.clases, totalClase: cls.total,
    filas: filas.map((f) => pick(f, COLS_INVENTARIO)),
  };
}

// ----------------------------------------------------------------------------- Ficha SKU y OC vencidas
export interface VistaSku {
  corrida: CabeceraCorrida;
  /** Lista liviana para el buscador. */
  lista: { clave: string; sku: string; cat: string; abc: string }[];
  /** El insumo pedido, con todos los pasos del cálculo. */
  fila: FilaCompleta | null;
  meses: string[];
}

export function vistaSku(c: CorridaGuardada, filas: FilaCompleta[], clave: string | null): VistaSku {
  return {
    corrida: cabecera(c),
    lista: filas.map((f) => ({ clave: f.clave, sku: f.sku, cat: f.cat, abc: f.abc })),
    fila: (clave ? filas.find((f) => f.clave === clave) : undefined) ?? null,
    meses: c.resumen?.horizonte ?? [],
  };
}

export type FilaOcVista = FilaControlOc & { decision: DecisionOc | null };

export interface VistaOc {
  corrida: CabeceraCorrida;
  filas: FilaOcVista[];
  total: number;
}

export function vistaOc(c: CorridaGuardada, filas: FilaControlOc[], decisiones: Map<string, DecisionOc> = new Map()): VistaOc {
  const conDecision = filas.map((f) => ({ ...f, decision: f.ordenId !== null && f.productId !== null ? (decisiones.get(`${f.ordenId}|${f.productId}`) ?? null) : null }));
  return { corrida: cabecera(c), filas: conDecision, total: filas.reduce((s, f) => s + f.valor, 0) };
}

// ----------------------------------------------------------------------------- Seguimiento y Evolución
export interface VistaSeguimiento {
  corrida: CabeceraCorrida;
  version: CabeceraVersion | null;
  versiones: CabeceraVersion[];
  resultado: ResultadoSeguimiento | null;
  /** Producción y ventas del plan contra lo real del último mes cerrado (si están cargados). */
  produccion: { mes: string; concepto: string; plan: number; real: number }[];
  empresas: { id: number; name: string }[];
  empresasElegidas: number[];
}

export function vistaSeguimiento(
  c: CorridaGuardada, seg: SeguimientoCompleto | null, versiones: CabeceraVersion[],
  produccion: VistaSeguimiento['produccion'], empresas: { id: number; name: string }[], empresasElegidas: number[],
): VistaSeguimiento {
  return { corrida: cabecera(c), version: seg?.version ?? versiones.find((v) => v.vigente) ?? null, versiones, resultado: seg?.resultado ?? null, produccion, empresas, empresasElegidas };
}

export interface VistaEvolucion {
  corrida: CabeceraCorrida;
  cierres: Cierre[];
  /** El mes que se puede cerrar ahora (último mes cerrado de la última corrida) y si ya tiene cierre. */
  mesParaCerrar: string;
  yaCerrado: boolean;
  puedeRegistrar: boolean;
}

export function vistaEvolucion(c: CorridaGuardada, cierres: Cierre[], puedeRegistrar: boolean): VistaEvolucion {
  const mes = c.resumen?.corte ?? '';
  return { corrida: cabecera(c), cierres, mesParaCerrar: mes, yaCerrado: cierres.some((x) => x.mes === mes), puedeRegistrar };
}

// Desembolsos de MP: pagado por mes (real) y proyectado del horizonte, con IVA y percepciones.
// Port de la hoja "Desembolsos" del libro v12, contrastado contra verify_des.py (88 cifras).
// Función pura: no lee Odoo ni archivos.
import type { FilaCalc, LineaAsignada, Origen, OcLinea } from './motor.ts';

export interface CondPagoProveedor {
  /** Condición de Odoo, ej. "PROVEEDORES - 30 dias". */
  cond: string;
  /** Resumen, ej. "100% a 30 d". */
  resumen: string;
}
export interface FacturaAbierta {
  proveedor: string;
  numero: string;
  moneda: string;
  neto: number;
  total: number;
  saldo: number;
  /** AAAA-MM-DD o null. */
  vencimiento: string | null;
}
export interface Pago {
  /** AAAA-MM-DD */
  fecha: string;
  moneda: string;
  importeOriginal: number;
  importeArs: number;
  /** "FP/2026/01/0116, FP/2026/01/0117" */
  facturas: string;
}
export interface ImpuestoFactura {
  proveedor: string;
  numero: string;
  moneda: string;
  neto: number;
  iva: number;
  percepciones: number;
  total: number;
}
export interface GastoImportacion {
  fecha: string;
  tipo: string;
  importeArs: number;
}
/** Condición por defecto cuando el proveedor no tiene una cargada. */
export interface CondDefault {
  dias: number;
  anticipado: boolean;
  iva: number;
  perc: number;
}

export interface EntradaDesembolsos {
  anio: number;
  /** Mes en curso (1-12): el mes siguiente al último cerrado. */
  mesCurso: number;
  fechaExportacion: string;
  /** Fracción del mes en curso que falta (para los gastos de importación del mes 1). */
  fraccionMes1: number;
  filas: FilaCalc[];
  ocs: OcLinea[];
  ocLineas: LineaAsignada[];
  /** Costo por insumo (el mismo del motor), por `clave` del insumo. */
  costos: Map<string, number>;
  condPago: Map<string, CondPagoProveedor>;
  facturas: FacturaAbierta[];
  pagos: Pago[];
  impuestos: ImpuestoFactura[];
  gastos: GastoImportacion[];
  origenProveedor: Record<string, Origen>;
  defaults: Record<Origen, CondDefault>;
  /** Tipo de cambio USD. null = el del último pago en USD. */
  tipoCambio: number | null;
  /** Meses cerrados sobre los que se promedian los gastos de importación proyectados. */
  mesesGastoPromedio: number[];
}

/** neto, IVA, percepciones. */
export type Tri = [number, number, number];
export interface ResultadoDesembolsos {
  tipoCambio: number;
  /** Por mes 1-12 del año: neto, IVA, percepciones y gastos de importación. */
  real: Record<number, [number, number, number, number]>;
  /** Gastos de importación reales por mes y tipo de cuenta. */
  gastosPorTipo: Record<string, Record<number, number>>;
  /** Proyección por mes del horizonte (índice 1-4; 5 = después). */
  facturasAbiertas: Tri[];
  ocEmitidas: Tri[];
  compras: Tri[];
  gastosProyectados: number[];
}

const N = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const jsRound = (x: number) => Math.round(x);   // half away from zero para positivos, como ROUND de Excel

function fechaParts(s: string | null): { y: number; m: number; d: number; ord: number } | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  return { y, m, d, ord: Date.UTC(y, m - 1, d) / 86400000 };
}
function diasDe(resumen: string | undefined): number | null {
  const m = / a (\d+) d/.exec(resumen ?? '');
  return m ? parseInt(m[1]!, 10) : null;
}
const trio = (): Tri[] => Array.from({ length: 6 }, () => [0, 0, 0] as Tri);

export function calcularDesembolsos(inp: EntradaDesembolsos): ResultadoDesembolsos {
  const org = (prov: string): Origen => inp.origenProveedor[prov] ?? 'Local';
  const fexp = fechaParts(inp.fechaExportacion)!;
  const D = inp.defaults;

  // --- impuestos por factura y tasas reales por proveedor (solo facturas en ARS)
  const imp = new Map<string, ImpuestoFactura>();
  const rate = new Map<string, [number, number, number]>();
  for (const r of inp.impuestos) {
    imp.set(r.numero.trim(), r);
    if (r.moneda === 'ARS') {
      const o = rate.get(r.proveedor.trim()) ?? [0, 0, 0];
      o[0] += r.neto; o[1] += r.iva; o[2] += r.percepciones;
      rate.set(r.proveedor.trim(), o);
    }
  }
  const rates = (prov: string, o: Origen): [number, number] => {
    if (o !== 'Local') return [0, 0];
    const t = rate.get(prov);
    if (t && t[0] > 0) return [t[1] / t[0], t[2] / t[0]];
    return [D.Local.iva, D.Local.perc];
  };

  // --- tipo de cambio: el del último pago en USD, salvo que venga uno cargado
  let fx = inp.tipoCambio;
  if (fx === null) {
    const usd = inp.pagos
      .map((p, i) => ({ f: p.fecha, i, v: p.importeOriginal > 0 ? p.importeArs / p.importeOriginal : 0, m: p.moneda, o: p.importeOriginal }))
      .filter((x) => x.m === 'USD' && x.o > 0)
      .sort((a, b) => (a.f < b.f ? -1 : a.f > b.f ? 1 : a.i - b.i));
    fx = usd.length ? usd[usd.length - 1]!.v : 0;
  }

  // --- 1. real: pagos abiertos por la proporción de la primera factura que cancelan
  const real: Record<number, [number, number, number, number]> = {};
  const realMes = (m: number) => (real[m] ??= [0, 0, 0, 0]);
  const keyDe = (f: string) => ({ y: +f.slice(0, 4), m: +f.slice(5, 7) });
  for (const p of inp.pagos) {
    const { y, m } = keyDe(p.fecha);
    if (y !== inp.anio) continue;
    const f1 = (p.facturas || '').split(',')[0]!.trim();
    const t = f1 ? imp.get(f1) : undefined;
    let sn = 1, si = 0;
    if (t && t.total) { sn = t.neto / t.total; si = t.iva / t.total; }
    const a = realMes(m);
    a[0] += p.importeArs * sn; a[1] += p.importeArs * si; a[2] += p.importeArs * Math.max(0, 1 - sn - si);
  }
  const gastosPorTipo: Record<string, Record<number, number>> = {};
  for (const g of inp.gastos) {
    const { y, m } = keyDe(g.fecha);
    if (y !== inp.anio) continue;
    realMes(m)[3] += g.importeArs;
    ((gastosPorTipo[g.tipo] ??= {})[m] = (gastosPorTipo[g.tipo]?.[m] ?? 0) + g.importeArs);
  }

  // --- 2a. facturas abiertas: por vencimiento; las vencidas van al mes 1
  const fa = trio();
  for (const r of inp.facturas) {
    const saldo = r.saldo * (r.moneda === 'USD' ? fx : 1);
    const v = fechaParts(r.vencimiento);
    const m = v === null || v.ord <= fexp.ord ? 1 : Math.min(5, v.y * 12 + v.m - (inp.anio * 12 + inp.mesCurso) + 1);
    const sn = r.total ? r.neto / r.total : 1;
    const t = imp.get(r.numero.trim());
    const si = t && t.total ? t.iva / t.total : 1 - sn;
    fa[m]![0] += saldo * sn; fa[m]![1] += saldo * si; fa[m]![2] += saldo * Math.max(0, 1 - sn - si);
  }

  // --- 2b. OC emitidas que faltan recibir: entrante asignado × costo, en el mes de llegada + días de la condición
  const oc = trio();
  const ocPorFila = new Map(inp.ocs.map((l) => [l.fila, l]));
  for (const a of inp.ocLineas) {
    if (a.asignado <= 0) continue;
    const l = ocPorFila.get(a.fila);
    if (!l) continue;
    const prov = (l.prov ?? '').trim();
    const o = org(prov);
    const ct = (l.condicion ?? '').replace('PROVEEDORES - ', '').trim();
    const pc = inp.condPago.get(prov);
    const sd = diasDe(pc?.resumen) ?? D[o].dias;
    let ant: boolean;
    if (ct) ant = ct.toLowerCase().includes('anticip');
    else if (pc?.cond) ant = pc.cond.toLowerCase().includes('anticip');
    else ant = D[o].anticipado;
    if (ant) continue;
    let dias: number;
    if (!ct) dias = sd;
    else if (ct.toLowerCase().includes('contado')) dias = 0;
    else {
      const nums = (ct.match(/\d+/g) ?? []).map(Number);
      dias = nums.length ? (nums[0]! + nums[nums.length - 1]!) / 2 : sd;
    }
    const pm = Math.min(5, a.mes + jsRound(dias / (365 / 12)));
    const val = a.asignado * (inp.costos.get(a.clave) ?? 0);
    const [iv, pcp] = rates(prov, o);
    oc[pm]![0] += val; oc[pm]![1] += val * iv; oc[pm]![2] += val * pcp;
  }

  // --- 2c. compras del presupuesto: Local/Brasil pagan al llegar + plazo; China y anticipados, al emitir la orden
  const pr = trio();
  for (const f of inp.filas) {
    const prov = f.prov.trim();
    const o = f.ori;
    const porg = org(prov);
    let pc = porg === o ? inp.condPago.get(prov) : undefined;
    if (pc && pc.resumen === '') pc = undefined;
    const ant = pc?.cond ? pc.cond.toLowerCase().includes('anticip') : D[o].anticipado;
    const dias = diasDe(pc?.resumen) ?? D[o].dias;
    const sh = jsRound(dias / (365 / 12));
    const [iv, pcp] = porg === o ? rates(prov, o) : o === 'Local' ? [D.Local.iva, D.Local.perc] : [0, 0];
    const rd = [0, f.rd1, f.rd2, f.rd3, f.rd4];
    const em = [0, f.o1, f.o2, f.o3, f.o4];
    for (let j = 1; j <= 4; j++) {
      const v = ant ? em[j]! + (f.em27 === j ? f.q27d : 0) : j - sh >= 1 ? rd[j - sh]! : 0;
      pr[j]![0] += v; pr[j]![1] += v * iv; pr[j]![2] += v * pcp;
    }
  }

  // --- gastos de importación proyectados: promedio de los últimos meses cerrados
  const gp = inp.mesesGastoPromedio.length
    ? inp.mesesGastoPromedio.reduce((s, m) => s + (real[m]?.[3] ?? 0), 0) / inp.mesesGastoPromedio.length
    : 0;
  const fac = [inp.fraccionMes1, 1, 1, 1];

  return {
    tipoCambio: fx, real, gastosPorTipo,
    facturasAbiertas: fa, ocEmitidas: oc, compras: pr,
    gastosProyectados: fac.map((f) => gp * f),
  };
}

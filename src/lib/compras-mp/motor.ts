// Motor del Presupuesto de Compras de MP — port a TypeScript de presupuesto_compras.py
// (validado contra el libro Presupuesto_Compras_MP_v12, hoja "Cálculo SKU").
//
// Es una función pura: recibe datos ya cargados y devuelve una fila por SKU con todas las columnas
// intermedias. No lee Odoo ni archivos, ni toca Supabase; eso lo hacen las capas de afuera.
// No importa nada para poder correr tal cual con `node` en las pruebas golden.

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export type Origen = 'Local' | 'Brasil' | 'China';
const ORDEN_ORIGEN: Record<string, number> = { Local: 1, Brasil: 2, China: 3 };
const NOMBRE_ORIGEN: Record<number, Origen> = { 1: 'Local', 2: 'Brasil', 3: 'China' };

export interface Excepcion {
  metodo?: string;
  critico?: boolean;
  costo?: number;
  consumo_forzado?: number;
  origen?: Origen;
  respaldo?: Origen | 'Ninguno';
  reemplazo_desde?: number;
  reemplazado_por?: string;
}

export interface PlanSiguiente {
  prod_colchones: number | null;
  prod_sillones: number | null;
  ventas_colchones: number | null;
}

export interface Config {
  sommier_pct_ventas: number;
  pocket_x18_mes: number;
  eps_semana: number;
  semanas_mes: number;
  umbral_A: number;
  umbral_B: number;
  dias_por_semana: number;
  umbral_tendencia: number;
  plan_mes_siguiente: PlanSiguiente;
  plan_enero_siguiente: PlanSiguiente;
  origenes: Record<Origen, { lead_dias: number; ss_min: number; ciclo: number }>;
  ss_abc: Record<string, number>;
  ciclo_abc: Record<string, number>;
  ss_critico: number;
  linea_por_categoria: Record<string, string>;
  colecciones: Record<string, string>;
  prefijos_tela_living: string[];
  quimicos_principales: string[];
  colecciones_discontinuadas: string[];
  origen_proveedor: Record<string, Origen>;
  excepciones: Record<string, Excepcion>;
  /** Condición de pago por origen cuando el proveedor no tiene una cargada (desembolsos). */
  cond_pago_default: Record<Origen, { dias: number; anticipado: boolean; iva: number; perc: number }>;
}

/** Una fila de producto de la base (un insumo de MP). La clave es el nombre en pantalla. */
export interface BaseRow {
  /** product.product.id de Odoo. Si viene, es la clave del insumo (el nombre puede cambiar); si no, se usa el nombre. */
  productId?: number;
  sku: string;
  /** Categoría completa de Odoo, ej. "Materia Prima / Patas". */
  categoria: string;
  /** Primer proveedor (el que muestra la tabla). */
  prov: string;
  proveedores: string[];
  disp: number;
  ent: number;
  costo: number;
}

/** Historial de consumo: columnas alineadas con `headers` (ej. "septiembre 2026"). */
export interface ConsumoTabla {
  headers: (string | null)[];
  filas: { nombre: string; productId?: number; vals: (number | null)[] }[];
}

/** Plan mensual: 12 valores (enero..diciembre) por concepto; null/faltante = 0. */
export interface PlanMensual {
  diasHabiles: (number | null)[];
  diasTranscurridos: (number | null)[];
  prodRealSillones: (number | null)[];
  prodRealColchones: (number | null)[];
  prodConsSillones: (number | null)[];
  prodConsColchones: (number | null)[];
  ventasConsColchones: (number | null)[];
}

export interface OcLinea {
  /** Orden de lectura (desempata líneas con la misma fecha). */
  fila: number;
  /** Nombre del insumo. */
  n: string;
  /** AAAA-MM-DD; si no se puede leer se usa la fecha de la base. */
  fecha: string | null;
  pend: number;
  // Datos de la OC que usan el control de vencidas y los desembolsos (opcionales para el cálculo del presupuesto).
  productId?: number;
  /** purchase.order.line.id y purchase.order.id (para guardar decisiones y control). */
  lineaId?: number;
  ordenId?: number;
  orden?: string;
  prov?: string;
  categoria?: string;
  fechaOrden?: string | null;
  pedida?: number;
  recibida?: number;
  condicion?: string;
  ultimaRecepcion?: string | null;
  recepcionProgramada?: string | null;
  remito?: string;
}

/** Cómo se asignó el entrante de la base a una línea de OC. */
export interface LineaAsignada {
  fila: number;
  n: string;
  /** Clave del insumo (`#id` o el nombre). */
  clave: string;
  asignado: number;
  /** Mes de llegada 1-5 (5 = después del horizonte); las vencidas van al mes 2. */
  mes: number;
  vencida: boolean;
  /** Hay otra línea del mismo insumo con fecha prevista posterior. */
  hayMasNueva: boolean;
}

export interface EntradaMotor {
  base: BaseRow[];
  consumo: ConsumoTabla;
  plan: PlanMensual;
  oc: OcLinea[];
  /** Último mes cerrado (1-12). */
  corte: number;
  anio: number;
  /** Días hábiles del mes en curso a la fecha de la base (null = el del plan). */
  diasTranscurridos: number | null;
  /** AAAA-MM-DD de la base de datos. */
  fechaExportacion: string;
  cfg: Config;
}

// ----------------------------------------------------------------------------- utilidades
/** round() de Python (redondea los .5 al par). */
function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const max0 = (x: number) => (x > 0 ? x : 0);

interface Fecha { y: number; m: number; d: number; ord: number }
function parseFecha(v: string | null | undefined, defecto: Fecha): Fecha {
  if (v) {
    const s = String(v);
    const y = parseInt(s.slice(0, 4), 10), m = parseInt(s.slice(5, 7), 10), d = parseInt(s.slice(8, 10), 10);
    if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d) && /^\d{4}-\d{2}-\d{2}/.test(s)) return mkFecha(y, m, d);
  }
  return defecto;
}
function mkFecha(y: number, m: number, d: number): Fecha {
  return { y, m, d, ord: Date.UTC(y, m - 1, d) / 86400000 };
}
function diasDelMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface EntrantePorMes {
  e1: number; e2: number; e3: number; e4: number; e5: number;
  ev: number; esf: number; oca: number; ocp: number;
}

/** Reparte el entrante de la base entre las OC más recientes de cada SKU y lo ubica por mes de llegada.
 *  Vencidas (fecha <= fecha de la base) y entrante sin OC → mes 2. */
export function claveInsumo(productId: number | undefined, nombre: string): string {
  return productId !== undefined ? `#${productId}` : nombre;
}

export function entrantePorMes(claves: string[], entrante: number[], oc: OcLinea[], fexp: Fecha, anio: number, mesCurso: number, lineasOut?: LineaAsignada[]): Map<string, EntrantePorMes> {
  const by = new Map<string, (OcLinea & { f: Fecha })[]>();
  for (const l of oc) {
    const k = claveInsumo(l.productId, l.n);
    const arr = by.get(k) ?? [];
    arr.push({ ...l, f: parseFecha(l.fecha, fexp) });
    by.set(k, arr);
  }
  const res = new Map<string, EntrantePorMes>();
  claves.forEach((s, idx) => {
    const ent = entrante[idx] ?? 0;
    const lines = [...(by.get(s) ?? [])].sort((a, b) => b.f.ord - a.f.ord || a.fila - b.fila);
    const e = [0, 0, 0, 0, 0, 0];
    let ev = 0, acum = 0, oca = 0;
    const maxOrd = lines.length ? lines[0]!.f.ord : 0;
    for (const l of lines) {
      const a = Math.max(0, Math.min(l.pend, ent - acum));
      acum += l.pend; oca += a;
      let b: number;
      if (l.f.ord <= fexp.ord) { b = 2; ev += a; }
      else b = Math.max(1, Math.min(5, l.f.y * 12 + l.f.m - (anio * 12 + mesCurso) + 1));
      e[b]! += a;
      lineasOut?.push({ fila: l.fila, n: l.n, clave: s, asignado: a, mes: b, vencida: l.f.ord <= fexp.ord && a > 0, hayMasNueva: l.f.ord < maxOrd });
    }
    const esf = Math.max(0, ent - oca);
    e[2]! += esf;
    res.set(s, { e1: e[1]!, e2: e[2]!, e3: e[3]!, e4: e[4]!, e5: e[5]!, ev, esf, oca, ocp: sum(lines.map((l) => l.pend)) });
  });
  return res;
}

export function mesesSinLlegada(ltSemanas: number, diasRestantes: number): number {
  if (ltSemanas === 0) return 0;
  const x = Math.max(0, pyRound(ltSemanas * 7) - diasRestantes) / (365 / 12);
  return Math.ceil(x - 1e-12);
}

// ----------------------------------------------------------------------------- resultado
export interface FilaCalc {
  /** `#id` si el producto tiene product_id; si no, el nombre. */
  clave: string;
  productId: number | null;
  sku: string; cat: string; prov: string; lin: string; ori: Origen; resp: string;
  disp: number; ent: number; costo: number; forz: number; crit: boolean; pos: number;
  col: string; colr: string; met: string; drv: string;
  c1: number; c2: number; c3: number; c4: number; c4t: number; c3t: number;
  e1: number; e2: number; e3: number; e4: number; e5: number; ev: number; esf: number; oca: number; ocp: number;
  tend: string; coef: number; coefb: number;
  p1: number; p2: number; p3: number; p4: number; p5: number;
  pt: number; pv: number; abc: string;
  lt: number; ltb: number; cic: number; ss: number; obs: number; mxs: number; idw: number;
  cut: number; rnom: string; lm: number; lmb: number;
  rg1: number; rg2: number; rg3: number; rg4: number;
  ch1: number; ch2: number; ch3: number; ch4: number;
  bk1: number; bk2: number; bk3: number; bk4: number;
  fal1: number; fal2: number; fal3: number; fal4: number;
  en1: number; en2: number; en3: number; en4: number;
  r1: number; r2: number; r3: number; r4: number;
  rd1: number; rd2: number; rd3: number; rd4: number;
  rt: number; rdt: number;
  o0u: number; o1u: number; o2u: number; o3u: number; o4u: number;
  o0: number; o1: number; o2: number; o3: number; o4: number;
  w1: number; w2: number; w3: number; w4: number; q27d: number;
  mag: number; obso: number; q27: number; em27: number; qm: number;
}

export interface ResultadoMotor {
  filas: FilaCalc[];
  /** Meses del horizonte: clave AAAA-MM y nombre. */
  meses: { clave: string; nombre: string }[];
  mArch: number;
  calib: Record<string, number>;
  ocLineas: LineaAsignada[];
}

// ----------------------------------------------------------------------------- cálculo
export function calcular(inp: EntradaMotor): ResultadoMotor {
  const C = inp.cfg;
  const EXC = C.excepciones;
  const semmes = C.semanas_mes;
  const { corte, anio } = inp;

  // --- columnas base
  const base = inp.base;
  const n = base.length;
  const skus = base.map((b) => b.sku);
  const claves = base.map((b) => claveInsumo(b.productId, b.sku));
  // Excepciones: por product_id (`#id`) y, si no hay, por nombre.
  const excB: Excepcion[] = base.map((b) => (b.productId !== undefined ? EXC[`#${b.productId}`] : undefined) ?? EXC[b.sku] ?? {});
  const cat = base.map((b) => {
    const c = b.categoria.trim();
    return c === 'Materia Prima' ? 'Otros' : c.replace('Materia Prima / ', '');
  });
  const disp = base.map((b) => b.disp);
  const ent = base.map((b) => b.ent);
  const costo = base.map((b, i) => excB[i]!.costo || b.costo);
  const forz = base.map((_, i) => excB[i]!.consumo_forzado || 0);
  const crit = base.map((_, i) => !!excB[i]!.critico);

  const lin = base.map((b, i) => {
    const c = cat[i]!;
    if (c === 'Nylon') return b.sku.toUpperCase().includes('NYLON VIRGEN') ? 'Colchones' : 'Living';
    return C.linea_por_categoria[c] ?? 'Living';
  });

  // origen por prioridad entre todos los proveedores (China > Brasil > Local); respaldo = el siguiente
  const ori: Origen[] = [];
  const resp: string[] = [];
  base.forEach((b, bi) => {
    const rksSet = new Set<number>();
    for (const p of b.proveedores) rksSet.add(ORDEN_ORIGEN[C.origen_proveedor[p] ?? 'Local']!);
    let rks = [...rksSet].sort((a, c) => c - a);
    if (rks.length === 0) rks = [1];
    const e = excB[bi]!;
    let r1: number, r2: number;
    const menores = (lim: number) => Math.max(0, ...rks.filter((x) => x < lim));
    if (e.origen) {
      r1 = ORDEN_ORIGEN[e.origen]!;
      if (e.respaldo) r2 = e.respaldo === 'Ninguno' ? 0 : ORDEN_ORIGEN[e.respaldo]!;
      else r2 = r1 < 3 ? 0 : menores(r1);
    } else {
      r1 = rks[0]!;
      r2 = menores(r1);
    }
    ori.push(NOMBRE_ORIGEN[r1]!);
    resp.push(r1 < 3 ? '' : r2 ? NOMBRE_ORIGEN[r2]! : 'Sin respaldo');
  });

  // colección y color (Tela Living)
  const colKeys = Object.keys(C.colecciones);
  const col: string[] = [], colr: string[] = [];
  base.forEach((b, i) => {
    if (cat[i] !== 'Tela Living') { col.push(''); colr.push(''); return; }
    const up = b.sku.toUpperCase();
    const m = colKeys.filter((a) => up.startsWith(a));
    if (m.length) {
      const a = m.reduce((x, y) => (y.length > x.length ? y : x));
      col.push(C.colecciones[a]!); colr.push(b.sku.slice(a.length).trim());
    } else {
      const k = b.sku.indexOf(' ');
      col.push(k < 0 ? b.sku : b.sku.slice(0, k)); colr.push(k < 0 ? '' : b.sku.slice(k + 1).trim());
    }
  });

  // método y driver
  const met = base.map((b, i) => {
    const s = b.sku, c = cat[i]!;
    const e = excB[i]!;
    if (e.metodo) return e.metodo;
    if (C.quimicos_principales.includes(s)) return 'Químico principal';
    if (costo[i] === 0) return 'Consignado';
    if (c === 'Tela Living' && C.colecciones_discontinuadas.includes(col[i]!)) return 'Discontinuado';
    if (c === 'Bases') {
      const u = s.toUpperCase();
      if (u.includes('SOMMIER')) return 'Sommier';
      if (u.includes('EPS')) return 'EPS';
      if (u.includes('POCKET') && (u + ' ').includes('X18 ')) return 'Pocket x18';
      return 'Discontinuado';
    }
    if (c === 'Grampas' || c === 'Alambre') return 'Promedio';
    if (c === 'Tela Living') return 'Tela Living';
    return 'Coeficiente';
  });
  const drv = base.map((_, i) => {
    const m = met[i]!, l = lin[i]!;
    if (forz[i]! > 0) return 'Mes';
    if (m === 'Coeficiente' || m === 'Agotar stock') return l === 'Colchones' ? 'Prod Colchones' : l === 'Living' ? 'Prod Sillones' : 'Prod Total';
    if (m === 'Químico principal') return 'Prod Total';
    const map: Record<string, string> = { Promedio: 'Mes', Sommier: 'Sommier', 'Pocket x18': 'Pocket x18', EPS: 'EPS', 'Tela Living': 'Tela Living' };
    return map[m] ?? 'Sin proyección';
  });

  // --- consumo: 4 meses cerrados hasta el corte
  const hdr = inp.consumo.headers;
  const ci = hdr.findIndex((h) => h === `${MESES[corte - 1]} ${anio}`);
  if (ci < 0) throw new Error(`El historial de consumo no trae el mes ${MESES[corte - 1]} ${anio}`);
  const porNombre = new Map<string, number[]>();
  const porId = new Map<number, number[]>();
  const nombreDeId = new Map<number, string>();
  for (const f of inp.consumo.filas) {
    const vals: number[] = [];
    for (let j = 0; j < 4; j++) {
      const v = f.vals[ci - 3 + j];
      vals.push(typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }
    porNombre.set(f.nombre.trim(), vals);
    if (f.productId !== undefined) { porId.set(f.productId, vals); nombreDeId.set(f.productId, f.nombre.trim()); }
  }
  // Con product_id en el historial, el consumo se asigna por id (los nombres pueden repetirse o cambiar).
  const consumoPorId = porId.size > 0;
  const consDe = (i: number): number[] | undefined => {
    const id = base[i]!.productId;
    return consumoPorId && id !== undefined ? porId.get(id) : porNombre.get(skus[i]!);
  };
  const c1 = skus.map((_, i) => consDe(i)?.[0] ?? 0);
  const c2 = skus.map((_, i) => consDe(i)?.[1] ?? 0);
  const c3 = skus.map((_, i) => consDe(i)?.[2] ?? 0);
  const c4 = skus.map((_, i) => consDe(i)?.[3] ?? 0);
  const c4t = skus.map((_, i) => c1[i]! + c2[i]! + c3[i]! + c4[i]!);
  const c3t = skus.map((_, i) => c2[i]! + c3[i]! + c4[i]!);
  // Telas del historial que ya no están en la base (archivadas): su consumo calibra los metros por sillón.
  let mArch = 0;
  if (consumoPorId) {
    const idsBase = new Set(base.map((b) => b.productId));
    porId.forEach((v, id) => {
      if (!idsBase.has(id) && C.prefijos_tela_living.includes((nombreDeId.get(id) ?? '').split(' ')[0]!)) mArch += sum(v);
    });
  } else {
    const inbase = new Set(skus);
    porNombre.forEach((v, nombre) => {
      if (!inbase.has(nombre) && C.prefijos_tela_living.includes(nombre.split(' ')[0]!)) mArch += sum(v);
    });
  }

  // --- plan
  const P = inp.plan;
  const val = (arr: (number | null)[], mes: number) => {
    const v = mes >= 1 && mes <= 12 ? arr[mes - 1] : null;
    return typeof v === 'number' ? v : 0;
  };
  const dhm = val(P.diasHabiles, corte + 1);
  const dt = inp.diasTranscurridos ?? val(P.diasTranscurridos, corte + 1);
  const frac = dhm ? Math.max(0, dhm - dt) / dhm : 0;
  const calm = [0, 1, 2, 3].map((j) => corte - 3 + j);
  const realC = calm.map((m) => val(P.prodRealColchones, m));
  const realS = calm.map((m) => val(P.prodRealSillones, m));
  const hm = [0, 1, 2, 3].map((j) => corte + 1 + j);
  const fac = [frac, 1, 1, 1];
  const pe = C.plan_enero_siguiente;
  const J = [pe.prod_colchones || 0, pe.prod_sillones || 0, pe.ventas_colchones || 0];
  const serie = (arr: (number | null)[], ji: number) => {
    const out: number[] = [];
    for (const m of hm) {
      if (m <= 12) out.push(val(arr, m));
      else if (m === 13 && J[ji]! > 0) out.push(J[ji]!);
      else out.push(out.length ? out[out.length - 1]! : 0);
    }
    return out;
  };
  const planC = serie(P.prodConsColchones, 0), planS = serie(P.prodConsSillones, 1), ventC = serie(P.ventasConsColchones, 2);
  const m5 = hm[3]! + 1;
  const ps = C.plan_mes_siguiente;
  let n5: number[];
  if (m5 <= 12 && val(P.prodConsColchones, m5) > 0) n5 = [val(P.prodConsColchones, m5), val(P.prodConsSillones, m5), val(P.ventasConsColchones, m5)];
  else if (m5 === 13 && J[0]! > 0) n5 = J;
  else n5 = [ps.prod_colchones ?? planC[3]!, ps.prod_sillones ?? planS[3]!, ps.ventas_colchones ?? ventC[3]!];
  const planC5 = [...planC, n5[0]!], planS5 = [...planS, n5[1]!], ventC5 = [...ventC, n5[2]!], fac5 = [...fac, 1];

  const calib: Record<string, number> = {
    'Prod Colchones': sum(realC), 'Prod Sillones': sum(realS), 'Prod Total': sum(realC) + sum(realS), Mes: 4, 'Sin proyección': 1,
  };
  const last: Record<string, number> = {
    'Prod Colchones': realC[3]!, 'Prod Sillones': realS[3]!, 'Prod Total': realC[3]! + realS[3]!, Mes: 1, 'Sin proyección': 1,
  };
  for (const k of ['Sommier', 'Pocket x18', 'EPS', 'Tela Living']) {
    calib[k] = sum(skus.map((_, i) => (drv[i] === k ? c4t[i]! : 0)));
    last[k] = 0;
  }
  const sumS = sum(realS);
  const mps = sumS ? (calib['Tela Living']! + mArch) / sumS : 0;
  const dval = (k: string, j: number): number => {
    const f = fac5[j]!;
    switch (k) {
      case 'Prod Colchones': return planC5[j]! * f;
      case 'Prod Sillones': return planS5[j]! * f;
      case 'Prod Total': return (planC5[j]! + planS5[j]!) * f;
      case 'Mes': return f;
      case 'Sommier': return C.sommier_pct_ventas * ventC5[j]! * f;
      case 'Pocket x18': return C.pocket_x18_mes * f;
      case 'EPS': return C.eps_semana * semmes * f;
      case 'Tela Living': return mps * planS5[j]! * f;
      default: return 0;
    }
  };

  // --- entrante ubicado por mes con las fechas de las OC abiertas
  const fexpD = parseFecha(inp.fechaExportacion, mkFecha(1970, 1, 1));
  const ocLineas: LineaAsignada[] = [];
  const EM = entrantePorMes(claves, ent, inp.oc, fexpD, anio, corte + 1, ocLineas);
  const em = (i: number) => EM.get(claves[i]!)!;

  // --- coeficiente y proyección
  const tend: string[] = [], coefA: number[] = [], coefbA: number[] = [];
  const pArr: number[][] = [];
  for (let i = 0; i < n; i++) {
    const k = drv[i]!, cal = calib[k]!, calu = last[k]!;
    const coefb = cal ? c4t[i]! / cal : 0;
    const coefu = calu ? c4[i]! / calu : 0;
    let rat: number | null;
    if (c4t[i] === 0 || k === 'Sin proyección') rat = null;
    else if (calu > 0) rat = coefb ? coefu / coefb : null;
    else rat = c4[i]! / (c4t[i]! / 4);
    const t = rat === null ? '' : rat >= 1 + C.umbral_tendencia ? 'Creciente' : rat <= 1 - C.umbral_tendencia ? 'Decreciente' : 'Estable';
    const positivos = [c1[i]!, c2[i]!, c3[i]!, c4[i]!].filter((v) => v > 0).length;
    let coef: number;
    if (forz[i]! > 0) coef = forz[i]!;
    else if (t === 'Creciente' && (met[i] === 'Coeficiente' || met[i] === 'Químico principal') && positivos >= 2) coef = Math.max(coefb, coefu);
    else coef = coefb;
    const p = [0, 1, 2, 3, 4].map((j) => coef * dval(k, j));
    if (met[i] === 'Agotar stock') {   // se consume solo hasta agotar disponible + entrante; no se compra
      let av = disp[i]!;
      const ee = [em(i).e1, em(i).e2, em(i).e3, em(i).e4];
      for (let j = 0; j < 5; j++) {
        if (j < 4) av += ee[j]!;
        p[j] = Math.max(0, Math.min(p[j]!, av));
        av -= p[j]!;
      }
    }
    tend.push(t); coefA.push(coef); coefbA.push(coefb); pArr.push(p);
  }

  // --- ABC
  const pt = pArr.map((p) => p[0]! + p[1]! + p[2]! + p[3]!);
  const pv = pt.map((v, i) => v * costo[i]!);
  const tot = sum(pv);
  const abc = pv.map((v) => {
    if (v <= 0) return 'Sin consumo';
    let acc = 0;
    for (const w of pv) if (w >= v) acc += w;
    const q = acc / tot;
    return q <= C.umbral_A ? 'A' : q <= C.umbral_B ? 'B' : 'C';
  });

  // --- política
  const O_ = C.origenes;
  const lt = ori.map((o) => O_[o].lead_dias / 7);
  const ltb = resp.map((r) => (r in O_ ? O_[r as Origen].lead_dias / 7 : 0));
  const cic = ori.map((o) => O_[o].ciclo);
  const ss = abc.map((a, i) => (a === 'Sin consumo' || met[i] === 'Agotar stock' ? 0 : Math.max(C.ss_abc[a]!, O_[ori[i]!].ss_min, crit[i] ? C.ss_critico : 0)));
  const obs = abc.map((a, i) => (a === 'Sin consumo' || met[i] === 'Agotar stock' ? 0 : lt[i]! + ss[i]!));
  const mxs = obs.map((o, i) => {
    if (o === 0) return 0;
    if (cic[i]! > 1) return ss[i]! + cic[i]! * semmes + (resp[i] === 'Local' || resp[i] === 'Brasil' ? lt[i]! : 0);
    return o + (C.ciclo_abc[abc[i]!] ?? 0);
  });
  const idw = obs.map((o, i) => (o === 0 ? 0 : cic[i]! > 1 ? ss[i]! + (cic[i]! * semmes) / 2 : o));
  const sem = fac5.map((f) => f * semmes);
  const W = pArr.map((p) => [0, 1, 2, 3].map((j) => (sem[j + 1] ? p[j + 1]! / sem[j + 1]! : 0)));

  // meses en que ninguna compra nueva puede llegar (según los días corridos que quedan del mes en curso)
  const rem = diasDelMes(fexpD.y, fexpD.m) - fexpD.d;
  const keys = hm.map((m) => (anio + Math.floor((m - 1) / 12)) * 100 + ((m - 1) % 12) + 1);
  const cut = skus.map((_, i) => {
    const rd = excB[i]!.reemplazo_desde || 0;
    if (!rd) return 0;
    const idx = keys.findIndex((kk) => kk >= rd);
    return idx < 0 ? 0 : idx + 1;
  });
  const rnom = skus.map((_, i) => excB[i]!.reemplazado_por || '');
  const lm = lt.map((x) => mesesSinLlegada(x, rem));
  const lmb = ltb.map((x) => mesesSinLlegada(x, rem));

  // --- compra mes a mes
  const RG = skus.map(() => [0, 0, 0, 0]);
  const CH = skus.map(() => [0, 0, 0, 0]);
  const BK = skus.map(() => [0, 0, 0, 0]);
  const FA = skus.map(() => [0, 0, 0, 0]);
  const EN = skus.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < n; i++) {
    const pp = pArr[i]!;
    const E = em(i);
    const ee = [E.e1, E.e2, E.e3, E.e4];
    let stock = disp[i]!, arrived = false;
    const Wi = W[i]!;
    for (let k = 0; k < 4; k++) {
      const start = k + 1 !== cut[i] ? stock : 0;
      const raw = start + ee[k]! - pp[k]!;
      const arrivedBefore = arrived;
      if (cic[i]! > 1) {   // compra por ciclo (China)
        const SSk = ss[i]! * Wi[k]!;
        let ch = 0;
        if (k + 1 >= lm[i]! + 1 && !arrived && raw < SSk) {
          let months = 0;
          for (let j = k; j < k + cic[i]!; j++) months += j < 4 ? pp[j]! : pp[4]!;
          let ecy = 0;
          for (let j = k; j < 4; j++) if (j <= k + cic[i]! - 1) ecy += ee[j]!;
          ch = Math.max(0, months + ss[i]! * Wi[3]! - start - ecy);
          arrived = arrived || ch > 0;
        }
        const gap = Math.max(0, SSk - raw - ch);
        if (resp[i] === 'Local' || resp[i] === 'Brasil') {
          if (k + 1 > lmb[i]! && gap > 0) {   // lote local que cubre hasta la próxima llegada de China
            let nxt = 5;
            for (let j = k + 1; j < 4; j++) if (ee[j]! > 0) { nxt = j + 1; break; }
            const A_ = Math.min(nxt, !arrivedBefore && lm[i]! + 1 > k + 1 ? lm[i]! + 1 : 5);
            let cov = 0;
            for (let j = k; j < 4; j++) if (j + 1 < A_) cov += pp[j]! - ee[j]!;
            BK[i]![k] = Math.max(0, cov + ss[i]! * Wi[Math.max(1, A_ - 1) - 1]! - start - ch);
          } else BK[i]![k] = 0;
        } else FA[i]![k] = gap;
        CH[i]![k] = ch;
        stock = raw + ch + BK[i]![k]!;
      } else {   // compra mensual: cada mes cierra en su objetivo, desde el primer mes en que puede llegar
        RG[i]![k] = k + 1 <= lm[i]! ? 0 : Math.max(0, obs[i]! * Wi[k]! - raw);
        stock = raw + RG[i]![k]!;
      }
      EN[i]![k] = stock;
    }
  }

  const mag = skus.map((_, i) => {
    if (met[i] !== 'Agotar stock') return 0;
    const k = EN[i]!.findIndex((v) => v <= 0.001);
    return k < 0 ? 0 : k + 1;
  });
  const obso = skus.map((_, i) => {
    const c = cut[i]!;
    return c === 0 ? 0 : Math.max(0, c === 1 ? disp[i]! : EN[i]![c - 2]!);
  });

  // --- órdenes a emitir
  const O: number[][] = skus.map(() => [0, 0, 0, 0, 0]);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 4; j++) {
      let e = j - lm[i]!;
      O[i]![e < 0 ? 0 : e + 1]! += RG[i]![j]! + CH[i]![j]!;
      e = j - lmb[i]!;
      O[i]![e < 0 ? 0 : e + 1]! += BK[i]![j]!;
    }
  }
  const o0u = skus.map((_, i) => {
    const lmu = cic[i]! > 1 && (resp[i] === 'Local' || resp[i] === 'Brasil') ? lmb[i]! : lm[i]!;
    let m = 0;
    for (let k = 0; k < 4; k++) if (k < lmu) m = Math.max(m, ss[i]! * W[i]![k]! - EN[i]![k]!);
    return m;
  });

  // --- importación del año siguiente y quiebres
  const q27: number[] = [], em27: number[] = [];
  skus.forEach((_, i) => {
    let nn = 0;
    if (cic[i]! > 1 && sum(CH[i]!) === 0 && pArr[i]![4]! > 0 && met[i] !== 'Agotar stock') {
      nn = Math.max(1, Math.floor((EN[i]![3]! - ss[i]! * W[i]![3]!) / pArr[i]![4]!) + 1);
    }
    let e = nn ? 4 + nn - lm[i]! : 0;
    e = e >= 1 && e <= 4 ? e : 0;
    em27.push(e);
    q27.push(e ? Math.max(0, cic[i]! * pArr[i]![4]! + ss[i]! * W[i]![3]! - (EN[i]![3]! - (nn - 1) * pArr[i]![4]!)) : 0);
  });
  const qm = skus.map((_, i) => {
    const k = EN[i]!.findIndex((v) => v < 0);
    return k < 0 ? 0 : k + 1;
  });

  const filas: FilaCalc[] = skus.map((sku, i) => {
    const E = em(i), p = pArr[i]!;
    const Rm = [0, 1, 2, 3].map((j) => RG[i]![j]! + CH[i]![j]! + BK[i]![j]!);
    const cs = costo[i]!;
    return {
      clave: claves[i]!, productId: base[i]!.productId ?? null, sku, cat: cat[i]!, prov: base[i]!.prov, lin: lin[i]!, ori: ori[i]!, resp: resp[i]!,
      disp: disp[i]!, ent: ent[i]!, costo: cs, forz: forz[i]!, crit: crit[i]!, pos: disp[i]! + ent[i]!,
      col: col[i]!, colr: colr[i]!, met: met[i]!, drv: drv[i]!,
      c1: c1[i]!, c2: c2[i]!, c3: c3[i]!, c4: c4[i]!, c4t: c4t[i]!, c3t: c3t[i]!,
      e1: E.e1, e2: E.e2, e3: E.e3, e4: E.e4, e5: E.e5, ev: E.ev, esf: E.esf, oca: E.oca, ocp: E.ocp,
      tend: tend[i]!, coef: coefA[i]!, coefb: coefbA[i]!,
      p1: p[0]!, p2: p[1]!, p3: p[2]!, p4: p[3]!, p5: p[4]!,
      pt: pt[i]!, pv: pv[i]!, abc: abc[i]!,
      lt: lt[i]!, ltb: ltb[i]!, cic: cic[i]!, ss: ss[i]!, obs: obs[i]!, mxs: mxs[i]!, idw: idw[i]!,
      cut: cut[i]!, rnom: rnom[i]!, lm: lm[i]!, lmb: lmb[i]!,
      rg1: RG[i]![0]!, rg2: RG[i]![1]!, rg3: RG[i]![2]!, rg4: RG[i]![3]!,
      ch1: CH[i]![0]!, ch2: CH[i]![1]!, ch3: CH[i]![2]!, ch4: CH[i]![3]!,
      bk1: BK[i]![0]!, bk2: BK[i]![1]!, bk3: BK[i]![2]!, bk4: BK[i]![3]!,
      fal1: FA[i]![0]!, fal2: FA[i]![1]!, fal3: FA[i]![2]!, fal4: FA[i]![3]!,
      en1: EN[i]![0]!, en2: EN[i]![1]!, en3: EN[i]![2]!, en4: EN[i]![3]!,
      r1: Rm[0]!, r2: Rm[1]!, r3: Rm[2]!, r4: Rm[3]!,
      rd1: Rm[0]! * cs, rd2: Rm[1]! * cs, rd3: Rm[2]! * cs, rd4: Rm[3]! * cs,
      rt: sum(Rm), rdt: sum(Rm) * cs,
      o0u: o0u[i]!, o1u: O[i]![1]!, o2u: O[i]![2]!, o3u: O[i]![3]!, o4u: O[i]![4]!,
      o0: o0u[i]! * cs, o1: O[i]![1]! * cs, o2: O[i]![2]! * cs, o3: O[i]![3]! * cs, o4: O[i]![4]! * cs,
      w1: W[i]![0]!, w2: W[i]![1]!, w3: W[i]![2]!, w4: W[i]![3]!, q27d: q27[i]! * cs,
      mag: mag[i]!, obso: obso[i]!, q27: q27[i]!, em27: em27[i]!, qm: qm[i]!,
    };
  });

  const meses = hm.map((m) => ({
    clave: `${anio + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, '0')}`,
    nombre: MESES[(m - 1) % 12]! + (m > 12 ? ' (año sig.)' : ''),
  }));
  return { filas, meses, mArch, calib, ocLineas };
}

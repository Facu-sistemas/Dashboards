// Prueba golden del motor de Compras MP: corre el motor en TypeScript con las exportaciones de Odoo
// congeladas (entradas/) y compara campo por campo contra la hoja "Cálculo SKU" del libro v12.
//
// Uso: node tests/compras-mp/golden.ts <carpeta_del_paquete>
//   (la carpeta tiene Presupuesto_Compras_MP_v12.xlsx y entradas/)
import XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { calcular } from '../../src/lib/compras-mp/motor.ts';
import type { Config } from '../../src/lib/compras-mp/motor.ts';
import { calcularDesembolsos } from '../../src/lib/compras-mp/desembolsos.ts';
import type { CondPagoProveedor, FacturaAbierta, GastoImportacion, ImpuestoFactura, Pago } from '../../src/lib/compras-mp/desembolsos.ts';
import { controlOcVencidas } from '../../src/lib/compras-mp/control-oc.ts';
import { crearLectores } from './lectores.ts';
import { calcularInventario, type HistoriaStock } from '../../src/lib/compras-mp/inventario.ts';
import { inventarioPorCategoria, inventarioPorClase, kpisCompras, kpisInventario, type FilaCompleta } from '../../src/lib/compras-mp/indicadores.ts';

const dir = process.argv[2];
if (!dir) throw new Error('Falta la carpeta del paquete');
const cfg = JSON.parse(fs.readFileSync(new URL('../../src/lib/compras-mp/config-default.json', import.meta.url), 'utf8')) as Config;

const { hoja, num, str, leerBase, leerConsumo, leerPlan, leerOc } = crearLectores(dir);

const ocs = leerOc();
const res = calcular({
  base: leerBase(), consumo: leerConsumo(), plan: leerPlan(), oc: ocs,
  corte: 9, anio: 2026, diasTranscurridos: 4, fechaExportacion: '2026-10-06', cfg,
});

// --- libro: hoja Cálculo SKU (encabezado fila 2, datos desde la fila 3)
const wb = XLSX.readFile(path.join(dir, 'Presupuesto_Compras_MP_v12.xlsx'));
const ws = wb.Sheets['Cálculo SKU']!;
const cell = (r: number, c: string) => ws[XLSX.utils.encode_cell({ r: r - 1, c: XLSX.utils.decode_col(c) })]?.v as unknown;
const libro = new Map<string, number>();   // sku -> fila
for (let r = 3; r <= 1002; r++) {
  const s = cell(r, 'C');
  if (typeof s === 'string' && s) libro.set(s, r);
}

const NUM: Record<string, string> = {
  costo: 'I', disp: 'J', ent: 'K', ocp: 'M', oca: 'N', esf: 'O', ev: 'P', e1: 'R', e2: 'S', e3: 'T', e4: 'U', e5: 'V',
  c1: 'Z', c2: 'AA', c3: 'AB', c4: 'AC', coefb: 'AI', coef: 'AM', p1: 'AN', p2: 'AO', p3: 'AP', p4: 'AQ', p5: 'AR', pv: 'AT',
  lt: 'AW', ltb: 'AX', cic: 'AY', ss: 'BA', obs: 'BB', mxs: 'BC', idw: 'BD', lm: 'BM', lmb: 'BN',
  rg1: 'BP', ch1: 'BQ', bk1: 'BS', fal1: 'BT', en1: 'BU', r1: 'BV',
  rg2: 'BX', ch2: 'BY', bk2: 'CA', fal2: 'CB', en2: 'CC', r2: 'CD',
  rg3: 'CF', ch3: 'CG', bk3: 'CI', fal3: 'CJ', en3: 'CK', r3: 'CL',
  rg4: 'CN', ch4: 'CO', bk4: 'CQ', fal4: 'CR', en4: 'CS', r4: 'CT',
  rdt: 'DC', o1u: 'DI', o2u: 'DJ', o3u: 'DK', o4u: 'DL', o1: 'DN', o2: 'DO', o3: 'DP', o4: 'DQ',
  em27: 'DW', q27: 'DX', mag: 'DZ', qm: 'EA', o0u: 'DH',
};
const TXT: Record<string, string> = { cat: 'D', lin: 'E', ori: 'G', resp: 'H', met: 'W', drv: 'X', tend: 'AL', abc: 'AV' };

const dif: Record<string, { sku: string; libro: unknown; ts: unknown }[]> = {};
const marca = (k: string, sku: string, a: unknown, b: unknown) => (dif[k] ??= []).push({ sku, libro: a, ts: b });
let sinLibro = 0;
for (const f of res.filas) {
  const r = libro.get(f.sku);
  if (!r) { sinLibro++; continue; }
  const rec = f as unknown as Record<string, unknown>;
  for (const [k, c] of Object.entries(NUM)) {
    const a = num(cell(r, c)), b = rec[k] as number;
    if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b)) + 1e-6) marca(k, f.sku, a, b);
  }
  for (const [k, c] of Object.entries(TXT)) {
    const a = String(cell(r, c) ?? ''), b = String(rec[k] ?? '');
    if (a !== b) marca(k, f.sku, a, b);
  }
}
const totalTs = res.filas.reduce((s, f) => s + f.rdt, 0);
let totalLibro = 0;
for (const r of libro.values()) totalLibro += num(cell(r, 'DC'));
console.log(`SKUs motor: ${res.filas.length} · SKUs libro: ${libro.size} · motor sin fila en libro: ${sinLibro}`);
console.log(`Compra total  libro: ${totalLibro.toFixed(2)}  motor TS: ${totalTs.toFixed(2)}`);
const campos = Object.keys(dif);
if (!campos.length) console.log('DIFERENCIAS POR CAMPO: NINGUNA');
else {
  console.log('DIFERENCIAS POR CAMPO:', JSON.stringify(Object.fromEntries(campos.map((k) => [k, dif[k]!.length]))));
  for (const k of campos.slice(0, 12)) console.log(k, JSON.stringify(dif[k]!.slice(0, 3)));
  process.exitCode = 1;
}

// ============================================================ Desembolsos (hoja "Desembolsos")
const filasDes = (name: string) => hoja('entradas/desembolsos_mp.xlsx', name).slice(5);
const condPago = new Map<string, CondPagoProveedor>();
for (const r of filasDes('1a Cond. pago proveedor')) if (r[0] && r[2] !== null) condPago.set(String(r[0]).trim(), { cond: String(r[2] ?? ''), resumen: String(r[4] ?? '') });
const facturas: FacturaAbierta[] = filasDes('2 Facturas abiertas')
  .filter((r) => r[2] && r[2] !== 'Número')
  .map((r) => ({ proveedor: String(r[0]).trim(), numero: String(r[2]).trim(), moneda: String(r[6] ?? ''), neto: num(r[7]), total: num(r[8]), saldo: num(r[10]), vencimiento: typeof r[11] === 'string' ? r[11] : null }));
const pagos: Pago[] = filasDes('3 Pagos')
  .filter((r) => r[1] && r[1] !== 'Pago')
  .map((r) => ({ fecha: String(r[0]), moneda: String(r[4] ?? ''), importeOriginal: num(r[5]), importeArs: num(r[6]), facturas: String(r[7] ?? '') }));
const impuestos: ImpuestoFactura[] = filasDes('5 Impuestos por factura')
  .filter((r) => r[2] && r[2] !== 'Número')
  .map((r) => ({
    proveedor: String(r[0]).trim(), numero: String(r[2]).trim(), moneda: String(r[5] ?? '').trim(), neto: num(r[7]),
    iva: num(r[8]) + num(r[9]), percepciones: r.slice(10, 24).reduce<number>((s, v) => s + num(v), 0), total: num(r[24]),
  }));
const gastos: GastoImportacion[] = filasDes('6 Gastos de importación')
  .filter((r) => r[1] && r[0] && String(r[0]).startsWith('20'))
  .map((r) => ({ fecha: String(r[0]), tipo: String(r[2] ?? ''), importeArs: num(r[8]) }));

const costos = new Map(res.filas.map((f) => [f.clave, f.costo]));
const dh = hoja('entradas/desembolsos_mp.xlsx', '1a Cond. pago proveedor');   // (solo para asegurar lectura)
void dh;
const dhm = 21, dtr = 4;   // días hábiles del mes en curso y transcurridos (IN_Plan, octubre)
const des = calcularDesembolsos({
  anio: 2026, mesCurso: 10, fechaExportacion: '2026-10-06', fraccionMes1: (dhm - dtr) / dhm,
  filas: res.filas, ocs, ocLineas: res.ocLineas, costos, condPago, facturas, pagos, impuestos, gastos,
  origenProveedor: cfg.origen_proveedor, defaults: cfg.cond_pago_default, tipoCambio: null, mesesGastoPromedio: [7, 8, 9],
});

const libroDes = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Desembolsos']!, { header: 1, raw: true, defval: null });
const chequeos: { ok: boolean; nombre: string; ts: number; libro: number }[] = [];
const chk = (nombre: string, ts: number, lib: unknown) => {
  const b = num(lib);
  chequeos.push({ ok: Math.abs(ts - b) <= 2 + Math.abs(b) * 1e-9, nombre, ts: Math.round(ts), libro: Math.round(b) });
};
// 1. pagado real: filas 6-9 (neto, IVA, percepciones, ... ) y 13 (gastos de importación); columnas B..M = meses 1..12
const filaDe = (r0: number, r1: number, txt: string) => libroDes.slice(r0 - 1, r1).find((r) => r[0] === txt) as unknown[];
['Materia prima (neto)', 'IVA', 'Percepciones', 'Gastos de importación'].forEach((nm, i) => {
  const row = filaDe(6, 15, nm);
  for (let m = 1; m <= 12; m++) chk(`real ${nm} m${m}`, des.real[m]?.[i] ?? 0, row[m]);
});
// 2. proyectado: secciones por título; columnas B..E = meses 1..4
let sec = '';
const got: Record<string, unknown[]> = {};
for (const r of libroDes.slice(19, 40)) {
  const t = String(r[0] ?? '');
  if (!t) continue;
  if (t.startsWith('Facturas')) sec = 'fa';
  else if (t.startsWith('OC emitidas')) sec = 'oc';
  else if (t.startsWith('Compras del')) sec = 'pr';
  else if (t.startsWith('Gastos de importación')) { got.gi = r.slice(1, 5); sec = ''; }
  else if (sec && ['Materia prima (neto)', 'IVA', 'Percepciones'].includes(t.trim())) got[`${sec}|${t.trim()}`] = r.slice(1, 5);
}
const proy: Record<string, number[][]> = { fa: des.facturasAbiertas, oc: des.ocEmitidas, pr: des.compras };
for (const s of ['fa', 'oc', 'pr']) {
  ['Materia prima (neto)', 'IVA', 'Percepciones'].forEach((nm, i) => {
    for (let j = 1; j <= 4; j++) chk(`${s} ${nm} m${j}`, proy[s]![j]![i]!, got[`${s}|${nm}`]![j - 1]);
  });
}
for (let j = 1; j <= 4; j++) chk(`gastos proy m${j}`, des.gastosProyectados[j - 1]!, got.gi![j - 1]);
const fallas = chequeos.filter((c) => !c.ok);
console.log(`\nDESEMBOLSOS: tipo de cambio ${des.tipoCambio} · chequeos ${chequeos.length} · fallas ${fallas.length}`);
for (const f of fallas.slice(0, 20)) console.log('  ', JSON.stringify(f));
if (fallas.length) process.exitCode = 1;

// ============================================================ Control de OC vencidas
const ctl = controlOcVencidas({ fechaExportacion: '2026-10-06', ocs, ocLineas: res.ocLineas, filas: res.filas, costos });
const libroCtl = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Control OC vencidas']!, { header: 1, raw: true, defval: null });
const ctlDif: string[] = [];
const filasLibro = libroCtl.slice(5).filter((r) => r[0] !== '' && r[0] !== null && r[1] !== '');
if (filasLibro.length !== ctl.length) ctlDif.push(`cantidad de filas: libro ${filasLibro.length} · TS ${ctl.length}`);
filasLibro.forEach((r, i) => {
  const t = ctl[i];
  if (!t) return;
  const cmp = (campo: string, a: unknown, b: unknown) => { if (String(a ?? '') !== String(b ?? '')) ctlDif.push(`fila ${i + 1} ${campo}: libro ${a} · TS ${b}`); };
  const cmpN = (campo: string, a: unknown, b: number) => { if (Math.abs(num(a) - b) > 1e-6 * Math.max(1, Math.abs(b)) + 1e-6) ctlDif.push(`fila ${i + 1} ${campo}: libro ${a} · TS ${b}`); };
  cmp('OC', r[1], t.oc); cmp('insumo', r[3], t.insumo); cmp('sugerencia', r[19], t.sugerencia); cmp('OC más nueva', r[17], t.hayOcMasNueva ? 'Sí' : 'No');
  cmpN('días', r[7], t.diasAtraso); cmpN('asignado', r[12], t.asignado); cmpN('valor', r[13], t.valor);
  if (t.coberturaSinOc !== null || r[18] !== '') cmpN('cobertura', r[18], t.coberturaSinOc ?? 0);
});
console.log(`CONTROL OC VENCIDAS: ${ctl.length} filas · diferencias ${ctlDif.length}`);
for (const d of ctlDif.slice(0, 15)) console.log('  ', d);
if (ctlDif.length) process.exitCode = 1;

// ============================================================ Inventario hoy e indicadores (hojas Cálculo SKU ED–FK, Inventario y KPI Gerencia)
const stockRows = hoja('entradas/stock_fin_de_mes.xlsx', 'Stock fin de mes').slice(5).filter((r) => typeof r[1] === 'number');
const historia: HistoriaStock = new Map();
for (const r of stockRows) {
  const nombre = str(r[2]) || str(r[3]);
  const h = historia.get(nombre) ?? { cantidad: Array(13).fill(0) as number[], valor: Array(13).fill(0) as number[] };
  for (let m = 0; m <= 12; m++) { h.cantidad[m]! += num(r[6 + 2 * m]); h.valor[m]! += num(r[7 + 2 * m]); }
  historia.set(nombre, h);
}
const inv = calcularInventario(res.filas, historia, { corte: 9, diasPorSemana: 7 });
const completas: FilaCompleta[] = res.filas.map((f, i) => ({ ...f, ...inv[i]! }));

const INV: Record<string, string> = {
  ed: 'ED', ee: 'EE', ef: 'EF', eg: 'EG', eh: 'EH', ei: 'EI', ej: 'EJ', ek: 'EK', el: 'EL', em: 'EM', en: 'EN', ep: 'EP', eq: 'EQ', er: 'ER', es: 'ES',
  et: 'ET', eu: 'EU', ev: 'EV', fe: 'FE', ff: 'FF', fg: 'FG', fh: 'FH', fi: 'FI', fj: 'FJ',
};
const difInv: Record<string, string[]> = {};
completas.forEach((f) => {
  const r = libro.get(f.sku)!;
  const rec = f as unknown as Record<string, unknown>;
  for (const [k, c] of Object.entries(INV)) {
    const a = num(cell(r, c)), b = typeof rec[k] === 'number' ? (rec[k] as number) : 0;
    if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b)) + 1e-6) (difInv[k] ??= []).push(`${f.sku}: libro ${a} · TS ${b}`);
  }
  const est = String(cell(r, 'EO') ?? ''), grp = String(cell(r, 'FK') ?? '');
  if (est !== f.estado) (difInv.estado ??= []).push(`${f.sku}: libro "${est}" · TS "${f.estado}"`);
  if (grp !== f.grupo) (difInv.grupo ??= []).push(`${f.sku}: libro "${grp}" · TS "${f.grupo}"`);
});
console.log(`\nINVENTARIO HOY por SKU: ${Object.keys(difInv).length ? 'DIFERENCIAS ' + JSON.stringify(Object.fromEntries(Object.entries(difInv).map(([k, v]) => [k, v.length]))) : 'NINGUNA (26 campos × 626 SKUs)'}`);
for (const [k, v] of Object.entries(difInv).slice(0, 6)) console.log('  ', k, v.slice(0, 3));
if (Object.keys(difInv).length) process.exitCode = 1;

// Hoja Inventario: por categoría (filas 10-26), total (28) y por clase ABC (33-36); y KPI Gerencia.
const hInv = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Inventario']!, { header: 1, raw: true, defval: null });
const agr = inventarioPorCategoria(completas);
const difAgr: string[] = [];
const cmpAgr = (nombre: string, libroV: unknown, ts: number | null) => {
  if (libroV === '' || libroV === null) { if (ts !== null && Math.abs(ts) > 1e-9) difAgr.push(`${nombre}: libro vacío · TS ${ts}`); return; }
  if (ts === null || Math.abs(num(libroV) - ts) > 1e-6 * Math.max(1, Math.abs(ts)) + 1e-6) difAgr.push(`${nombre}: libro ${libroV} · TS ${ts}`);
};
const colsCat: [number, keyof (typeof agr.total)][] = [[1, 'valorActual'], [2, 'valorIdeal'], [3, 'variacion'], [4, 'variacionPct'], [5, 'excesoSobreMaximo'], [6, 'sinMovimiento'], [7, 'capitalInmovilizado'], [8, 'pctSinMovimiento'], [9, 'rotacionProvisoria'], [10, 'stockPromedio5'], [11, 'rotacionReal']];
for (const r of hInv.slice(9, 26)) {
  const cat = str(r[0]);
  const t = agr.categorias.find((c) => c.categoria === cat);
  if (!t) { if (cat) difAgr.push(`categoría ${cat} no está en TS`); continue; }
  for (const [ci, k] of colsCat) cmpAgr(`${cat} ${String(k)}`, r[ci], t[k] as number | null);
}
const totRow = hInv[27]!;
for (const [ci, k] of colsCat) cmpAgr(`Total ${String(k)}`, totRow[ci], agr.total[k] as number | null);
const cls = inventarioPorClase(completas);
[...cls.clases, cls.total].forEach((c, i) => {
  const r = hInv[32 + i]!;
  cmpAgr(`clase ${c.clase} bajoSeg`, r[1], c.bajoSeguridad); cmpAgr(`clase ${c.clase} bajoObj`, r[2], c.bajoObjetivo); cmpAgr(`clase ${c.clase} enRango`, r[3], c.enRango);
  cmpAgr(`clase ${c.clase} exceso`, r[4], c.exceso); cmpAgr(`clase ${c.clase} %rango`, r[5], c.pctEnRango); cmpAgr(`clase ${c.clase} valorExceso`, r[6], c.valorExceso);
  cmpAgr(`clase ${c.clase} capital`, r[7], c.capitalInmovilizado); cmpAgr(`clase ${c.clase} objetivo`, r[8], c.objetivoHoy); cmpAgr(`clase ${c.clase} actual`, r[9], c.stockActual);
  cmpAgr(`clase ${c.clase} desvío`, r[10], c.desviacion);
});
const kI = kpisInventario(completas), kC = kpisCompras(completas);
const kg = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['KPI Gerencia']!, { header: 1, raw: true, defval: null });
cmpAgr('KPI N2.2 urgencia', kg[7]![3], kC.pctUrgencia); cmpAgr('KPI capital inmovilizado', kg[9]![3], kI.capitalInmovilizado); cmpAgr('KPI % dentro de política', kg[10]![3], kI.pctDentroPolitica);
cmpAgr('KPI valorización', kg[11]![3], kI.valorizacion); cmpAgr('KPI desviación', kg[12]![3], kI.desviacion.Total ?? null); cmpAgr('KPI rotación real', kg[13]![3], kI.rotacionReal);
cmpAgr('KPI % sin movimiento', kg[14]![3], kI.pctSinMovimiento);
console.log(`AGREGADOS (categorías, clases ABC, KPI Gerencia): ${difAgr.length ? 'DIFERENCIAS ' + difAgr.length : 'NINGUNA'}`);
for (const d of difAgr.slice(0, 10)) console.log('  ', d);
if (difAgr.length) process.exitCode = 1;

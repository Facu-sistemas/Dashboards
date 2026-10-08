// Paridad Odoo vs exportaciones de Compras (fecha 06/10/2026): OC pendientes, condiciones de pago, facturas abiertas,
// pagos, impuestos, gastos de importación, stock de fin de mes y gasto real. Solo lectura.
//
// Uso: node --env-file=.env tests/compras-mp/ejecutar-con-odoo.mjs tests/compras-mp/paridad-fuentes.ts <carpeta_paquete> [AAAA-MM último mes comparable]
//
// Las exportaciones son del 06/10 y Odoo sigue vivo: lo que no puede haber cambiado (pagos y gastos de meses
// cerrados, impuestos de facturas ya publicadas, stock de cierres) tiene que dar IGUAL; lo demás se informa.
import { getFinanzasMp } from '../../src/lib/compras-mp/odoo/finanzas';
import { getGastoRealMp, getOcPendientesMp, getStockFinDeMes } from '../../src/lib/compras-mp/odoo/otros';
import { crearLectores } from './lectores';

const dir = process.argv[2];
if (!dir) throw new Error('Falta la carpeta del paquete');
const ultimoMes = process.argv[3] ?? '2026-09';
const { hoja, num, str } = crearLectores(dir);
const desembolsos = (nombre: string) => hoja('entradas/desembolsos_mp.xlsx', nombre).slice(5);
const cerca = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol + 1e-9 * Math.abs(b);
const por = <T,>(xs: T[], f: (x: T) => string) => { const m = new Map<string, T[]>(); for (const x of xs) m.set(f(x), [...(m.get(f(x)) ?? []), x]); return m; };
function sumaPorMes(items: { mes: string; v: number }[]) { const m = new Map<string, number>(); for (const i of items) m.set(i.mes, (m.get(i.mes) ?? 0) + i.v); return m; }
function comparaMeses(titulo: string, archivo: Map<string, number>, odoo: Map<string, number>) {
  const meses = [...new Set([...archivo.keys(), ...odoo.keys()])].filter((m) => m <= ultimoMes).sort();
  const malos = meses.filter((m) => !cerca(archivo.get(m) ?? 0, odoo.get(m) ?? 0, 1));
  console.log(`  ${titulo}: ${meses.length - malos.length}/${meses.length} meses iguales hasta ${ultimoMes}` + (malos.length ? ` · difieren: ${malos.map((m) => `${m} archivo ${(archivo.get(m) ?? 0).toFixed(2)} · Odoo ${(odoo.get(m) ?? 0).toFixed(2)}`).join(' | ')}` : ''));
}

// ---------------------------------------------------------------- OC pendientes
console.log('OC PENDIENTES');
const oc = await getOcPendientesMp();
const ocArchivo = hoja('entradas/oc_pendientes_mp.xlsx', undefined).filter((r) => typeof r[0] === 'number');
const kOdoo = por(oc, (l) => `${l.orden}|${l.productId}`);
const kArch = por(ocArchivo, (r) => `${str(r[3])}|${r[0]}`);
let igualesOc = 0, distintasOc = 0, soloOdooOc = 0, soloArchOc = 0;
const ejOc: string[] = [];
for (const [k, rows] of kArch) {
  const o = kOdoo.get(k);
  if (!o) { soloArchOc += rows.length; if (ejOc.length < 6) ejOc.push(`solo en archivo (ya recibida/cerrada o cambió): ${k}`); continue; }
  rows.forEach((r, i) => {
    const l = o[i];
    if (!l) { soloArchOc++; return; }
    if (cerca(num(r[9]), l.pendiente, 0.01) && str(r[6]) === l.fechaPrevista) igualesOc++;
    else { distintasOc++; if (ejOc.length < 10) ejOc.push(`${k}: archivo pend ${num(r[9])} fecha ${str(r[6])} · Odoo pend ${l.pendiente} fecha ${l.fechaPrevista}`); }
  });
}
for (const [k, ls] of kOdoo) if (!kArch.has(k)) soloOdooOc += ls.length;
console.log(`  archivo ${ocArchivo.length} líneas · Odoo ${oc.length} · iguales ${igualesOc} · distintas ${distintasOc} · solo en archivo ${soloArchOc} · solo en Odoo ${soloOdooOc}`);
for (const e of ejOc) console.log('   ', e);

// ---------------------------------------------------------------- finanzas
const f = await getFinanzasMp('2026-01-01');
console.log('\nCONDICIONES DE PAGO');
const cpArch = desembolsos('1a Cond. pago proveedor').filter((r) => r[0] && r[2] !== null);
let cpIguales = 0;
const cpMalos: string[] = [];
for (const r of cpArch) {
  const o = f.condPago[str(r[0])];
  if (o && o.cond === str(r[2]) && o.resumen === str(r[4])) cpIguales++;
  else if (cpMalos.length < 6) cpMalos.push(`${str(r[0])}: archivo "${str(r[2])}" / "${str(r[4])}" · Odoo "${o?.cond}" / "${o?.resumen}"`);
}
console.log(`  archivo ${cpArch.length} proveedores · Odoo ${Object.keys(f.condPago).length} · iguales ${cpIguales}`);
for (const e of cpMalos) console.log('   ', e);

console.log('\nPAGOS');
const pagosArch = desembolsos('3 Pagos').filter((r) => r[1] && r[1] !== 'Pago');
comparaMeses('importe ARS por mes', sumaPorMes(pagosArch.map((r) => ({ mes: str(r[0]).slice(0, 7), v: num(r[6]) }))), sumaPorMes(f.pagos.map((p) => ({ mes: p.fecha.slice(0, 7), v: p.importeArs }))));
comparaMeses('cantidad de pagos por mes', sumaPorMes(pagosArch.map((r) => ({ mes: str(r[0]).slice(0, 7), v: 1 }))), sumaPorMes(f.pagos.map((p) => ({ mes: p.fecha.slice(0, 7), v: 1 }))));

console.log('\nGASTOS DE IMPORTACIÓN');
const gArch = desembolsos('6 Gastos de importación').filter((r) => r[1] && r[0] && String(r[0]).startsWith('20'));
comparaMeses('importe ARS por mes', sumaPorMes(gArch.map((r) => ({ mes: str(r[0]).slice(0, 7), v: num(r[8]) }))), sumaPorMes(f.gastos.map((g) => ({ mes: g.fecha.slice(0, 7), v: g.importeArs }))));

console.log('\nIMPUESTOS POR FACTURA');
const impArch = desembolsos('5 Impuestos por factura').filter((r) => r[2] && r[2] !== 'Número');
const impOdoo = new Map(f.impuestos.map((i) => [i.numero, i]));
let impIguales = 0, impDif = 0, impFalta = 0;
const impEj: string[] = [];
for (const r of impArch) {
  const o = impOdoo.get(str(r[2]));
  if (!o) { impFalta++; continue; }
  const iva = num(r[8]) + num(r[9]), perc = r.slice(10, 24).reduce<number>((s, v) => s + num(v), 0);
  if (cerca(o.neto, num(r[7])) && cerca(o.iva, iva) && cerca(o.percepciones, perc) && cerca(o.total, num(r[24]))) impIguales++;
  else { impDif++; if (impEj.length < 5) impEj.push(`${str(r[2])}: archivo neto ${num(r[7])} iva ${iva} perc ${perc} total ${num(r[24])} · Odoo neto ${o.neto} iva ${o.iva} perc ${o.percepciones} total ${o.total}`); }
}
console.log(`  archivo ${impArch.length} comprobantes · Odoo ${f.impuestos.length} · iguales ${impIguales} · distintos ${impDif} · no están en Odoo ${impFalta}`);
for (const e of impEj) console.log('   ', e);

console.log('\nFACTURAS ABIERTAS (cambian con los pagos de los últimos días)');
const faArch = desembolsos('2 Facturas abiertas').filter((r) => r[2] && r[2] !== 'Número');
const faOdoo = por(f.facturas, (x) => `${x.numero}|${x.vencimiento ?? ''}`);
let faIg = 0, faDif = 0, faSoloArch = 0;
for (const r of faArch) {
  const o = faOdoo.get(`${str(r[2])}|${str(r[11])}`)?.[0];
  if (!o) faSoloArch++; else if (cerca(o.saldo, num(r[10]))) faIg++; else faDif++;
}
const saldo = (xs: { saldo: number; moneda: string }[]) => xs.reduce((s, x) => s + x.saldo * (x.moneda === 'USD' ? 1 : 1), 0);
console.log(`  archivo ${faArch.length} vencimientos · Odoo ${f.facturas.length} · iguales ${faIg} · saldo distinto ${faDif} · ya no abiertas ${faSoloArch} · saldo total archivo ${faArch.reduce((s, r) => s + num(r[10]), 0).toFixed(2)} · Odoo ${saldo(f.facturas).toFixed(2)}`);

// ---------------------------------------------------------------- stock de fin de mes
console.log('\nSTOCK DE FIN DE MES');
const st = await getStockFinDeMes();
const stArchRows = hoja('entradas/stock_fin_de_mes.xlsx', 'Stock fin de mes').slice(5).filter((r) => typeof r[1] === 'number');
const hdr = hoja('entradas/stock_fin_de_mes.xlsx', 'Stock fin de mes')[4] as unknown[];
const stOdoo = new Map(st.productos.map((p) => [p.productId, p]));
st.cortes.forEach((corte, i) => {
  const col = hdr.indexOf(`${corte} - Cant.`);
  if (col < 0) { console.log(`  ${corte}: no está en el archivo`); return; }
  let ig = 0, dif = 0, falta = 0;
  for (const r of stArchRows) {
    const o = stOdoo.get(r[1] as number);
    if (!o) { falta++; continue; }
    const c = o.cortes[i];
    if (c && cerca(c.cantidad, num(r[col]), 0.011) && cerca(c.valor, num(r[col + 1]), 1)) ig++; else dif++;
  }
  console.log(`  ${corte}: iguales ${ig} · distintos ${dif} · producto no está en Odoo ${falta}`);
});

// ---------------------------------------------------------------- gasto real
console.log('\nGASTO REAL (líneas de factura)');
const gr = await getGastoRealMp();
const grArch = hoja('entradas/gasto_real_mp.xlsx', 'Gasto real MP').slice(5).filter((r) => typeof r[1] === 'number');
comparaMeses('importe por mes', sumaPorMes(grArch.map((r) => ({ mes: str(r[4]).slice(0, 7), v: num(r[6]) }))), sumaPorMes(gr.map((l) => ({ mes: l.fecha.slice(0, 7), v: l.importe }))));
comparaMeses('cantidad de líneas por mes', sumaPorMes(grArch.map((r) => ({ mes: str(r[4]).slice(0, 7), v: 1 }))), sumaPorMes(gr.map((l) => ({ mes: l.fecha.slice(0, 7), v: 1 }))));

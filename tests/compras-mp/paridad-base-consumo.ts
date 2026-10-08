// Paridad Odoo vs exportaciones de Compras: base de productos y consumo mensual. Solo lectura.
//
// Uso: node --env-file=.env tests/compras-mp/ejecutar-con-odoo.mjs tests/compras-mp/paridad-base-consumo.ts <carpeta_paquete>
//
// Consumo: los meses CERRADOS tienen que dar igual producto por producto (esa es la prueba crítica).
// Base: las existencias cambian con los días, así que se compara el universo de productos, categorías, proveedor y costo.
import { getBaseMp } from '../../src/lib/compras-mp/odoo/base';
import { getConsumoMensual, etiquetaMes } from '../../src/lib/compras-mp/odoo/consumo';
import { crearLectores } from './lectores';

const dir = process.argv[2];
if (!dir) throw new Error('Falta la carpeta del paquete');
const { leerBase, leerConsumo } = crearLectores(dir);

// ---------------------------------------------------------------- consumo
const c = await getConsumoMensual('2025-05-01');
const archivo = leerConsumo();
const porNombreOdoo = new Map<string, number[]>();
for (const f of c.filas) {
  const prev = porNombreOdoo.get(f.sku) ?? c.meses.map(() => 0);
  f.vals.forEach((v, i) => (prev[i] = (prev[i] ?? 0) + v));
  porNombreOdoo.set(f.sku, prev);
}
const cerrados = c.meses.filter((m) => m <= '2026-09');
let totalIguales = 0, totalDif = 0;
const peores: string[] = [];
for (const mes of cerrados) {
  const ci = archivo.headers.indexOf(etiquetaMes(mes));
  const mi = c.meses.indexOf(mes);
  if (ci < 0) { console.log(`${mes}: el archivo no trae este mes`); continue; }
  const libro = new Map<string, number>();
  for (const f of archivo.filas) {
    const v = f.vals[ci];
    if (f.nombre && typeof v === 'number' && v) libro.set(f.nombre, (libro.get(f.nombre) ?? 0) + v);
  }
  let iguales = 0, difieren = 0, soloArchivo = 0, soloOdoo = 0;
  for (const [n, v] of libro) {
    const o = porNombreOdoo.get(n)?.[mi];
    if (o === undefined) { soloArchivo++; if (n !== 'TORNILLO TANQUE 1/4X7/8') peores.push(`${mes} solo en archivo: ${n} (${v})`); }
    else if (Math.abs(o - v) <= 0.011 + 1e-6 * Math.abs(v)) iguales++;
    else { difieren++; peores.push(`${mes} ${n}: archivo ${v} · Odoo ${o.toFixed(2)}`); }
  }
  for (const [n, vals] of porNombreOdoo) if ((vals[mi] ?? 0) && !libro.has(n)) soloOdoo++;
  totalIguales += iguales; totalDif += difieren;
  console.log(`${etiquetaMes(mes).padEnd(16)} iguales ${String(iguales).padStart(3)} · difieren ${String(difieren).padStart(2)} · solo en archivo ${soloArchivo} · solo en Odoo ${soloOdoo}`);
}
console.log(`CONSUMO meses cerrados: ${totalIguales} producto-mes iguales, ${totalDif} con diferencia`);
for (const p of peores) console.log('  ', p);

// ---------------------------------------------------------------- base
const b = await getBaseMp();
const archivoBase = leerBase();
const odoo = new Map(b.productos.map((p) => [p.sku, p]));
const enArchivo = new Set(archivoBase.map((r) => r.sku));
const faltanEnOdoo = archivoBase.filter((r) => !odoo.has(r.sku)).map((r) => r.sku);
const sobranEnOdoo = b.productos.filter((p) => !enArchivo.has(p.sku));
let catDif = 0, provDif = 0, costoDif = 0, nProv = 0;
const ej: string[] = [];
for (const r of archivoBase) {
  const p = odoo.get(r.sku);
  if (!p) continue;
  if (p.categoria !== r.categoria) { catDif++; if (ej.length < 6) ej.push(`categoría ${r.sku}: archivo "${r.categoria}" · Odoo "${p.categoria}"`); }
  if ((p.proveedores[0] ?? '') !== r.prov) { provDif++; if (ej.length < 12) ej.push(`1° proveedor ${r.sku}: archivo "${r.prov}" · Odoo "${p.proveedores[0] ?? ''}"`); }
  if (JSON.stringify(p.proveedores) === JSON.stringify(r.proveedores)) nProv++;
  if (Math.abs(p.costo - r.costo) > 0.01) costoDif++;
}
console.log(`\nBASE: archivo ${archivoBase.length} productos · Odoo ${b.productos.length} (archivados con stock: ${b.productos.filter((p) => !p.activo).length})`);
console.log(`  en archivo y no en Odoo: ${faltanEnOdoo.length}`, faltanEnOdoo.slice(0, 8));
console.log(`  en Odoo y no en archivo: ${sobranEnOdoo.length}`, sobranEnOdoo.slice(0, 8).map((p) => `${p.sku}${p.activo ? '' : ' (archivado)'}`));
console.log(`  categoría distinta: ${catDif} · 1° proveedor distinto: ${provDif} · lista de proveedores idéntica: ${nProv}/${archivoBase.length} · costo distinto: ${costoDif}`);
console.log(`  nombres repetidos entre productos de Odoo: ${b.nombresDuplicados.length}`, b.nombresDuplicados.slice(0, 5));
for (const e of ej) console.log('  ', e);

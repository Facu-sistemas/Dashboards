// Prueba del cálculo de cumplimiento (Seguimiento) con un caso armado a mano.
// Uso: node tests/compras-mp/seguimiento.ts
import assert from 'node:assert/strict';
import { calcularSeguimiento } from '../../src/lib/compras-mp/seguimiento.ts';
import type { FilaVersion } from '../../src/lib/compras-mp/versiones.ts';

const cierre = (cantidad: number[]) => ({ cantidad, valor: cantidad.map(() => 0) });
const idx = (porMes: Record<number, number>) => Array.from({ length: 13 }, (_, i) => porMes[i] ?? 0);

// Versión aprobada: septiembre (cerrado) y octubre (abierto). Producto 1 se presupuestó a $100 la unidad.
const filasVersion: FilaVersion[] = [
  { productId: 1, sku: 'INSUMO 1', cat: 'Madera', mes: '2026-09', costo: 100, llegadaU: 10, llegadaArs: 1000, emitirU: 0, emitirArs: 0, consumoProyU: 18 },
  { productId: 1, sku: 'INSUMO 1', cat: 'Madera', mes: '2026-10', costo: 100, llegadaU: 10, llegadaArs: 1000, emitirU: 0, emitirArs: 0, consumoProyU: 20 },
];
const r = calcularSeguimiento({
  filasVersion, horizonte: ['2026-09', '2026-10'], corte: '2026-09', anioStock: 2026, cierresDeStock: 10,
  // Insumo 1: stock fin agosto (índice 8) = 50, fin septiembre (9) = 55. Insumo 2 (no estaba en la versión): 5 y 5.
  stock: new Map([[1, cierre(idx({ 8: 50, 9: 55 }))], [2, cierre(idx({ 8: 5, 9: 5 }))]]),
  consumo: new Map([[1, new Map([['2026-09', 20]])], [2, new Map([['2026-09', 3]])]]),
  catalogo: new Map([[1, { sku: 'INSUMO 1', cat: 'Madera', abc: 'A', costoActual: 150 }], [2, { sku: 'INSUMO 2', cat: 'Nylon', abc: 'C', costoActual: 10 }]]),
});

// Llegadas reales de septiembre del insumo 1 = 55 − 50 + 20 = 25 u × $100 (costo presupuestado, no el de hoy) = $2.500.
const f1 = r.filas.find((f) => f.productId === 1)!;
assert.equal(f1.realU, 25);
assert.equal(f1.real, 2500);
assert.equal(f1.aprobadoCerrado, 1000);
assert.equal(f1.cumplimiento, 2.5);
assert.equal(f1.desvio, 1500);
// Octubre sigue abierto: no cuenta ni en lo aprobado ni en lo real de los meses cerrados.
assert.deepEqual(r.meses.map((m) => m.cerrado), [true, false]);
assert.equal(f1.realMes[1], 0);
// El insumo 2 no tenía presupuesto: sus llegadas reales (5 − 5 + 3 = 3 u × $10 de hoy) suman al real.
const f2 = r.filas.find((f) => f.productId === 2)!;
assert.equal(f2.real, 30);
assert.equal(f2.aprobadoCerrado, 0);
assert.equal(f2.cumplimiento, null);
assert.equal(r.total.aprobadoCerrado, 1000);
assert.equal(r.total.real, 2530);
assert.equal(r.total.cumplimiento, 2.53);
// Precisión del pronóstico de septiembre: proyectado 18 u × $100 = 1.800 contra real 20 u × $100 = 2.000 → −10 %.
assert.equal(r.precision.mes, '2026-09');
const mad = r.precision.porCategoria.find((c) => c.categoria === 'Madera')!;
assert.equal(mad.pronostico, 1800);
assert.equal(mad.consumoReal, 2000);
assert.ok(Math.abs((mad.errorPct ?? 0) + 0.1) < 1e-9);

// Un mes sin stock de fin de mes cargado no se considera cerrado aunque ya haya pasado.
const sinStock = calcularSeguimiento({
  filasVersion, horizonte: ['2026-09', '2026-10'], corte: '2026-09', anioStock: 2026, cierresDeStock: 9,
  stock: new Map([[1, cierre(idx({ 8: 50 }))]]), consumo: new Map(), catalogo: new Map(),
});
assert.deepEqual(sinStock.meses.map((m) => m.cerrado), [false, false]);
assert.equal(sinStock.total.cumplimiento, null);
console.log('Seguimiento: todas las comprobaciones pasaron');

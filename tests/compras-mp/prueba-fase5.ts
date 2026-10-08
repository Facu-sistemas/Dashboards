// Prueba de la Fase 5 contra Supabase y Odoo reales (solo lectura sobre Odoo).
// Las tablas inmutables (versiones, cierres, decisiones) NO se pueblan: sus inserciones se prueban con claves falsas, que la base rechaza
// después de validar las columnas. La edición de configuración sí se aplica y se revierte (queda en la auditoría como usuario "prueba-fase-5").
//
// Uso: node --env-file=.env tests/compras-mp/ejecutar-con-odoo.mjs tests/compras-mp/prueba-fase5.ts
import { aplicarCambio, EdicionError, leerConfigEditable } from '../../src/lib/compras-mp/edicion';
import { recalcularUltima } from '../../src/lib/compras-mp/corrida';
import { construirReposicion, aCsvOdoo } from '../../src/lib/compras-mp/reposicion';
import { leerFilas, resolverCorrida } from '../../src/lib/compras-mp/lectura';
import { construirSeguimiento } from '../../src/lib/compras-mp/seguimiento-datos';
import { registrarDecisionOc, DecisionError } from '../../src/lib/compras-mp/decisiones-oc';
import { getSupabaseAdminClient } from '../../src/lib/supabase/admin';
import { cargarConfig } from '../../src/lib/compras-mp/config';

const supabase = getSupabaseAdminClient();
const FALSO = '00000000-0000-0000-0000-000000000000';
let fallas = 0;
const ok = (cond: boolean, texto: string) => { console.log(`  ${cond ? 'OK   ' : 'FALLA'} ${texto}`); if (!cond) fallas++; };
const corridasCreadas: string[] = [];

console.log('1) Columnas de las tablas inmutables (se insertan con claves falsas; tiene que fallar por la clave, no por las columnas)');
const intentos: [string, string, Record<string, unknown>][] = [
  ['version_presupuesto', '23503', { nombre: 'x', horizonte: ['2026-10'], corrida_id: FALSO, aprobada_por: 'prueba', total_compra: 1, params: {}, vigente: false }],
  ['version_sku_mes', '23503', { version_id: FALSO, product_id: 1, mes: '2026-10', datos: {} }],
  ['version_desembolso', '23503', { version_id: FALSO, mes: '2026-10', tipo: 'proyectado', concepto: 'x', valor: 1 }],
  ['cierre_mensual', '23503', { mes: '2026-09', revision: 1, indicadores: {}, fecha_datos: '2026-10-08', corrida_id: FALSO, usuario: 'prueba' }],
  ['oc_decisiones', '23514', { oc_id: 1, product_id: 1, decision: 'INVALIDA', nueva_fecha: null, comentario: null, usuario: 'prueba' }],
];
for (const [tabla, codigo, fila] of intentos) {
  const { error } = await supabase.from(tabla).insert(fila);
  ok(error?.code === codigo, `${tabla}: ${error ? `${error.code} ${error.message.slice(0, 70)}` : 'se insertó (!)'}`);
}

console.log('2) Validaciones de la edición');
const rechaza = async (nombre: string, f: () => Promise<void>) => {
  try { await f(); ok(false, `${nombre}: no fue rechazado`); } catch (e) { ok(e instanceof EdicionError || e instanceof DecisionError, `${nombre}: ${e instanceof Error ? e.message.slice(0, 90) : e}`); }
};
await rechaza('parámetro que no existe', () => aplicarCambio({ tipo: 'parametro', clave: 'no_existe', valor: 1 }, 'prueba-fase-5'));
await rechaza('porcentaje fuera de rango', () => aplicarCambio({ tipo: 'parametro', clave: 'sommier_pct_ventas', valor: 5 }, 'prueba-fase-5'));
await rechaza('umbral A mayor que B', () => aplicarCambio({ tipo: 'parametro', clave: 'umbral_A', valor: 0.99 }, 'prueba-fase-5'));
await rechaza('línea de categoría inválida', () => aplicarCambio({ tipo: 'regla', regla: 'linea_categoria', clave: 'Madera', valor: 'Otra' }, 'prueba-fase-5'));
await rechaza('plan con mes 13', () => aplicarCambio({ tipo: 'plan', anio: 2026, mes: 13, concepto: 'dias_habiles', valor: 20 }, 'prueba-fase-5'));
await rechaza('reprogramada sin fecha', () => registrarDecisionOc({ ocId: 1, productId: 1, decision: 'Reprogramada', usuario: 'prueba-fase-5' }).then(() => undefined));

console.log('3) Cambio de configuración → recalculo → reversión');
const base = await resolverCorrida();
ok(!!base, `hay una corrida base (${base?.id.slice(0, 8)}, ${base?.resumen?.skus} SKUs)`);
const tcAntes = base!.resumen!.tipoCambio;
await aplicarCambio({ tipo: 'parametro', clave: 'tipo_cambio_manual', valor: 1515 }, 'prueba-fase-5');
const r1 = await recalcularUltima({ disparadaPor: 'prueba-fase-5' });
corridasCreadas.push(r1.corridaId);
ok(r1.tipoCambio === 1515, `el recálculo usa el tipo de cambio manual (${r1.tipoCambio}); antes ${tcAntes}`);
ok(Math.abs(r1.totalCompra - base!.resumen!.totalCompra) < 1, `la compra no cambia por el tipo de cambio (${Math.round(r1.totalCompra)})`);
await aplicarCambio({ tipo: 'parametro', clave: 'tipo_cambio_manual', valor: null }, 'prueba-fase-5');
const r2 = await recalcularUltima({ disparadaPor: 'prueba-fase-5' });
corridasCreadas.push(r2.corridaId);
ok(Math.abs(r2.tipoCambio - tcAntes) < 1e-6, `al borrar el manual vuelve la cotización de Odoo (${r2.tipoCambio})`);
const conf = await leerConfigEditable(2026);
const aud = conf.auditoria.filter((a) => a.usuario === 'prueba-fase-5' && a.clave === 'tipo_cambio_manual');
ok(aud.length >= 2, `quedaron ${aud.length} registros de auditoría con valor anterior y nuevo (último: ${JSON.stringify(aud[0]?.anterior)} → ${JSON.stringify(aud[0]?.nuevo)})`);
ok(conf.excepciones.length === 72, `${conf.excepciones.length} excepciones cargadas · ${Object.values(conf.reglas).reduce((s, x) => s + x.length, 0)} reglas · plan ${conf.plan.anio}`);

console.log('4) Reglas de reabastecimiento (lectura de Odoo)');
const filas = await leerFilas(base!.id);
const { extras } = await cargarConfig();
const rep = await construirReposicion(filas, extras.ubicacionReposicion);
const llevan = rep.filas.filter((f) => f.lleva);
ok(rep.filas.length === filas.length, `${rep.filas.length} insumos, ${llevan.length} llevan regla, ${rep.filas.filter((f) => f.existe).length} ya existen en Odoo`);
ok(llevan.every((f) => f.min <= f.max && f.min > 0), 'todos los mínimos son > 0 y no superan al máximo');
ok(rep.filas.filter((f) => f.ori === 'China').every((f) => f.trigger === 'manual'), 'China usa disparador manual');
console.log(`     ubicación "${rep.ubicacion}" · advertencias: ${rep.advertencias.length ? rep.advertencias.join(' | ').slice(0, 300) : 'ninguna'}`);
console.log('     ' + aCsvOdoo(rep).split('\r\n').slice(0, 3).join(' ⏎ '));

console.log('5) Seguimiento sin versión aprobada');
const seg = await construirSeguimiento(base!, filas);
ok(seg === null, 'sin versión aprobada no hay cumplimiento que medir (devuelve vacío)');

if (corridasCreadas.length) {
  const { error } = await supabase.from('compras_corridas').delete().in('id', corridasCreadas);
  console.log(error ? `No se pudieron borrar las corridas de prueba: ${error.message}` : `Corridas de prueba borradas (${corridasCreadas.length})`);
}
console.log(fallas ? `\n${fallas} FALLAS` : '\nFase 5: todas las comprobaciones pasaron');
if (fallas) process.exitCode = 1;

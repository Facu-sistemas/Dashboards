// Prueba de la Fase 3: corrida completa (Odoo solo lectura → cálculo → Supabase), lectura de lo guardado y recálculo sin Odoo.
//
// Uso: node --env-file=.env tests/compras-mp/ejecutar-con-odoo.mjs tests/compras-mp/prueba-corrida.ts [--conservar]
//   Por defecto borra las corridas de prueba al terminar (las tablas son propias del módulo, no de Odoo).
import { ejecutarCorrida, recalcularDesdeCorrida, ultimaCorrida } from '../../src/lib/compras-mp/corrida';
import { getSupabaseAdminClient } from '../../src/lib/supabase/admin';

const conservar = process.argv.includes('--conservar');
const supabase = getSupabaseAdminClient();
const ids: string[] = [];
const cuenta = async (tabla: string, id: string) => {
  const { count, error } = await supabase.from(tabla).select('*', { count: 'exact', head: true }).eq('corrida_id', id);
  if (error) throw new Error(`${tabla}: ${error.message}`);
  return count ?? 0;
};
const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;

try {
  console.log('1) Corrida completa…');
  const r = await ejecutarCorrida({ origen: 'manual', disparadaPor: 'prueba-fase-3' });
  ids.push(r.corridaId);
  console.log(`   listo en ${(r.duracionMs / 1000).toFixed(1)} s · ${r.skus} SKUs · compra total ${pesos(r.totalCompra)} · corte ${r.corte} · horizonte ${r.horizonte.join(', ')}`);
  console.log(`   por mes: ${r.compraPorMes.map(pesos).join(' · ')}`);
  console.log(`   por origen: ${Object.entries(r.compraPorOrigen).map(([k, v]) => `${k} ${pesos(v)}`).join(' · ')}`);
  console.log(`   OC vencidas: ${r.ocVencidas.lineas} líneas ${pesos(r.ocVencidas.valor)} · tipo de cambio ${r.tipoCambio} · controles: ${r.estadoControles}`);
  console.log(`   desembolso proyectado: ${r.desembolsoProyectado.map((d) => `${d.mes} ${pesos(d.total)}`).join(' · ')}`);

  console.log('2) Lo guardado');
  for (const t of ['raw_compras', 'calc_sku', 'calc_sku_mes', 'calc_desembolsos', 'calc_control_oc']) console.log(`   ${t.padEnd(18)} ${await cuenta(t, r.corridaId)} filas`);
  const u = await ultimaCorrida(true);
  console.log(`   última corrida leída: ${u?.id === r.corridaId ? 'es la recién creada' : 'DISTINTA'} · estado ${u?.estado} · ${u?.controles.length} controles`);
  const estados = new Map<string, number>();
  for (const c of u?.controles ?? []) estados.set(c.estado, (estados.get(c.estado) ?? 0) + 1);
  console.log(`   controles por estado: ${[...estados].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  for (const c of (u?.controles ?? []).filter((x) => x.estado === 'REVISAR' || x.estado === 'AVISO')) {
    console.log(`   [${c.estado}] ${c.nombre}: ${c.valor}${c.detalle ? `  (${c.detalle.slice(0, 3).join('; ')})` : ''}`);
  }

  console.log('3) Recálculo desde las fotos guardadas (sin Odoo)');
  const r2 = await recalcularDesdeCorrida(r.corridaId, { disparadaPor: 'prueba-fase-3' });
  ids.push(r2.corridaId);
  console.log(`   listo en ${(r2.duracionMs / 1000).toFixed(1)} s · compra total ${pesos(r2.totalCompra)} · ${Math.abs(r2.totalCompra - r.totalCompra) < 0.01 ? 'IGUAL a la corrida original' : 'DIFERENTE a la original'}`);

  console.log('4) Una segunda corrida simultánea tiene que ser rechazada');
  const { data: abierta, error: eAbrir } = await supabase.from('compras_corridas').insert({ origen: 'manual', fecha_datos: r.fechaDatos, disparada_por: 'prueba-fase-3' }).select('id').single();
  if (eAbrir || !abierta) throw new Error(eAbrir?.message ?? 'no se pudo abrir');
  ids.push(abierta.id as string);
  try {
    await ejecutarCorrida({ origen: 'manual', disparadaPor: 'prueba-fase-3' });
    console.log('   ERROR: aceptó dos corridas a la vez');
  } catch (e) {
    console.log(`   rechazada como corresponde: ${e instanceof Error ? e.message : e}`);
  }
} finally {
  if (!conservar && ids.length) {
    const { error } = await supabase.from('compras_corridas').delete().in('id', ids);
    console.log(error ? `No se pudieron borrar las corridas de prueba: ${error.message}` : `Corridas de prueba borradas (${ids.length})`);
  }
}

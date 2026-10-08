// Prueba de la limpieza de corridas viejas con corridas falsas (se crean y se borran dentro de la prueba).
// Uso: node --env-file=.env tests/compras-mp/ejecutar-con-odoo.mjs tests/compras-mp/prueba-retencion.ts
import { limpiarCorridasViejas } from '../../src/lib/compras-mp/retencion';
import { getSupabaseAdminClient } from '../../src/lib/supabase/admin';

const sup = getSupabaseAdminClient();
const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
let fallas = 0;
const ok = (c: boolean, t: string) => { console.log(`  ${c ? 'OK   ' : 'FALLA'} ${t}`); if (!c) fallas++; };

const antes = (await sup.from('compras_corridas').select('id')).data?.map((r) => r.id as string) ?? [];
const fecha = '2026-01-01';
const crear = async (nombre: string, creada: string, params: Record<string, unknown> = {}) => {
  const { data, error } = await sup.from('compras_corridas').insert({ origen: 'manual', disparada_por: `retencion-${nombre}`, fecha_datos: fecha, estado: 'ok', creada_en: creada, params }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
};
// 8 corridas viejas (30 a 37 días); la más vieja es el origen de una recalculada reciente.
const viejas: string[] = [];
for (let i = 0; i < 8; i++) viejas.push(await crear(`vieja${i}`, dias(30 + i)));
const derivada = await crear('derivada-reciente', dias(0.01), { recalculoDe: viejas[7] });
const creadas = [...viejas, derivada];

try {
  const sim = await limpiarCorridasViejas({ simular: true });
  ok(sim.borradas === 0, 'en simulación no borra nada');
  const noBorrar = (id: string) => !sim.aBorrar.includes(id);
  ok(noBorrar(derivada), 'la corrida reciente se conserva');
  ok(noBorrar(viejas[7]!), 'el origen (fotos crudas) de la reciente se conserva aunque sea de hace 37 días');
  ok(sim.aBorrar.includes(viejas[6]!) && sim.aBorrar.includes(viejas[5]!), 'las viejas que nadie necesita se borrarían');
  ok(antes.every((id) => noBorrar(id)), `las ${antes.length} corridas previas (reales) no se tocan`);

  const real = await limpiarCorridasViejas();
  const restantes = new Set((await sup.from('compras_corridas').select('id')).data?.map((r) => r.id as string));
  ok(real.borradas === sim.aBorrar.length, `borró ${real.borradas} corridas`);
  ok(restantes.has(derivada) && restantes.has(viejas[7]!), 'quedaron la reciente y su origen');
  ok(!restantes.has(viejas[6]!), 'se fue una vieja innecesaria');
  ok(antes.every((id) => restantes.has(id)), 'las corridas reales siguen');
} finally {
  const { error } = await sup.from('compras_corridas').delete().in('id', creadas);
  console.log(error ? `No se pudieron borrar las corridas de prueba: ${error.message}` : 'Corridas de prueba borradas');
}
console.log(fallas ? `\n${fallas} FALLAS` : '\nLimpieza: todas las comprobaciones pasaron');
if (fallas) process.exitCode = 1;

// Prueba de punta a punta de la Fase 2: Odoo (solo lectura) → instantánea → motor → fotos crudas en Supabase.
//
// Uso: node --env-file=.env tests/compras-mp/ejecutar-con-odoo.mjs tests/compras-mp/prueba-instantanea.ts <carpeta_paquete> [--guardar]
//   Sin --guardar no escribe nada. Con --guardar abre una corrida de prueba en Supabase, guarda las fotos, las lee de vuelta
//   para comprobar el hash y borra la corrida de prueba (las tablas son propias del módulo, no de Odoo).
import cfgJson from '../../src/lib/compras-mp/config-default.json';
import { calcular, type Config } from '../../src/lib/compras-mp/motor';
import { aBaseRows } from '../../src/lib/compras-mp/odoo/base';
import { aConsumoTabla } from '../../src/lib/compras-mp/odoo/consumo';
import { aOcLineas } from '../../src/lib/compras-mp/odoo/otros';
import { abrirCorrida, fotosRaw, guardarRaw, hashDatos, tomarInstantanea } from '../../src/lib/compras-mp/odoo/instantanea';
import { calcularDesembolsos } from '../../src/lib/compras-mp/desembolsos';
import { controlOcVencidas } from '../../src/lib/compras-mp/control-oc';
import { getSupabaseAdminClient } from '../../src/lib/supabase/admin';
import { crearLectores } from './lectores';

const dir = process.argv[2];
if (!dir) throw new Error('Falta la carpeta del paquete');
const guardar = process.argv.includes('--guardar');
const cfg = cfgJson as unknown as Config;

let t0 = Date.now();
const snap = await tomarInstantanea();
console.log(`Instantánea de Odoo a ${snap.fechaDatos}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const f of fotosRaw(snap)) console.log(`  ${f.fuente.padEnd(26)} ${String(f.filas).padStart(6)} filas  ${hashDatos(f.datos).slice(0, 12)}`);
console.log(`  tipo de cambio USD: ${snap.tipoCambio ? `${snap.tipoCambio.pesos} (${snap.tipoCambio.fecha})` : 'sin cotización'}`);
console.log(`  recepciones sin facturar: ${snap.recepcionesSinFacturar.length} líneas · ${snap.recepcionesSinFacturar.reduce((s, r) => s + r.monto, 0).toFixed(0)} (en la moneda de cada orden)`);
if (snap.base.nombresDuplicados.length) console.log(`  AVISO nombres repetidos en la base: ${snap.base.nombresDuplicados.join(' | ')}`);

// El plan no está en Odoo: para esta prueba se usa el IN_Plan de la exportación (después vive en cfg_plan).
const { leerPlan } = crearLectores(dir);
const plan = leerPlan();
const base = aBaseRows(snap.base);
const nombrePorId = new Map(snap.base.productos.map((p) => [p.productId, p.sku]));
const oc = aOcLineas(snap.oc, nombrePorId);
const diasHab = plan.diasHabiles[8 + 1] ?? 21;   // octubre
t0 = Date.now();
const res = calcular({
  base, consumo: aConsumoTabla(snap.consumo), plan, oc, corte: 9, anio: 2026,
  diasTranscurridos: 4 + 2,   // la prueba corre dos días después de la exportación de referencia
  fechaExportacion: snap.fechaDatos, cfg,
});
console.log(`\nMotor con datos de Odoo: ${res.filas.length} SKUs, compra total $${res.filas.reduce((s, f) => s + f.rdt, 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })} (${Date.now() - t0} ms)`);
const ocSinProducto = oc.filter((l) => !res.filas.some((f) => f.productId === l.productId)).length;
console.log(`  líneas de OC que no encuentran su producto en la base: ${ocSinProducto}`);

const costos = new Map(res.filas.map((f) => [f.clave, f.costo]));
const des = calcularDesembolsos({
  anio: 2026, mesCurso: 10, fechaExportacion: snap.fechaDatos, fraccionMes1: Math.max(0, diasHab - 6) / diasHab,
  filas: res.filas, ocs: oc, ocLineas: res.ocLineas, costos, condPago: new Map(Object.entries(snap.finanzas.condPago)),
  facturas: snap.finanzas.facturas, pagos: snap.finanzas.pagos, impuestos: snap.finanzas.impuestos, gastos: snap.finanzas.gastos,
  origenProveedor: cfg.origen_proveedor, defaults: cfg.cond_pago_default, tipoCambio: snap.tipoCambio?.pesos ?? null, mesesGastoPromedio: [7, 8, 9],
});
const sum3 = (xs: number[][]) => xs.slice(1, 5).map((t) => Math.round(t.reduce((s, v) => s + v, 0) / 1e6));
console.log(`Desembolsos proyectados (M$ por mes 1-4): facturas ${sum3(des.facturasAbiertas)} · OC ${sum3(des.ocEmitidas)} · compras ${sum3(des.compras)} · tipo de cambio usado ${des.tipoCambio}`);
const ctl = controlOcVencidas({ fechaExportacion: snap.fechaDatos, ocs: oc, ocLineas: res.ocLineas, filas: res.filas, costos });
console.log(`Control de OC vencidas: ${ctl.length} líneas, $${ctl.reduce((s, c) => s + c.valor, 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`);

if (guardar) {
  const id = await abrirCorrida('manual', snap.fechaDatos, 'prueba-fase-2');
  try {
    const guardado = await guardarRaw(id, snap);
    const { data, error } = await getSupabaseAdminClient().from('raw_compras').select('fuente, hash, filas, datos').eq('corrida_id', id);
    if (error) throw new Error(error.message);
    let ok = 0;
    for (const g of guardado) {
      const r = data?.find((x) => x.fuente === g.fuente);
      if (r && r.hash === g.hash && r.filas === g.filas && hashDatos(r.datos) === g.hash) ok++;
      else console.log(`  NO COINCIDE al leer de vuelta: ${g.fuente}`);
    }
    console.log(`\nSupabase: ${ok}/${guardado.length} fuentes guardadas y verificadas por hash al leerlas de vuelta`);
  } finally {
    const { error } = await getSupabaseAdminClient().from('compras_corridas').delete().eq('id', id);
    console.log(error ? `No se pudo borrar la corrida de prueba ${id}: ${error.message}` : 'Corrida de prueba borrada');
  }
}

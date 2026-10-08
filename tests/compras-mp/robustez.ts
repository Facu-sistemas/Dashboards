// Prueba de robustez del motor de Compras MP: compara el motor en TypeScript contra el motor Python de
// referencia en escenarios distintos al golden (corte en otro mes, plan de enero cargado, base desordenada
// con un SKU nuevo e insumos críticos).
//
// Uso: node tests/compras-mp/robustez.ts <carpeta_paquete> <carpeta_escenarios>
//   (los escenarios los genera robustez_py.py: un .json por caso con parámetros, config, base y resultado)
import fs from 'node:fs';
import path from 'node:path';
import { calcular } from '../../src/lib/compras-mp/motor.ts';
import type { BaseRow, Config } from '../../src/lib/compras-mp/motor.ts';
import { crearLectores } from './lectores.ts';

const [dir, esc] = [process.argv[2], process.argv[3]];
if (!dir || !esc) throw new Error('Uso: robustez.ts <carpeta_paquete> <carpeta_escenarios>');
const { leerConsumo, leerPlan, leerOc } = crearLectores(dir);
const consumo = leerConsumo(), plan = leerPlan(), oc = leerOc();

let fallas = 0;
for (const f of fs.readdirSync(esc).filter((x) => x.endsWith('.json')).sort()) {
  const e = JSON.parse(fs.readFileSync(path.join(esc, f), 'utf8')) as {
    params: { corte: number; anio: number; dias: number; fexp: string };
    cfg: Config; base: BaseRow[]; result: Record<string, unknown>[];
  };
  const res = calcular({ base: e.base, consumo, plan, oc, corte: e.params.corte, anio: e.params.anio, diasTranscurridos: e.params.dias, fechaExportacion: e.params.fexp, cfg: e.cfg });
  const porSku = new Map(res.filas.map((r) => [r.sku, r as unknown as Record<string, unknown>]));
  const dif: Record<string, { sku: string; py: unknown; ts: unknown }[]> = {};
  let sinTs = 0, total = 0;
  for (const py of e.result) {
    const ts = porSku.get(String(py.sku));
    if (!ts) { sinTs++; continue; }
    for (const [k, a] of Object.entries(py)) {
      if (!(k in ts)) continue;
      const b = ts[k];
      total++;
      const ok = typeof a === 'number' && typeof b === 'number'
        ? Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)) + 1e-6
        : String(a ?? '') === String(b ?? '');
      if (!ok) (dif[k] ??= []).push({ sku: String(py.sku), py: a, ts: b });
    }
  }
  const compraTs = res.filas.reduce((s, r) => s + r.rdt, 0);
  const compraPy = e.result.reduce<number>((s, r) => s + Number(r.rdt ?? 0), 0);
  const campos = Object.keys(dif);
  const ok = !campos.length && !sinTs && res.filas.length === e.result.length;
  console.log(`${ok ? 'OK ' : 'FALLA'} ${f.replace('.json', '')}: ${res.filas.length} SKUs · ${total} comparaciones · compra Python ${compraPy.toFixed(2)} · TS ${compraTs.toFixed(2)}`);
  if (!ok) {
    fallas++;
    if (sinTs) console.log('   SKUs de Python sin fila en TS:', sinTs);
    console.log('   campos con diferencias:', JSON.stringify(Object.fromEntries(campos.map((k) => [k, dif[k]!.length]))));
    for (const k of campos.slice(0, 8)) console.log('  ', k, JSON.stringify(dif[k]!.slice(0, 3)));
  }
}
if (fallas) process.exitCode = 1;
else console.log('Robustez: todos los escenarios coinciden con el motor Python');

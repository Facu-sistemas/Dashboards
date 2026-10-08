// Siembra inicial de la configuración de Compras MP en Supabase (solo la primera vez): reglas y excepciones del libro v12 y el plan del año.
// No pisa nada: cada tabla se carga solo si está vacía (el plan se actualiza por upsert).
//
// Uso: node --env-file=.env tests/compras-mp/ejecutar-con-odoo.mjs tests/compras-mp/sembrar.ts <carpeta_paquete> [anio]
import XLSX from 'xlsx';
import path from 'node:path';
import { getBaseMp } from '../../src/lib/compras-mp/odoo/base';
import { sembrarConfig, sembrarPlan } from '../../src/lib/compras-mp/config';
import type { Origen } from '../../src/lib/compras-mp/motor';
import { crearLectores } from './lectores';

const dir = process.argv[2];
if (!dir) throw new Error('Falta la carpeta del paquete');
const anio = Number(process.argv[3] ?? 2026);

// Lista completa de proveedores con su origen (hoja Parámetros, columnas AC:AD del libro; los Local también figuran).
const wb = XLSX.readFile(path.join(dir, 'Presupuesto_Compras_MP_v12.xlsx'));
const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Parámetros']!, { header: 1, raw: true, defval: null }).slice(4);
const proveedoresOrigen: Record<string, Origen> = {};
for (const r of filas) {
  const prov = typeof r[28] === 'string' ? r[28].trim() : '';
  const ori = r[29];
  if (prov && (ori === 'Local' || ori === 'Brasil' || ori === 'China')) proveedoresOrigen[prov] = ori;
}
console.log(`Proveedores con origen en el libro: ${Object.keys(proveedoresOrigen).length}`);

const base = await getBaseMp();
const siembra = await sembrarConfig(base.productos.map((p) => ({ productId: p.productId, sku: p.sku, activo: p.activo })), { usuario: 'siembra-inicial', proveedoresOrigen });
console.log('Configuración sembrada:', JSON.stringify({ parametros: siembra.parametros, reglas: siembra.reglas, excepciones: siembra.excepciones }));
if (siembra.excepcionesSinProducto.length) console.log('Excepciones del libro cuyo producto ya no existe con ese nombre:', siembra.excepcionesSinProducto);

const { leerPlan } = crearLectores(dir);
const { diasTranscurridos: _omitido, ...plan } = leerPlan();
void _omitido;
const n = await sembrarPlan(anio, plan, 'siembra-inicial');
console.log(`Plan ${anio}: ${n} valores cargados en cfg_plan`);

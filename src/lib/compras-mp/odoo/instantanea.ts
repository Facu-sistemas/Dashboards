// Instantánea de Odoo para una corrida de Compras MP: junta todas las fuentes (solo lectura), les calcula un hash
// y las guarda como fotos crudas en `raw_compras`, para poder reproducir y auditar cualquier corrida.
import { createHash } from 'node:crypto';
import { getSupabaseAdminClient } from '../../supabase/admin';
import type { GastoLinea, OcPendienteLinea, StockDetalleResult } from '../../odoo/rotacion-gasto-detalle';
import { getBaseMp, type BaseMp } from './base';
import { getConsumoMensual, type ConsumoMensual } from './consumo';
import { getFinanzasMp, type FinanzasMp } from './finanzas';
import { getGastoRealMp, getOcPendientesMp, getRecepcionesSinFacturar, getStockFinDeMes, getTipoCambio, type RecepcionSinFacturar, type TipoCambio } from './otros';

export interface InstantaneaOdoo {
  /** AAAA-MM-DD: fecha de los datos de Odoo. */
  fechaDatos: string;
  base: BaseMp;
  consumo: ConsumoMensual;
  oc: OcPendienteLinea[];
  stockFinMes: StockDetalleResult;
  gasto: GastoLinea[];
  finanzas: FinanzasMp;
  tipoCambio: TipoCambio | null;
  recepcionesSinFacturar: RecepcionSinFacturar[];
}

export type FuenteRaw =
  | 'base' | 'consumo' | 'oc' | 'stock_fin_mes' | 'gasto' | 'cond_pago' | 'facturas' | 'pagos' | 'impuestos' | 'gastos_imp'
  | 'recepciones_sin_facturar' | 'tipo_cambio';

export interface FotoRaw {
  fuente: FuenteRaw;
  filas: number;
  datos: unknown;
}

/** JSON con las claves ordenadas: igual contenido, igual texto (jsonb de Postgres no conserva el orden de las claves). */
function canonico(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonico).join(',')}]`;
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(x === undefined ? null : x);
}

/** Hash estable (sha256) del contenido, para detectar si una fuente cambió entre corridas. */
export function hashDatos(datos: unknown): string {
  return createHash('sha256').update(canonico(datos)).digest('hex');
}

const hoyAr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

/** Lee todas las fuentes de Odoo. `desdeConsumo` = primer mes del historial de consumo. */
export async function tomarInstantanea(opts: { desdeConsumo?: string; desdePagos?: string } = {}): Promise<InstantaneaOdoo> {
  const fechaDatos = hoyAr();
  // En tandas para no saturar a Odoo.
  const [base, consumo, oc] = await Promise.all([getBaseMp(), getConsumoMensual(opts.desdeConsumo ?? '2025-05-01', fechaDatos), getOcPendientesMp()]);
  const [stockFinMes, gasto, finanzas] = await Promise.all([getStockFinDeMes(), getGastoRealMp(), getFinanzasMp(opts.desdePagos ?? `${fechaDatos.slice(0, 4)}-01-01`)]);
  const [tipoCambio, recepcionesSinFacturar] = await Promise.all([getTipoCambio('USD', fechaDatos), getRecepcionesSinFacturar()]);
  return { fechaDatos, base, consumo, oc, stockFinMes, gasto, finanzas, tipoCambio, recepcionesSinFacturar };
}

export function fotosRaw(i: InstantaneaOdoo): FotoRaw[] {
  const f = i.finanzas;
  return [
    { fuente: 'base', filas: i.base.productos.length, datos: i.base },
    { fuente: 'consumo', filas: i.consumo.filas.length, datos: i.consumo },
    { fuente: 'oc', filas: i.oc.length, datos: i.oc },
    { fuente: 'stock_fin_mes', filas: i.stockFinMes.productos.length, datos: i.stockFinMes },
    { fuente: 'gasto', filas: i.gasto.length, datos: i.gasto },
    { fuente: 'cond_pago', filas: Object.keys(f.condPago).length, datos: f.condPago },
    { fuente: 'facturas', filas: f.facturas.length, datos: f.facturas },
    { fuente: 'pagos', filas: f.pagos.length, datos: f.pagos },
    { fuente: 'impuestos', filas: f.impuestos.length, datos: f.impuestos },
    { fuente: 'gastos_imp', filas: f.gastos.length, datos: f.gastos },
    { fuente: 'recepciones_sin_facturar', filas: i.recepcionesSinFacturar.length, datos: i.recepcionesSinFacturar },
    { fuente: 'tipo_cambio', filas: i.tipoCambio ? 1 : 0, datos: i.tipoCambio },
  ];
}

/** Abre una corrida en `compras_corridas` (estado "corriendo"). */
export async function abrirCorrida(origen: 'cron' | 'manual' | 'golden' | 'paralelo', fechaDatos: string, disparadaPor?: string): Promise<string> {
  const { data, error } = await getSupabaseAdminClient()
    .from('compras_corridas')
    .insert({ origen, fecha_datos: fechaDatos, disparada_por: disparadaPor ?? null })
    .select('id')
    .single();
  if (error || !data) throw new Error(`No se pudo abrir la corrida: ${error?.message}`);
  return data.id as string;
}

/** Guarda las fotos crudas de la corrida (una fila por fuente, con hash y cantidad de filas). */
export async function guardarRaw(corridaId: string, i: InstantaneaOdoo): Promise<{ fuente: FuenteRaw; filas: number; hash: string }[]> {
  const supabase = getSupabaseAdminClient();
  const resumen: { fuente: FuenteRaw; filas: number; hash: string }[] = [];
  for (const foto of fotosRaw(i)) {
    const hash = hashDatos(foto.datos);
    const { error } = await supabase.from('raw_compras').upsert(
      { corrida_id: corridaId, fuente: foto.fuente, fecha_datos: i.fechaDatos, hash, filas: foto.filas, datos: foto.datos },
      { onConflict: 'corrida_id,fuente' },
    );
    if (error) throw new Error(`No se pudo guardar la fuente ${foto.fuente}: ${error.message}`);
    resumen.push({ fuente: foto.fuente, filas: foto.filas, hash });
  }
  return resumen;
}

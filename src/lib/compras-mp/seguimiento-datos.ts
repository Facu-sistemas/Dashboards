// Arma el Seguimiento (cumplimiento) de la versión aprobada vigente con los datos reales de una corrida.
import { getSupabaseAdminClient } from '../supabase/admin';
import { idCorridaRaw } from './raw';
import type { GastoLinea, StockDetalleResult } from '../odoo/rotacion-gasto-detalle';
import { getGastoRealMp } from './odoo/otros';
import type { ConsumoMensual } from './odoo/consumo';
import type { HistoriaStockProducto } from './inventario';
import type { FilaCompleta } from './indicadores';
import { calcularSeguimiento, type ResultadoSeguimiento } from './seguimiento';
import { leerFilasVersion, versionVigente, type CabeceraVersion } from './versiones';

export interface SeguimientoCompleto {
  version: CabeceraVersion;
  resultado: ResultadoSeguimiento;
  /** Corte (AAAA-MM) con el que se midió. */
  corte: string;
}

async function leerRaw<T>(corridaId: string, fuente: string): Promise<T | null> {
  const { data, error } = await getSupabaseAdminClient().from('raw_compras').select('datos').eq('corrida_id', await idCorridaRaw(corridaId)).eq('fuente', fuente).maybeSingle();
  if (error) throw new Error(`raw_compras (${fuente}): ${error.message}`);
  return (data?.datos as T) ?? null;
}

/**
 * Cumplimiento de la versión aprobada vigente medido con las fotos de Odoo de la corrida.
 * `empresasGasto`: empresas para el "facturado de referencia" (sin dato, el de la corrida: solo la compañía operativa).
 */
export async function construirSeguimiento(corrida: { id: string; fechaDatos: string; resumen: { corte: string } | null }, filas: FilaCompleta[], empresasGasto?: number[]): Promise<SeguimientoCompleto | null> {
  const version = await versionVigente();
  if (!version || !corrida.resumen) return null;
  const [filasVersion, consumoRaw, stockRaw] = await Promise.all([
    leerFilasVersion(version.id), leerRaw<ConsumoMensual>(corrida.id, 'consumo'), leerRaw<StockDetalleResult>(corrida.id, 'stock_fin_mes'),
  ]);
  if (!consumoRaw || !stockRaw) return null;

  const stock = new Map<number, HistoriaStockProducto>();
  for (const p of stockRaw.productos) {
    const cantidad = Array(13).fill(0) as number[], valor = Array(13).fill(0) as number[];
    p.cortes.forEach((c, i) => { if (i <= 12) { cantidad[i] = c.cantidad; valor[i] = c.valor; } });
    stock.set(p.productId, { cantidad, valor });
  }
  const consumo = new Map<number, Map<string, number>>();
  for (const f of consumoRaw.filas) consumo.set(f.productId, new Map(consumoRaw.meses.map((m, i) => [m, f.vals[i] ?? 0])));

  const gasto = empresasGasto?.length ? await getGastoRealMp(empresasGasto) : await leerRaw<GastoLinea[]>(corrida.id, 'gasto');
  const facturado = new Map<string, number>();
  for (const l of gasto ?? []) {
    const k = `${l.productId}|${l.fecha.slice(0, 7)}`;
    facturado.set(k, (facturado.get(k) ?? 0) + l.importe);
  }

  const catalogo = new Map<number, { sku: string; cat: string; abc: string; costoActual: number }>();
  for (const f of filas) if (f.productId !== null && f.productId !== undefined) catalogo.set(f.productId, { sku: f.sku, cat: f.cat, abc: f.abc, costoActual: f.costo });

  const resultado = calcularSeguimiento({
    filasVersion, horizonte: version.horizonte, corte: corrida.resumen.corte, anioStock: Number(corrida.fechaDatos.slice(0, 4)),
    cierresDeStock: stockRaw.cortes.length, stock, consumo, catalogo, facturado,
  });
  return { version, resultado, corte: corrida.resumen.corte };
}

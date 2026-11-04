import { searchRead, searchReadAll } from './client';
import { addDaysIso } from '@/lib/date';

/** Categoría "PI / Block Espuma": un producto por tipo de espuma (color/densidad), en kg, sin medidas. */
const BLOCK_CATEG_ID = 26;

export type EspumadoCategoria = 'produccion' | 'transferencia' | 'consumo' | 'venta' | 'ajuste' | 'otro';

export interface EspumadoSerieDia {
  fecha: string;
  produccion: number;
  transferencia: number;
  consumo: number;
  venta: number;
  /** Signed: positivo = Odoo sumó stock, negativo = lo sacó. */
  ajuste: number;
}

export interface EspumadoTipo {
  id: number;
  nombre: string;
  stockKg: number;
  stockPoliesterKg: number;
  stockPreProduccionKg: number;
  stockOtrosKg: number;
  produccionKg: number;
  transferenciaKg: number;
  /** Neto de devoluciones (Producción → pre-producción restan). */
  consumoKg: number;
  ventaKg: number;
  ajusteKg: number;
  consumoDiarioKg: number;
  /** Stock total / consumo medio por día de planta. null = sin consumo en el rango. */
  coberturaDias: number | null;
  /** Stock al inicio del rango, reconstruido como stock actual − neto de movimientos. */
  stockInicialKg: number;
}

export interface EspumadoResult {
  desde: string;
  hasta: string;
  dias: number;
  /** Días del rango con consumo > 0 (excluye fines de semana/feriados sin planta). */
  diasPlanta: number;
  tipos: EspumadoTipo[];
  serie: EspumadoSerieDia[];
  serieTipos: Record<number, EspumadoSerieDia[]>;
}

export interface EspumadoMovimiento {
  id: number;
  fecha: string;
  referencia: string;
  origen: string;
  destino: string;
  categoria: EspumadoCategoria;
  /** Signed desde el punto de vista del stock de la planta (internal). */
  kg: number;
}

type MoveLine = {
  id: number;
  date: string;
  reference: string | false;
  product_id: [number, string];
  quantity: number;
  location_id: [number, string];
  location_dest_id: [number, string];
};

const VIRTUAL = 'Virtual Locations/';
const AJUSTE = `${VIRTUAL}Inventory adjustment`;
const PRODUCCION = `${VIRTUAL}Production`;

/** Clasifica un movimiento por sus ubicaciones y devuelve el efecto en kg sobre el stock interno (signo). */
function clasificar(origen: string, destino: string, qty: number): { categoria: EspumadoCategoria; kg: number } {
  if (origen.startsWith(PRODUCCION)) {
    // Fabricación a la ubicación de blocks = producción; a pre-producción = devolución de sobrante (resta consumo).
    return destino.endsWith('/Poliester')
      ? { categoria: 'produccion', kg: qty }
      : { categoria: 'consumo', kg: qty };
  }
  if (destino.startsWith(PRODUCCION)) return { categoria: 'consumo', kg: -qty };
  if (destino.includes('Customers')) return { categoria: 'venta', kg: -qty };
  if (origen.startsWith(AJUSTE)) return { categoria: 'ajuste', kg: qty };
  if (destino.startsWith(AJUSTE)) return { categoria: 'ajuste', kg: -qty };
  if (origen.endsWith('/Poliester') && destino.endsWith('/PRE-PRODUCCION')) return { categoria: 'transferencia', kg: 0 };
  return { categoria: 'otro', kg: 0 };
}

/** Odoo guarda UTC; la planta trabaja en Argentina (UTC-3, sin horario de verano). */
function fechaLocal(utc: string): string {
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  d.setUTCHours(d.getUTCHours() - 3);
  return d.toISOString().slice(0, 10);
}

function hoyLocal(): string {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() - 3);
  return d.toISOString().slice(0, 10);
}

function nombreBlock(display: string): string {
  return display.replace(/^POLIESTER\s+/i, '').trim();
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function serieVacia(desde: string, dias: number): Map<string, EspumadoSerieDia> {
  const m = new Map<string, EspumadoSerieDia>();
  for (let i = 0; i < dias; i++) {
    const fecha = addDaysIso(desde, i);
    m.set(fecha, { fecha, produccion: 0, transferencia: 0, consumo: 0, venta: 0, ajuste: 0 });
  }
  return m;
}

async function getBlockProducts(): Promise<{ id: number; display_name: string }[]> {
  return searchRead<{ id: number; display_name: string }>({
    model: 'product.product',
    domain: [['categ_id', '=', BLOCK_CATEG_ID]],
    fields: ['display_name'],
    order: 'display_name asc',
  });
}

function rangoDomain(desde: string, hastaExcl: string, productIds: number[]) {
  return [
    ['product_id', 'in', productIds],
    ['state', '=', 'done'],
    ['date', '>=', `${addDaysIso(desde, 0)} 03:00:00`],
    ['date', '<', `${hastaExcl} 03:00:00`],
  ] as [string, '=' | 'in' | '>=' | '<', unknown][];
}

/** Resumen por tipo de block: stock actual por ubicación + flujo (producción, transferencia, consumo, venta, ajustes) de los últimos `dias` días. Solo lectura. */
export async function getEspumado(dias: number): Promise<EspumadoResult> {
  const hasta = hoyLocal();
  const desde = addDaysIso(hasta, -(dias - 1));
  const hastaExcl = addDaysIso(hasta, 1);

  const productos = await getBlockProducts();
  const ids = productos.map((p) => p.id);

  const [lines, quants] = await Promise.all([
    searchReadAll<MoveLine>({
      model: 'stock.move.line',
      domain: rangoDomain(desde, hastaExcl, ids),
      fields: ['date', 'product_id', 'quantity', 'location_id', 'location_dest_id'],
      limit: 5000,
    }),
    searchReadAll<{ product_id: [number, string]; location_id: [number, string]; quantity: number }>({
      model: 'stock.quant',
      domain: [
        ['product_id', 'in', ids],
        ['location_id.usage', '=', 'internal'],
      ],
      fields: ['product_id', 'location_id', 'quantity'],
      limit: 2000,
    }),
  ]);

  const total = serieVacia(desde, dias);
  const porTipo = new Map<number, Map<string, EspumadoSerieDia>>(ids.map((id) => [id, serieVacia(desde, dias)]));
  const netoPorTipo = new Map<number, number>();

  for (const l of lines) {
    const { categoria, kg } = clasificar(l.location_id[1], l.location_dest_id[1], l.quantity);
    if (categoria === 'otro') continue;
    const fecha = fechaLocal(l.date);
    const dTotal = total.get(fecha);
    const dTipo = porTipo.get(l.product_id[0])?.get(fecha);
    if (!dTotal || !dTipo) continue;
    for (const d of [dTotal, dTipo]) {
      if (categoria === 'produccion') d.produccion += l.quantity;
      else if (categoria === 'transferencia') d.transferencia += l.quantity;
      else if (categoria === 'consumo') d.consumo += -kg;
      else if (categoria === 'venta') d.venta += l.quantity;
      else d.ajuste += kg;
    }
    netoPorTipo.set(l.product_id[0], (netoPorTipo.get(l.product_id[0]) ?? 0) + kg);
  }

  const stockPorTipo = new Map<number, { poliester: number; pre: number; otros: number }>();
  for (const q of quants) {
    const s = stockPorTipo.get(q.product_id[0]) ?? { poliester: 0, pre: 0, otros: 0 };
    if (q.location_id[1].endsWith('/Poliester')) s.poliester += q.quantity;
    else if (q.location_id[1].endsWith('/PRE-PRODUCCION')) s.pre += q.quantity;
    else s.otros += q.quantity;
    stockPorTipo.set(q.product_id[0], s);
  }

  const redondear = (m: Map<string, EspumadoSerieDia>): EspumadoSerieDia[] =>
    [...m.values()].map((d) => ({
      fecha: d.fecha,
      produccion: r2(d.produccion),
      transferencia: r2(d.transferencia),
      consumo: r2(d.consumo),
      venta: r2(d.venta),
      ajuste: r2(d.ajuste),
    }));

  const serie = redondear(total);
  const diasPlanta = Math.max(1, serie.filter((d) => d.consumo > 0).length);

  const tipos: EspumadoTipo[] = productos.map((p) => {
    const s = redondear(porTipo.get(p.id)!);
    const sum = (k: 'produccion' | 'transferencia' | 'consumo' | 'venta' | 'ajuste') => s.reduce((a, d) => a + d[k], 0);
    const st = stockPorTipo.get(p.id) ?? { poliester: 0, pre: 0, otros: 0 };
    const stockKg = st.poliester + st.pre + st.otros;
    const consumoKg = sum('consumo');
    const consumoDiarioKg = consumoKg / diasPlanta;
    return {
      id: p.id,
      nombre: nombreBlock(p.display_name),
      stockKg: r2(stockKg),
      stockPoliesterKg: r2(st.poliester),
      stockPreProduccionKg: r2(st.pre),
      stockOtrosKg: r2(st.otros),
      produccionKg: r2(sum('produccion')),
      transferenciaKg: r2(sum('transferencia')),
      consumoKg: r2(consumoKg),
      ventaKg: r2(sum('venta')),
      ajusteKg: r2(sum('ajuste')),
      consumoDiarioKg: r2(consumoDiarioKg),
      coberturaDias: consumoDiarioKg > 0 ? r2(stockKg / consumoDiarioKg) : null,
      stockInicialKg: r2(stockKg - (netoPorTipo.get(p.id) ?? 0)),
    };
  });

  return {
    desde,
    hasta,
    dias,
    diasPlanta,
    tipos,
    serie,
    serieTipos: Object.fromEntries(ids.map((id) => [id, redondear(porTipo.get(id)!)])),
  };
}

/** Movimientos crudos de un tipo de block, para auditar el número agregado (más nuevos primero). */
export async function getEspumadoMovimientos(productId: number, dias: number): Promise<EspumadoMovimiento[]> {
  const hasta = hoyLocal();
  const desde = addDaysIso(hasta, -(dias - 1));
  const lines = await searchReadAll<MoveLine>({
    model: 'stock.move.line',
    domain: rangoDomain(desde, addDaysIso(hasta, 1), [productId]),
    fields: ['date', 'reference', 'product_id', 'quantity', 'location_id', 'location_dest_id'],
    order: 'date desc',
    limit: 5000,
  });
  return lines
    .map((l) => {
      const origen = l.location_id[1];
      const destino = l.location_dest_id[1];
      const { categoria, kg } = clasificar(origen, destino, l.quantity);
      return {
        id: l.id,
        fecha: l.date,
        referencia: l.reference || '',
        origen,
        destino,
        categoria,
        kg: categoria === 'transferencia' ? l.quantity : r2(kg),
      };
    })
    .filter((m) => m.categoria !== 'otro' || m.kg !== 0);
}

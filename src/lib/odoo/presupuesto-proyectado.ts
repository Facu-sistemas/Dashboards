import { searchReadAll, readGroup } from './client';
import { getFronteraCompany } from './reference';
import { withTtlCache } from '../cache';
import { lastMonthKeys, monthBounds } from '../date';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS, getArgentinaTodayIso } from './oee';
import { getObjetivosGerencia } from './gerencia-objetivos';
import { getDiasHabiles } from './business-calendar';
import { MATERIA_PRIMA_CATEG_ID } from './raw-material-consumption';
import type { OdooReadGroupResult } from './types';

/**
 * "Presupuesto proyectado" (Compras) — consumo histórico de cada materia
 * prima escalado por las ventas proyectadas del año:
 *
 *   coeficiente[SKU]      = consumo histórico del SKU / unidades producidas de su línea
 *   consumo proyectado[m] = coeficiente × ventas proyectadas del mes m
 *   necesidad[m]          = consumo proyectado acumulado + stock de seguridad − disponible − entrante  (≥ 0)
 *   presupuesto[m]        = necesidad incremental del mes × costo
 *
 * Confirmado en vivo (2026-09-30): ~99,9% del consumo de materia prima se
 * registra en órdenes de fabricación de productos intermedios (categorías
 * "PI / ..."), no en la orden del producto terminado — por eso el consumo
 * de un insumo NO se puede atribuir a Colchones/Living mirando la orden
 * que lo consume. La línea de cada insumo es, en cambio, una etiqueta por
 * SKU (Colchones / Living / Ambos): se sugiere automáticamente según la
 * categoría de la orden que lo consume y puede pisarse a mano.
 *
 * Unidades: Living se mide en Unidades Equivalentes (`x_studio_unidades_eq`,
 * igual que la planilla de objetivos) y Colchones en cantidad. Los "Ambos"
 * se escalan por producción total (Living UE + Colchones unidades).
 */

export type Linea = 'colchones' | 'living' | 'ambos';
export const LINEAS: Linea[] = ['colchones', 'living', 'ambos'];

const DEFAULT_LOOKBACK_MONTHS = 6;
const CACHE_TTL_MS = 5 * 60 * 1000;
// Un insumo se sugiere como "de una sola línea" si el otro lado consume menos que este % de lo atribuible.
const LINEA_SUGERIDA_UMBRAL = 0.05;

// Categorías de la orden que consume el insumo, para SUGERIR la línea.
// Confirmado en vivo: "PI" (id 15, sin subcategoría) son las piezas de
// Living (TAP/PIP/PIC/ALL), "PI / Colchones ..." y "PI / Bases" las de
// Colchones. "PI / Block Espuma" (26) lo usan ambas líneas → no suma a ninguna.
const PI_COLCHONES_CATEG_IDS = [18, 19, 22, 21];
const PI_LIVING_CATEG_IDS = [15];
const CONSUMO_COLCHONES_CATEG_IDS = [...COLCHONES_CATEG_IDS, ...PI_COLCHONES_CATEG_IDS];
const CONSUMO_LIVING_CATEG_IDS = [...LIVING_CATEG_IDS, ...PI_LIVING_CATEG_IDS];

export interface PresupuestoProyectadoRow {
  productId: number;
  nombre: string;
  categoria: string;
  proveedor: string | null;
  costo: number;
  disponible: number;
  entrante: number;
  stockSeguridad: number;
  linea: Linea;
  lineaSugerida: Linea;
  lineaManual: boolean;
  /** Consumo histórico mensual (últimos `historicoMeses`, mismo orden que `historicoMeses`). */
  consumoHistorico: number[];
  consumoHistoricoTotal: number;
  /** Consumo histórico por unidad producida de su línea. */
  coeficiente: number;
  /** 12 entradas Ene..Dic. Meses ya cerrados = 0; el mes en curso está prorrateado por días hábiles restantes. */
  consumoProyectado: number[];
  /** 12 entradas: unidades a comprar en ese mes (incremental, no acumulado). */
  compraMensual: number[];
  /** 12 entradas: compraMensual × costo. */
  presupuestoMensual: number[];
}

export interface ProduccionHistorica {
  colchones: number;
  living: number;
  total: number;
}

export interface PresupuestoProyectadoResult {
  year: number;
  /** Índice 0-based del mes en curso; los meses anteriores no se proyectan. */
  mesActual: number;
  months: string[];
  historicoMeses: string[];
  produccionHistorica: ProduccionHistorica;
  ventasProyectadas: { colchones: number[]; living: number[]; total: number[] };
  diasHabiles: number[];
  categorias: string[];
  proveedores: string[];
  rows: PresupuestoProyectadoRow[];
  /** false si no se pudo leer la tabla de etiquetas manuales (Supabase) — todas las líneas quedan como sugeridas. */
  etiquetasManualesDisponibles: boolean;
}

type ProductRow = {
  id: number;
  name: string;
  qty_available: number;
  incoming_qty: number;
  standard_price: number;
  categ_id: [number, string];
  seller_ids: number[];
};

type GroupProductRow = OdooReadGroupResult & { product_id: [number, string] | false; product_qty: number };
type GroupProductMonthRow = GroupProductRow & { __range?: Record<string, { from: string | false; to: string | false }> };

function consumptionDomain(companyId: number, start: string, endExclusive: string, extra: unknown[] = []) {
  return [
    ['raw_material_production_id', '!=', false],
    ['raw_material_production_id.company_id', '=', companyId],
    ['state', '=', 'done'],
    ['product_id.categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID],
    ['date', '>=', start],
    // Excluye movimientos con fecha placeholder a futuro (año 2100) — ver raw-material-consumption.ts.
    ['date', '<', endExclusive],
    ...extra,
  ] as never;
}

async function consumoPorProducto(companyId: number, start: string, endExclusive: string, categIds?: number[]): Promise<Map<number, number>> {
  const extra = categIds ? [['raw_material_production_id.product_id.categ_id', 'in', categIds]] : [];
  const groups = (await readGroup({
    model: 'stock.move',
    domain: consumptionDomain(companyId, start, endExclusive, extra),
    fields: ['product_qty'],
    groupBy: ['product_id'],
    lazy: false,
  })) as GroupProductRow[];
  const map = new Map<number, number>();
  for (const g of groups) if (g.product_id) map.set(g.product_id[0], g.product_qty);
  return map;
}

async function consumoPorProductoYMes(companyId: number, start: string, endExclusive: string): Promise<Map<number, Map<string, number>>> {
  const groups = (await readGroup({
    model: 'stock.move',
    domain: consumptionDomain(companyId, start, endExclusive),
    fields: ['product_qty'],
    groupBy: ['product_id', 'date:month'],
    lazy: false,
  })) as GroupProductMonthRow[];
  const map = new Map<number, Map<string, number>>();
  for (const g of groups) {
    const from = g.__range?.['date:month']?.from;
    if (!g.product_id || !from) continue;
    const id = g.product_id[0];
    if (!map.has(id)) map.set(id, new Map());
    map.get(id)!.set(from.slice(0, 7), g.product_qty);
  }
  return map;
}

async function produccionHistorica(companyId: number, start: string, endExclusive: string): Promise<ProduccionHistorica> {
  type Row = { qty_produced: number; x_studio_unidades_eq: number };
  const fetch = (categIds: number[]) =>
    searchReadAll<Row>({
      model: 'mrp.production',
      domain: [
        ['state', '=', 'done'],
        ['company_id', '=', companyId],
        ['product_id.categ_id', 'in', categIds],
        ['date_finished', '>=', start],
        ['date_finished', '<', endExclusive],
      ],
      fields: ['qty_produced', 'x_studio_unidades_eq'],
    });
  const [colchonesRows, livingRows] = await Promise.all([fetch(COLCHONES_CATEG_IDS), fetch(LIVING_CATEG_IDS)]);
  const colchones = colchonesRows.reduce((s, r) => s + r.qty_produced, 0);
  const living = livingRows.reduce((s, r) => s + r.x_studio_unidades_eq, 0);
  return { colchones, living, total: colchones + living };
}

function sugerirLinea(colchones: number, living: number): Linea {
  const atribuible = colchones + living;
  if (atribuible <= 0) return 'ambos';
  if (living / atribuible < LINEA_SUGERIDA_UMBRAL) return 'colchones';
  if (colchones / atribuible < LINEA_SUGERIDA_UMBRAL) return 'living';
  return 'ambos';
}

interface OdooBase {
  productos: ProductRow[];
  stockSeguridad: Map<number, number>;
  proveedorPorProducto: Map<number, { nombre: string; precio: number }>;
  consumoMensual: Map<number, Map<string, number>>;
  consumoColchones: Map<number, number>;
  consumoLiving: Map<number, number>;
  produccion: ProduccionHistorica;
  ventas: { colchones: number[]; living: number[] };
  diasTotal: number[];
  diasTranscurridos: number[];
  historicoMeses: string[];
}

async function fetchOdooBase(year: number, lookbackMonths: number): Promise<OdooBase> {
  const { companyId } = await getFronteraCompany();

  // Ventana histórica = últimos N meses COMPLETOS (el mes en curso queda afuera para no sesgar el coeficiente).
  const today = new Date(`${getArgentinaTodayIso()}T00:00:00Z`);
  const previousMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const historicoMeses = lastMonthKeys(lookbackMonths, previousMonth);
  const start = monthBounds(historicoMeses[0]!).start;
  const endExclusive = monthBounds(historicoMeses[historicoMeses.length - 1]!).endExclusive;

  const [productos, orderpoints, consumoMensual, consumoColchones, consumoLiving, produccion, objetivos, dias] = await Promise.all([
    searchReadAll<ProductRow>({
      model: 'product.product',
      domain: [['categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID]],
      fields: ['name', 'qty_available', 'incoming_qty', 'standard_price', 'categ_id', 'seller_ids'],
      order: 'name asc',
    }),
    searchReadAll<{ product_id: [number, string]; product_min_qty: number }>({
      model: 'stock.warehouse.orderpoint',
      domain: [['product_id.categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID]],
      fields: ['product_id', 'product_min_qty'],
    }),
    consumoPorProductoYMes(companyId, start, endExclusive),
    consumoPorProducto(companyId, start, endExclusive, CONSUMO_COLCHONES_CATEG_IDS),
    consumoPorProducto(companyId, start, endExclusive, CONSUMO_LIVING_CATEG_IDS),
    produccionHistorica(companyId, start, endExclusive),
    getObjetivosGerencia(),
    getDiasHabiles(year),
  ]);

  // Proveedor principal = el de menor `sequence` (Odoo ya devuelve seller_ids ordenados así en el modelo).
  const sellerIds = [...new Set(productos.flatMap((p) => p.seller_ids))];
  const sellers = sellerIds.length
    ? await searchReadAll<{ id: number; partner_id: [number, string]; price: number }>({
        model: 'product.supplierinfo',
        domain: [['id', 'in', sellerIds]],
        fields: ['partner_id', 'price'],
      })
    : [];
  const sellerById = new Map(sellers.map((s) => [s.id, s]));
  const proveedorPorProducto = new Map<number, { nombre: string; precio: number }>();
  for (const p of productos) {
    const first = p.seller_ids.map((id) => sellerById.get(id)).find((s) => s);
    if (first) proveedorPorProducto.set(p.id, { nombre: first.partner_id[1], precio: first.price });
  }

  return {
    productos,
    stockSeguridad: new Map(orderpoints.map((o) => [o.product_id[0], o.product_min_qty])),
    proveedorPorProducto,
    consumoMensual,
    consumoColchones,
    consumoLiving,
    produccion,
    ventas: { colchones: objetivos.ventas.colchones, living: objetivos.ventas.sillones },
    diasTotal: dias.diasTotal,
    diasTranscurridos: dias.diasTranscurridos,
    historicoMeses,
  };
}

/**
 * @param overrides etiquetas manuales por productId (Supabase). Se aplican
 * acá, después del cache de Odoo, así cambiar una etiqueta se refleja al
 * instante sin volver a consultar Odoo.
 */
export async function getPresupuestoProyectado(
  overrides: Map<number, Linea>,
  etiquetasManualesDisponibles = true,
  lookbackMonths = DEFAULT_LOOKBACK_MONTHS
): Promise<PresupuestoProyectadoResult> {
  const today = getArgentinaTodayIso();
  const year = Number(today.slice(0, 4));
  const mesActual = Number(today.slice(5, 7)) - 1;
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

  const base = await withTtlCache(`presupuesto-proyectado:${year}:${lookbackMonths}`, CACHE_TTL_MS, () => fetchOdooBase(year, lookbackMonths));

  const ventasTotal = base.ventas.colchones.map((c, i) => c + (base.ventas.living[i] ?? 0));
  const ventasPorLinea: Record<Linea, number[]> = { colchones: base.ventas.colchones, living: base.ventas.living, ambos: ventasTotal };
  const produccionPorLinea: Record<Linea, number> = {
    colchones: base.produccion.colchones,
    living: base.produccion.living,
    ambos: base.produccion.total,
  };
  // Del mes en curso solo queda por consumir la fracción de días hábiles que falta.
  const factorMes = months.map((_, i) => {
    if (i < mesActual) return 0;
    if (i > mesActual) return 1;
    const total = base.diasTotal[i] || 1;
    return Math.max(total - (base.diasTranscurridos[i] ?? 0), 0) / total;
  });

  const rows: PresupuestoProyectadoRow[] = [];
  for (const p of base.productos) {
    const porMes = base.consumoMensual.get(p.id);
    const consumoHistorico = base.historicoMeses.map((m) => porMes?.get(m) ?? 0);
    const consumoHistoricoTotal = consumoHistorico.reduce((s, v) => s + v, 0);
    const stockSeguridad = base.stockSeguridad.get(p.id) ?? 0;
    // Sin consumo histórico ni stock de seguridad no hay nada que presupuestar.
    if (consumoHistoricoTotal <= 0 && stockSeguridad <= 0) continue;

    const lineaSugerida = sugerirLinea(base.consumoColchones.get(p.id) ?? 0, base.consumoLiving.get(p.id) ?? 0);
    const manual = overrides.get(p.id);
    const linea = manual ?? lineaSugerida;

    const produccion = produccionPorLinea[linea];
    const coeficiente = produccion > 0 ? consumoHistoricoTotal / produccion : 0;
    const consumoProyectado = months.map((_, i) => coeficiente * (ventasPorLinea[linea][i] ?? 0) * factorMes[i]!);

    const proveedor = base.proveedorPorProducto.get(p.id);
    const costo = p.standard_price > 0 ? p.standard_price : (proveedor?.precio ?? 0);

    // Necesidad acumulada desde el mes en curso: el stock de seguridad se cubre una sola vez y el
    // stock disponible/entrante se va consumiendo mes a mes → la compra de cada mes es el incremento.
    const compraMensual = new Array<number>(12).fill(0);
    let acumuladoProyectado = 0;
    let necesidadPrevia = 0;
    for (let i = mesActual; i < 12; i++) {
      acumuladoProyectado += consumoProyectado[i]!;
      const necesidad = Math.max(acumuladoProyectado + stockSeguridad - p.qty_available - p.incoming_qty, 0);
      compraMensual[i] = necesidad - necesidadPrevia;
      necesidadPrevia = necesidad;
    }

    rows.push({
      productId: p.id,
      nombre: p.name,
      categoria: p.categ_id[1].replace(/^Materia Prima \/ /, ''),
      proveedor: proveedor?.nombre ?? null,
      costo,
      disponible: p.qty_available,
      entrante: p.incoming_qty,
      stockSeguridad,
      linea,
      lineaSugerida,
      lineaManual: manual !== undefined,
      consumoHistorico,
      consumoHistoricoTotal,
      coeficiente,
      consumoProyectado,
      compraMensual,
      presupuestoMensual: compraMensual.map((q) => q * costo),
    });
  }

  return {
    year,
    mesActual,
    months,
    historicoMeses: base.historicoMeses,
    produccionHistorica: base.produccion,
    ventasProyectadas: { colchones: base.ventas.colchones, living: base.ventas.living, total: ventasTotal },
    diasHabiles: base.diasTotal,
    categorias: [...new Set(rows.map((r) => r.categoria))].sort(),
    proveedores: [...new Set(rows.map((r) => r.proveedor).filter((p): p is string => p !== null))].sort(),
    rows,
    etiquetasManualesDisponibles,
  };
}

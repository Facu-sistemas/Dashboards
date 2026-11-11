import { searchCount, searchReadAll } from './client';
import { addDaysIso, lastMonthKeys, monthBounds } from '@/lib/date';
import { getArgentinaTodayIso, LIVING_CATEG_IDS } from './oee';
import type { OdooDomain } from './types';

export type DespachoEstado = 'assigned' | 'confirmed' | 'waiting';

export interface DespachoPendiente {
  id: number;
  name: string;
  cliente: string;
  origen: string;
  almacen: string;
  estado: DespachoEstado;
  fechaProgramada: string;
  diasAtraso: number;
  /** Unidades de colchón pendientes en este picking. */
  colchones: number;
  /** Unidades equivalentes (UE) de sillón pendientes en este picking. */
  sillonesEq: number;
}

export interface DespachosAntiguedadBucket {
  label: string;
  count: number;
}

export interface DespachosData {
  hoy: string;
  pendientes: DespachoPendiente[];
  porEstado: Record<DespachoEstado, number>;
  atrasados: number;
  /** Totales pendientes de recolectar (suma de todos los pickings pendientes). */
  colchonesPendientes: number;
  sillonesEqPendientes: number;
  antiguedad: DespachosAntiguedadBucket[];
  despachados30d: number;
  despachadosMensual: { month: string; count: number }[];
}

/**
 * Pickings WH/PICK (tipo de operación "Recolectar", id 3: WH/Existencias → WH/Salida).
 * Se usan en lugar de los remitos WH/OUT: el pendiente real de depósito es lo que
 * todavía no se recolectó. Mismo id que usa Logística > Avance de carga.
 */
const PICKING_TYPE_RECOLECTAR = 3;
const OUTGOING: OdooDomain = [['picking_type_id', '=', PICKING_TYPE_RECOLECTAR]];
/** Categorías que cuentan como "colchón" (unidad); Bases (8) viaja con el colchón y no suma unidades. */
const COLCHON_UNIDAD_CATEG_IDS = [5, 9, 6, 20];

interface MoveRow extends Record<string, unknown> {
  picking_id: [number, string] | false;
  product_id: [number, string];
  product_uom_qty: number;
}
interface ProductRow extends Record<string, unknown> {
  id: number;
  x_studio_equivalente_produccion: number;
  categ_id: [number, string];
}

interface PickingRow extends Record<string, unknown> {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  origin: string | false;
  picking_type_id: [number, string] | false;
  state: DespachoEstado;
  scheduled_date: string;
}

function diasEntre(desdeIso: string, hastaIso: string): number {
  const a = Date.parse(`${desdeIso}T00:00:00Z`);
  const b = Date.parse(`${hastaIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

const BUCKETS: { label: string; max: number }[] = [
  { label: 'Al día (no vencido)', max: 0 },
  { label: '1 a 7 días', max: 7 },
  { label: '8 a 30 días', max: 30 },
  { label: '31 a 90 días', max: 90 },
  { label: 'Más de 90 días', max: Infinity },
];

export async function getDespachosData(): Promise<DespachosData> {
  const hoy = getArgentinaTodayIso();
  const meses = lastMonthKeys(6);

  const [rows, despachados30d, mensual] = await Promise.all([
    searchReadAll<PickingRow>({
      model: 'stock.picking',
      domain: [...OUTGOING, ['state', 'in', ['assigned', 'confirmed', 'waiting']]],
      fields: ['name', 'partner_id', 'origin', 'picking_type_id', 'state', 'scheduled_date'],
      order: 'scheduled_date asc',
    }),
    searchCount('stock.picking', [...OUTGOING, ['state', '=', 'done'], ['date_done', '>=', `${addDaysIso(hoy, -30)} 00:00:00`]]),
    Promise.all(
      meses.map(async (month) => {
        const { start, endExclusive } = monthBounds(month);
        const count = await searchCount('stock.picking', [
          ...OUTGOING,
          ['state', '=', 'done'],
          ['date_done', '>=', `${start} 00:00:00`],
          ['date_done', '<', `${endExclusive} 00:00:00`],
        ]);
        return { month, count };
      })
    ),
  ]);

  // Colchones y sillones (UE) pendientes: demanda de los movimientos de los pickings pendientes.
  const moves = await searchReadAll<MoveRow>({
    model: 'stock.move',
    domain: [
      ['picking_id.picking_type_id', '=', PICKING_TYPE_RECOLECTAR],
      ['picking_id.state', 'in', ['assigned', 'confirmed', 'waiting']],
      ['state', 'not in', ['done', 'cancel']],
    ],
    fields: ['picking_id', 'product_id', 'product_uom_qty'],
  });
  const productIds = [...new Set(moves.map((m) => m.product_id[0]))];
  const products = productIds.length
    ? await searchReadAll<ProductRow>({
        model: 'product.product',
        domain: [['id', 'in', productIds]],
        fields: ['x_studio_equivalente_produccion', 'categ_id'],
        context: { active_test: false },
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const porPicking = new Map<number, { colchones: number; sillonesEq: number }>();
  for (const m of moves) {
    if (!m.picking_id) continue;
    const prod = productById.get(m.product_id[0]);
    if (!prod) continue;
    const acc = porPicking.get(m.picking_id[0]) ?? { colchones: 0, sillonesEq: 0 };
    const categ = prod.categ_id[0];
    if (COLCHON_UNIDAD_CATEG_IDS.includes(categ)) acc.colchones += m.product_uom_qty;
    else if (LIVING_CATEG_IDS.includes(categ)) acc.sillonesEq += m.product_uom_qty * (prod.x_studio_equivalente_produccion || 0);
    porPicking.set(m.picking_id[0], acc);
  }

  const pendientes: DespachoPendiente[] = rows.map((r) => {
    const fecha = r.scheduled_date.slice(0, 10);
    const u = porPicking.get(r.id);
    return {
      colchones: u?.colchones ?? 0,
      sillonesEq: u?.sillonesEq ?? 0,
      id: r.id,
      name: r.name,
      cliente: r.partner_id ? r.partner_id[1] : '—',
      origen: r.origin || '—',
      almacen: r.picking_type_id ? r.picking_type_id[1].split(':')[0]! : '—',
      estado: r.state,
      fechaProgramada: fecha,
      diasAtraso: Math.max(0, diasEntre(fecha, hoy)),
    };
  });

  const porEstado: Record<DespachoEstado, number> = { assigned: 0, confirmed: 0, waiting: 0 };
  for (const p of pendientes) porEstado[p.estado]++;

  const antiguedad = BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const p of pendientes) {
    const idx = BUCKETS.findIndex((b) => p.diasAtraso <= b.max);
    antiguedad[idx]!.count++;
  }

  return {
    hoy,
    pendientes,
    porEstado,
    atrasados: pendientes.filter((p) => p.diasAtraso > 0).length,
    colchonesPendientes: pendientes.reduce((s, p) => s + p.colchones, 0),
    sillonesEqPendientes: pendientes.reduce((s, p) => s + p.sillonesEq, 0),
    antiguedad,
    despachados30d,
    despachadosMensual: mensual,
  };
}

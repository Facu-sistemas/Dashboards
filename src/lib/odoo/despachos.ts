import { searchCount, searchReadAll } from './client';
import { addDaysIso, lastMonthKeys, monthBounds } from '../date';
import { getArgentinaTodayIso } from './oee';
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
  antiguedad: DespachosAntiguedadBucket[];
  despachados30d: number;
  despachadosMensual: { month: string; count: number }[];
}

/** Remitos de salida (`stock.picking` outgoing) de todas las compañías/almacenes. */
const OUTGOING: OdooDomain = [['picking_type_code', '=', 'outgoing']];

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

  const pendientes: DespachoPendiente[] = rows.map((r) => {
    const fecha = r.scheduled_date.slice(0, 10);
    return {
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
    antiguedad,
    despachados30d,
    despachadosMensual: mensual,
  };
}

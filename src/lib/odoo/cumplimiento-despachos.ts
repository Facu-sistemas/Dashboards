import { searchReadAll } from './client';
import { addDaysIso, lastMonthKeys, monthBounds } from '../date';
import { getArgentinaTodayIso } from './oee';

export interface CumplimientoMes {
  month: string;
  total: number;
  aTiempo: number;
  /** % de despachos a tiempo (0–100); null si el mes no tuvo despachos. */
  pctATiempo: number | null;
  /** Demora promedio (días) solo de los despachos tardíos; null si no hubo ninguno. */
  demoraPromedioTardios: number | null;
}

export interface DespachoTardio {
  id: number;
  name: string;
  cliente: string;
  origen: string;
  fechaProgramada: string;
  fechaDespacho: string;
  diasDemora: number;
}

export interface DemoraBucket {
  label: string;
  count: number;
}

export interface CumplimientoData {
  hoy: string;
  meses: CumplimientoMes[];
  /** Ventana de los últimos 30 días. */
  ultimos30d: { total: number; aTiempo: number; pctATiempo: number | null };
  demora: DemoraBucket[];
  tardios: DespachoTardio[];
  tardiosDesde: string;
}

interface PickingRow extends Record<string, unknown> {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  origin: string | false;
  scheduled_date: string;
  date_done: string;
}

const ARGENTINA_UTC_OFFSET_MS = -3 * 3_600_000;
const TARDIOS_DIAS = 90;

/** Odoo guarda datetimes en UTC ("YYYY-MM-DD HH:MM:SS"); devuelve la fecha calendario en Argentina. */
function fechaArgentina(utc: string): string {
  const ms = Date.parse(`${utc.replace(' ', 'T')}Z`) + ARGENTINA_UTC_OFFSET_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

function diasEntre(desdeIso: string, hastaIso: string): number {
  return Math.round((Date.parse(`${hastaIso}T00:00:00Z`) - Date.parse(`${desdeIso}T00:00:00Z`)) / 86_400_000);
}

const BUCKETS: { label: string; max: number }[] = [
  { label: 'A tiempo (0 días o menos)', max: 0 },
  { label: '1 a 3 días de demora', max: 3 },
  { label: '4 a 7 días', max: 7 },
  { label: '8 a 14 días', max: 14 },
  { label: 'Más de 14 días', max: Infinity },
];

/**
 * Cumplimiento = remito de salida despachado (`done`) el mismo día de su
 * fecha programada o antes. La fecha programada de Odoo es el único
 * compromiso de entrega disponible: `sale.order.commitment_date` no se
 * carga (0 de 3.733 pedidos desde abril de 2026, pedido en vivo el
 * 2026-10-05). Se excluyen las devoluciones (origen "Devolución de …"),
 * que no son entregas a cliente.
 */
export async function getCumplimientoData(): Promise<CumplimientoData> {
  const hoy = getArgentinaTodayIso();
  const meses = lastMonthKeys(6);
  const desde = monthBounds(meses[0]!).start;

  const rows = await searchReadAll<PickingRow>({
    model: 'stock.picking',
    domain: [
      ['picking_type_code', '=', 'outgoing'],
      ['state', '=', 'done'],
      ['origin', 'not ilike', 'Devolución'],
      ['date_done', '>=', `${desde} 00:00:00`],
    ],
    fields: ['name', 'partner_id', 'origin', 'scheduled_date', 'date_done'],
    order: 'date_done desc',
  });

  const tardiosDesde = addDaysIso(hoy, -TARDIOS_DIAS);
  const desde30 = addDaysIso(hoy, -30);

  const porMes = new Map<string, { total: number; aTiempo: number; demoraTardios: number }>(
    meses.map((m) => [m, { total: 0, aTiempo: 0, demoraTardios: 0 }])
  );
  const ult30 = { total: 0, aTiempo: 0 };
  const demora = BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  const tardios: DespachoTardio[] = [];

  for (const r of rows) {
    const fechaProgramada = fechaArgentina(r.scheduled_date);
    const fechaDespacho = fechaArgentina(r.date_done);
    const diasDemora = diasEntre(fechaProgramada, fechaDespacho);
    const aTiempo = diasDemora <= 0;

    const bucket = porMes.get(fechaDespacho.slice(0, 7));
    if (bucket) {
      bucket.total++;
      if (aTiempo) bucket.aTiempo++;
      else bucket.demoraTardios += diasDemora;
    }

    if (fechaDespacho >= desde30) {
      ult30.total++;
      if (aTiempo) ult30.aTiempo++;
    }

    if (fechaDespacho >= tardiosDesde) {
      demora[BUCKETS.findIndex((b) => diasDemora <= b.max)]!.count++;
      if (!aTiempo) {
        tardios.push({
          id: r.id,
          name: r.name,
          cliente: r.partner_id ? r.partner_id[1] : '—',
          origen: r.origin || '—',
          fechaProgramada,
          fechaDespacho,
          diasDemora,
        });
      }
    }
  }

  const pct = (a: number, t: number) => (t > 0 ? (a / t) * 100 : null);

  return {
    hoy,
    meses: meses.map((month) => {
      const b = porMes.get(month)!;
      const tardiosCount = b.total - b.aTiempo;
      return {
        month,
        total: b.total,
        aTiempo: b.aTiempo,
        pctATiempo: pct(b.aTiempo, b.total),
        demoraPromedioTardios: tardiosCount > 0 ? b.demoraTardios / tardiosCount : null,
      };
    }),
    ultimos30d: { ...ult30, pctATiempo: pct(ult30.aTiempo, ult30.total) },
    demora,
    tardios,
    tardiosDesde,
  };
}

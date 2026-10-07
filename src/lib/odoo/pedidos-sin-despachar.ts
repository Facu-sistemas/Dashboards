import { searchReadAll } from './client';
import { getArgentinaTodayIso } from './oee';

export type EntregaEstado = 'pending' | 'started' | 'partial';

export interface PedidoSinDespachar {
  id: number;
  name: string;
  cliente: string;
  vendedor: string;
  fecha: string;
  diasEspera: number;
  estado: EntregaEstado;
  monto: number;
}

export interface EsperaBucket {
  label: string;
  count: number;
  monto: number;
}

export interface PedidosSinDespacharData {
  pedidos: PedidoSinDespachar[];
  montoTotal: number;
  porEstado: Record<EntregaEstado, number>;
  espera: EsperaBucket[];
  esperaPromedio: number;
  esperaMaxima: number;
}

interface OrderRow extends Record<string, unknown> {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  user_id: [number, string] | false;
  date_order: string;
  amount_total: number;
  delivery_status: EntregaEstado;
}

const ARGENTINA_UTC_OFFSET_MS = -3 * 3_600_000;

function fechaArgentina(utc: string): string {
  return new Date(Date.parse(`${utc.replace(' ', 'T')}Z`) + ARGENTINA_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function diasEntre(desdeIso: string, hastaIso: string): number {
  return Math.round((Date.parse(`${hastaIso}T00:00:00Z`) - Date.parse(`${desdeIso}T00:00:00Z`)) / 86_400_000);
}

const BUCKETS: { label: string; max: number }[] = [
  { label: 'Hasta 7 días', max: 7 },
  { label: '8 a 15 días', max: 15 },
  { label: '16 a 30 días', max: 30 },
  { label: '31 a 60 días', max: 60 },
  { label: 'Más de 60 días', max: Infinity },
];

/**
 * Backlog = `sale.order` confirmado (state='sale') cuya entrega no está
 * completa (`delivery_status` sin entregar / iniciada / parcial). Se dejan
 * afuera los pedidos sin estado de entrega (servicios o importe cero:
 * 112 con ~$13 M de 10.3 mil pedidos confirmados, pedido en vivo el
 * 2026-10-05). El monto es `amount_total` del pedido completo, así que en
 * los parcialmente entregados incluye lo ya despachado.
 */
export async function getPedidosSinDespacharData(): Promise<PedidosSinDespacharData> {
  const hoy = getArgentinaTodayIso();

  const rows = await searchReadAll<OrderRow>({
    model: 'sale.order',
    domain: [
      ['state', '=', 'sale'],
      ['delivery_status', 'in', ['pending', 'started', 'partial']],
    ],
    fields: ['name', 'partner_id', 'user_id', 'date_order', 'amount_total', 'delivery_status'],
    order: 'date_order asc',
  });

  const pedidos: PedidoSinDespachar[] = rows.map((r) => {
    const fecha = fechaArgentina(r.date_order);
    return {
      id: r.id,
      name: r.name,
      cliente: r.partner_id ? r.partner_id[1] : '—',
      vendedor: r.user_id ? r.user_id[1] : '—',
      fecha,
      diasEspera: Math.max(0, diasEntre(fecha, hoy)),
      estado: r.delivery_status,
      monto: r.amount_total,
    };
  });

  const porEstado: Record<EntregaEstado, number> = { pending: 0, started: 0, partial: 0 };
  const espera: EsperaBucket[] = BUCKETS.map((b) => ({ label: b.label, count: 0, monto: 0 }));
  let montoTotal = 0;
  let sumaDias = 0;
  let esperaMaxima = 0;

  for (const p of pedidos) {
    porEstado[p.estado]++;
    montoTotal += p.monto;
    sumaDias += p.diasEspera;
    esperaMaxima = Math.max(esperaMaxima, p.diasEspera);
    const b = espera[BUCKETS.findIndex((x) => p.diasEspera <= x.max)]!;
    b.count++;
    b.monto += p.monto;
  }

  return {
    pedidos,
    montoTotal,
    porEstado,
    espera,
    esperaPromedio: pedidos.length > 0 ? sumaDias / pedidos.length : 0,
    esperaMaxima,
  };
}

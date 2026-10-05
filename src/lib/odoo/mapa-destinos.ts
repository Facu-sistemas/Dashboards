import { searchReadAll } from './client';
import { addDaysIso } from '../date';
import { getArgentinaTodayIso } from './oee';

export type MapaModo = 'pendientes' | 'despachados';

export interface MapaPunto {
  lat: number;
  lng: number;
  ciudad: string;
  provincia: string;
  /** Pedidos (modo pendientes) o remitos (modo despachados) hacia este punto. */
  count: number;
  /** Monto total de los pedidos; solo en modo pendientes. */
  monto: number;
  /** Hasta 5 clientes, los de mayor cantidad primero. */
  clientes: string[];
}

export interface MapaProvincia {
  provincia: string;
  count: number;
  monto: number;
}

export interface MapaModoData {
  total: number;
  /** Operaciones cuyo destino no tiene coordenadas válidas (no se dibujan, sí cuentan en la tabla). */
  sinUbicacion: number;
  puntos: MapaPunto[];
  provincias: MapaProvincia[];
}

export interface MapaDestinosData {
  desde: string;
  pendientes: MapaModoData;
  despachados: MapaModoData;
}

const DIAS_DESPACHADOS = 90;

const PROVINCIAS = [
  'Buenos Aires',
  'Ciudad Autónoma de Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
];

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PROVINCIA_POR_CLAVE = new Map(PROVINCIAS.map((p) => [sinTildes(p), p]));

/**
 * Odoo trae las provincias como "Cordoba (AR)" / "Río Negro (UY)": se sacan
 * el sufijo de país y las tildes para unificar contra la lista canónica.
 * Hay clientes con la provincia de Uruguay ("Río Negro (UY)") cuyas
 * coordenadas caen en Argentina: se unifican con Río Negro de Argentina.
 */
export function normalizarProvincia(raw: string | undefined): string {
  if (!raw) return 'Sin provincia';
  const limpio = raw.replace(/\s*\([A-Z]{2}\)\s*$/, '').trim();
  return PROVINCIA_POR_CLAVE.get(sinTildes(limpio)) ?? limpio;
}

/** Coordenadas dentro de la caja que contiene Argentina continental, Tierra del Fuego e islas: descarta coordenadas en 0,0 o mal cargadas. */
function coordenadas(p: PartnerRow | undefined): { lat: number; lng: number } | null {
  const lat = p?.partner_latitude;
  const lng = p?.partner_longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return lat >= -56 && lat <= -21 && lng >= -74 && lng <= -53 ? { lat, lng } : null;
}

export interface PartnerRow extends Record<string, unknown> {
  id: number;
  name: string;
  state_id: [number, string] | false;
  city: string | false;
  partner_latitude: number | false;
  partner_longitude: number | false;
}

export async function getPartners(ids: number[]): Promise<Map<number, PartnerRow>> {
  const unicos = [...new Set(ids)];
  const rows: PartnerRow[] = [];
  const CHUNK = 1000;
  for (let i = 0; i < unicos.length; i += CHUNK) {
    rows.push(
      ...(await searchReadAll<PartnerRow>({
        model: 'res.partner',
        domain: [['id', 'in', unicos.slice(i, i + CHUNK)]],
        fields: ['name', 'state_id', 'city', 'partner_latitude', 'partner_longitude'],
        // Cubre también contactos archivados.
        context: { active_test: false },
      }))
    );
  }
  return new Map(rows.map((r) => [r.id, r]));
}

interface Operacion {
  partnerId: number;
  /** Cliente a mostrar (el de la operación, no el contacto de entrega). */
  cliente: string;
  monto: number;
}

function armarModo(ops: Operacion[], partners: Map<number, PartnerRow>): MapaModoData {
  const puntos = new Map<string, MapaPunto & { porCliente: Map<string, number> }>();
  const provincias = new Map<string, MapaProvincia>();
  let sinUbicacion = 0;

  for (const op of ops) {
    const p = partners.get(op.partnerId);
    const provincia = normalizarProvincia(p?.state_id ? p.state_id[1] : undefined);

    const prov = provincias.get(provincia) ?? { provincia, count: 0, monto: 0 };
    prov.count++;
    prov.monto += op.monto;
    provincias.set(provincia, prov);

    const coords = coordenadas(p);
    if (!p || !coords) {
      sinUbicacion++;
      continue;
    }

    // Agrupa por ~1 km (2 decimales) para no apilar un marcador por cliente de la misma ciudad.
    const { lat, lng } = coords;
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const punto = puntos.get(key) ?? {
      lat,
      lng,
      ciudad: p.city || '—',
      provincia,
      count: 0,
      monto: 0,
      clientes: [],
      porCliente: new Map<string, number>(),
    };
    punto.count++;
    punto.monto += op.monto;
    punto.porCliente.set(op.cliente, (punto.porCliente.get(op.cliente) ?? 0) + 1);
    puntos.set(key, punto);
  }

  return {
    total: ops.length,
    sinUbicacion,
    puntos: [...puntos.values()].map(({ porCliente, ...punto }) => ({
      ...punto,
      clientes: [...porCliente.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([nombre]) => nombre),
    })),
    provincias: [...provincias.values()].sort((a, b) => b.count - a.count),
  };
}

interface OrderRow extends Record<string, unknown> {
  partner_id: [number, string] | false;
  partner_shipping_id: [number, string] | false;
  amount_total: number;
}

interface PickingRow extends Record<string, unknown> {
  partner_id: [number, string] | false;
}

/**
 * Destino = dirección de entrega (`partner_shipping_id`) del pedido, o el
 * contacto del remito (`partner_id`) en los despachados. Pendientes: pedidos
 * confirmados con entrega incompleta (misma definición que "Pedidos sin
 * despachar"). Despachados: remitos de salida `done` de los últimos 90 días,
 * sin devoluciones. El 97 % de los destinos tiene lat/lng cargada en Odoo
 * (392 de 403 pedidos pendientes, pedido en vivo el 2026-10-05).
 */
export async function getMapaDestinosData(): Promise<MapaDestinosData> {
  const hoy = getArgentinaTodayIso();
  const desde = addDaysIso(hoy, -DIAS_DESPACHADOS);

  const [pedidos, remitos] = await Promise.all([
    searchReadAll<OrderRow>({
      model: 'sale.order',
      domain: [
        ['state', '=', 'sale'],
        ['delivery_status', 'in', ['pending', 'started', 'partial']],
      ],
      fields: ['partner_id', 'partner_shipping_id', 'amount_total'],
    }),
    searchReadAll<PickingRow>({
      model: 'stock.picking',
      domain: [
        ['picking_type_code', '=', 'outgoing'],
        ['state', '=', 'done'],
        ['origin', 'not ilike', 'Devolución'],
        ['date_done', '>=', `${desde} 00:00:00`],
      ],
      fields: ['partner_id'],
    }),
  ]);

  const opsPendientes: Operacion[] = [];
  for (const o of pedidos) {
    const destino = o.partner_shipping_id || o.partner_id;
    if (!destino) continue;
    opsPendientes.push({ partnerId: destino[0], cliente: o.partner_id ? o.partner_id[1] : destino[1], monto: o.amount_total });
  }
  const opsDespachados: Operacion[] = [];
  for (const r of remitos) {
    if (!r.partner_id) continue;
    opsDespachados.push({ partnerId: r.partner_id[0], cliente: r.partner_id[1], monto: 0 });
  }

  const partners = await getPartners([...opsPendientes, ...opsDespachados].map((o) => o.partnerId));

  return {
    desde,
    pendientes: armarModo(opsPendientes, partners),
    despachados: armarModo(opsDespachados, partners),
  };
}

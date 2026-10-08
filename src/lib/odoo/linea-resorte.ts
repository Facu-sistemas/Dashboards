import { searchReadAll, readGroup } from './client';
import { familiaDeProducto, medidaDeProducto, stripReferencePrefix } from '../linea-config';
import type { OrdenLinea } from '../linea-calc';
import type { OdooDomain } from './types';

/**
 * "Colchones Línea" — filtro guardado del usuario en Odoo: categorías
 * 21/22/18/19, estados pendientes y todo TAP menos las TAPA. Las familias de
 * TAP sin regla aparecen solas en el editor para asignarles mesas.
 * El tiempo de cada orden sale de `estimated_time` ("Tiempo estimado (hs)"):
 * es un campo computado NO almacenado, así que no se puede sumar con
 * read_group — se lee por orden y se suma acá.
 */
const LINEA_RESORTE_DOMAIN: OdooDomain = [
  '&',
  ['product_id.categ_id', 'in', [21, 22, 18, 19]],
  '&',
  ['product_id', 'ilike', 'TAP'],
  '&',
  ['product_id', 'not ilike', 'TAPA'],
  ['state', 'in', ['draft', 'confirmed', 'progress', 'to_close']],
];

/** Odoo's placeholder for "not scheduled yet" (mismo sentinel que odoo/vertical.ts). */
const SIN_AGENDAR_DATE = '2100-01-01';

export interface LineaDiaOption {
  date: string;
  label: string;
  count: number;
  sinAgendar: boolean;
}

function formatLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const label = d.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Cada día de planificación con órdenes pendientes de la línea, para el selector de día. */
export async function getLineaDias(): Promise<LineaDiaOption[]> {
  type DayGroup = { __count: number; __range?: Record<string, { from: string | false; to: string | false }> };
  const groups = await readGroup({
    model: 'mrp.production',
    domain: LINEA_RESORTE_DOMAIN,
    fields: ['id'],
    groupBy: ['planning_date:day'],
  });

  const options: LineaDiaOption[] = [];
  for (const g of groups as unknown as DayGroup[]) {
    const from = g.__range?.['planning_date:day']?.from;
    if (!from) continue;
    const date = from.slice(0, 10);
    const sinAgendar = date === SIN_AGENDAR_DATE;
    options.push({ date, label: sinAgendar ? 'Sin agendar' : formatLabel(date), count: g.__count, sinAgendar });
  }

  return options.sort((a, b) => {
    if (a.sinAgendar !== b.sinAgendar) return a.sinAgendar ? 1 : -1;
    return a.date.localeCompare(b.date);
  });
}

type OrdenRow = {
  name: string;
  product_id: [number, string];
  product_qty: number;
  estimated_time: number | false;
  state: string;
  planning_date: string | false;
};

const ORDEN_FIELDS = ['name', 'product_id', 'product_qty', 'estimated_time', 'state', 'planning_date'];

function toOrden(r: OrdenRow, dateIso: string): OrdenLinea {
  const fecha = r.planning_date ? r.planning_date.slice(0, 10) : dateIso;
  return {
    name: r.name,
    producto: stripReferencePrefix(r.product_id[1]),
    cantidad: r.product_qty,
    horas: r.estimated_time || 0,
    estado: r.state,
    fecha,
    origen: fecha < dateIso ? 'atrasado' : fecha > dateIso ? 'adelantado' : 'dia',
    fraccion: 1,
  };
}

/**
 * Cola de pendientes para planificar un día: TODO lo agendado que sigue
 * abierto en Odoo (lo anterior se arrastra; lo posterior se usa para
 * completar la jornada). "Sin agendar" no se mezcla: es solo su propia bolsa.
 */
export async function getLineaOrdenes(dateIso: string): Promise<OrdenLinea[]> {
  const rango: OdooDomain =
    dateIso === SIN_AGENDAR_DATE ? [['planning_date', '>=', SIN_AGENDAR_DATE]] : [['planning_date', '<', SIN_AGENDAR_DATE]];
  const rows = await searchReadAll<OrdenRow>({
    model: 'mrp.production',
    domain: [...LINEA_RESORTE_DOMAIN, ...rango],
    fields: ORDEN_FIELDS,
  });
  return rows.map((r) => toOrden(r, dateIso));
}

export interface MedidaDetectada {
  /** "140X190", '' si no se pudo leer del nombre. */
  medida: string;
  ordenes: number;
  unidades: number;
  horas: number;
}

export interface FamiliaDetectada {
  familia: string;
  ordenes: number;
  horas: number;
  ejemplos: string[];
  medidas: MedidaDetectada[];
}

/** Todas las familias de TAP con órdenes pendientes (cualquier día) — alimenta el editor de reglas. */
export async function getLineaFamilias(): Promise<FamiliaDetectada[]> {
  const rows = await searchReadAll<OrdenRow>({
    model: 'mrp.production',
    domain: LINEA_RESORTE_DOMAIN,
    fields: ORDEN_FIELDS,
  });

  const byFamilia = new Map<string, FamiliaDetectada>();
  for (const o of rows.map((r) => toOrden(r, SIN_AGENDAR_DATE))) {
    const familia = familiaDeProducto(o.producto);
    const f = byFamilia.get(familia) ?? { familia, ordenes: 0, horas: 0, ejemplos: [], medidas: [] };
    f.ordenes += 1;
    f.horas += o.horas;
    const medida = medidaDeProducto(o.producto);
    let m = f.medidas.find((x) => x.medida === medida);
    if (!m) {
      m = { medida, ordenes: 0, unidades: 0, horas: 0 };
      f.medidas.push(m);
    }
    m.ordenes += 1;
    m.unidades += o.cantidad;
    m.horas += o.horas;
    if (f.ejemplos.length < 3 && !f.ejemplos.includes(o.producto)) f.ejemplos.push(o.producto);
    byFamilia.set(familia, f);
  }
  for (const f of byFamilia.values()) f.medidas.sort((a, b) => a.medida.localeCompare(b.medida, 'es', { numeric: true }));
  return [...byFamilia.values()].sort((a, b) => a.familia.localeCompare(b.familia));
}

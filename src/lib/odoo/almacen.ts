import { searchRead, searchReadAll, searchCount } from './client';
import { withTtlCache, cacheKey } from '@/lib/cache';

/**
 * Warehouse rack cells follow `WH/Existencias/<RACK>.<COLUMN>.<LEVEL>`
 * (e.g. `F.3.E`) — confirmed live. Anything else under WH/Existencias
 * (PALLET.*, PICKING*, `C.6.A.CHINA`, stray slash-typo names, etc.) simply
 * doesn't match this pattern and is skipped, no exclusion list needed.
 */
const LOCATION_CODE_RE = /^([A-F])\.(\d{1,2})\.([A-F])$/;

const LAYOUT_TTL_MS = 10 * 60 * 1000;
const UBICACION_TTL_MS = 60 * 1000;
const MOVIMIENTOS_TTL_MS = 60 * 1000;
const MOVIMIENTOS_LIMIT = 10;

export interface RackColumnData {
  column: number;
  levels: string[];
}

export interface RackData {
  rack: string;
  columns: RackColumnData[];
}

export interface WarehouseLayout {
  racks: RackData[];
  occupiedCodes: string[];
}

export interface UbicacionProducto {
  producto: string;
  cantidad: number;
  unidad: string;
}

/**
 * Odoo's `uom.uom` names are mostly fine to show as-is (kg, m, m², L, t...)
 * but the "Unit" category record is named "Units" in English regardless of
 * app language — shorten just that one to match how the rest of this
 * Spanish UI reads.
 */
function formatUom(name: string): string {
  return name === 'Units' ? 'u' : name;
}

export interface UbicacionStockResult {
  codigo: string;
  productos: UbicacionProducto[];
}

/**
 * The real rack grid isn't a clean rectangle — confirmed live that level
 * sets vary per column within the same rack (e.g. Rack A columns 6-12 are
 * missing level B while columns 1-5 have it). So this reads every real
 * `stock.location` under WH/Existencias and reports exactly what exists,
 * rather than a hand-typed columns×levels table that would either point
 * clickable cells at locations that don't exist, or hide real ones.
 */
export async function getWarehouseLayout(): Promise<WarehouseLayout> {
  return withTtlCache('almacen:layout', LAYOUT_TTL_MS, async () => {
    const rows = await searchReadAll<{ id: number; name: string }>({
      model: 'stock.location',
      domain: [
        ['complete_name', 'like', 'WH/Existencias/%'],
        ['usage', '=', 'internal'],
      ],
      fields: ['id', 'name'],
    });

    const racks = new Map<string, Map<number, Set<string>>>();
    const codigoById = new Map<number, string>();
    for (const row of rows) {
      const match = LOCATION_CODE_RE.exec(row.name);
      if (!match) continue;
      codigoById.set(row.id, row.name);
      const rack = match[1]!;
      const column = Number(match[2]!);
      const level = match[3]!;
      let columns = racks.get(rack);
      if (!columns) {
        columns = new Map<number, Set<string>>();
        racks.set(rack, columns);
      }
      let levels = columns.get(column);
      if (!levels) {
        levels = new Set<string>();
        columns.set(column, levels);
      }
      levels.add(level);
    }

    // Bulk "does this cell have any stock" check, so the map can shade
    // occupied vs. empty cells without a request per cell — one extra
    // Odoo call, cached alongside the layout itself.
    const occupiedCodes: string[] = [];
    const locationIds = [...codigoById.keys()];
    if (locationIds.length > 0) {
      const quants = await searchReadAll<{ location_id: [number, string] }>({
        model: 'stock.quant',
        domain: [
          ['location_id', 'in', locationIds],
          ['quantity', '>', 0],
        ],
        fields: ['location_id'],
      });
      const occupiedIds = new Set(quants.map((q) => q.location_id[0]));
      for (const id of occupiedIds) {
        const codigo = codigoById.get(id);
        if (codigo) occupiedCodes.push(codigo);
      }
    }

    return {
      racks: [...racks.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([rack, columns]) => ({
          rack,
          columns: [...columns.entries()]
            .sort(([a], [b]) => a - b)
            .map(([column, levels]) => ({ column, levels: [...levels].sort() })),
        })),
      occupiedCodes,
    };
  });
}

/**
 * Sums `quantity` per product across every `stock.quant` row at a
 * location, rather than returning raw quant rows — confirmed live that
 * lots are used extensively here (2578/3284 quants under WH/Existencias
 * carry a lot_id), so a single product routinely has several quant rows
 * at the same location that need merging into one figure.
 */
export async function getUbicacionStock(codigo: string): Promise<UbicacionStockResult> {
  return withTtlCache(cacheKey('almacen:ubicacion', { codigo }), UBICACION_TTL_MS, async () => {
    const locations = await searchReadAll<{ id: number }>({
      model: 'stock.location',
      domain: [['complete_name', '=', `WH/Existencias/${codigo}`]],
      fields: ['id'],
      limit: 1,
    });
    const location = locations[0];
    if (!location) {
      return { codigo, productos: [] };
    }

    const quants = await searchReadAll<{ product_id: [number, string]; quantity: number; product_uom_id: [number, string] }>({
      model: 'stock.quant',
      domain: [['location_id', '=', location.id]],
      fields: ['product_id', 'quantity', 'product_uom_id'],
    });

    const byProduct = new Map<string, { cantidad: number; unidad: string }>();
    for (const q of quants) {
      const name = q.product_id[1];
      const existing = byProduct.get(name);
      if (existing) {
        existing.cantidad += q.quantity;
      } else {
        byProduct.set(name, { cantidad: q.quantity, unidad: formatUom(q.product_uom_id[1]) });
      }
    }

    const productos = [...byProduct.entries()]
      .map(([producto, { cantidad, unidad }]) => ({ producto, cantidad, unidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    return { codigo, productos };
  });
}

export interface MovimientoRow {
  id: number;
  producto: string;
  cantidad: number;
  unidad: string;
  origen: string;
  destino: string;
  /** ISO 8601 UTC timestamp — Odoo returns naive "YYYY-MM-DD HH:MM:SS" (implicitly UTC), converted here so the client can format it in the right timezone. */
  fecha: string;
}

/** Strips the `WH/` / `WH/Existencias/` prefix Odoo's `complete_name` always carries, down to the short code (rack cell, "Almacen 2") or remaining location name. */
function shortenLocation(name: string): string {
  return name.replace(/^WH\/(Existencias\/)?/, '');
}

/**
 * Last 10 completed (`state = 'done'`) `stock.move.line` rows touching
 * WH/Existencias, either as source or destination — confirmed live this
 * catches both movements into/out of the warehouse (vs. WH/PRE-PRODUCCION,
 * suppliers, etc.) and internal rack-to-rack transfers. Reads per move
 * line (not the aggregate `stock.move`) since that's what carries the
 * actual completed quantity and timestamp per lot.
 */
export async function getUltimosMovimientos(): Promise<MovimientoRow[]> {
  return withTtlCache('almacen:movimientos', MOVIMIENTOS_TTL_MS, async () => {
    type Row = {
      id: number;
      product_id: [number, string] | false;
      quantity: number;
      product_uom_id: [number, string] | false;
      location_id: [number, string] | false;
      location_dest_id: [number, string] | false;
      date: string;
    };
    const rows = await searchRead<Row>({
      model: 'stock.move.line',
      domain: [
        ['state', '=', 'done'],
        '|',
        ['location_id.complete_name', 'like', 'WH/Existencias/%'],
        ['location_dest_id.complete_name', 'like', 'WH/Existencias/%'],
      ],
      fields: ['product_id', 'quantity', 'product_uom_id', 'location_id', 'location_dest_id', 'date'],
      order: 'date desc',
      limit: MOVIMIENTOS_LIMIT,
    });

    return rows
      .filter((r): r is Row & { product_id: [number, string] } => Boolean(r.product_id))
      .map((r) => ({
        id: r.id,
        producto: r.product_id[1],
        cantidad: r.quantity,
        unidad: r.product_uom_id ? formatUom(r.product_uom_id[1]) : '',
        origen: r.location_id ? shortenLocation(r.location_id[1]) : '—',
        destino: r.location_dest_id ? shortenLocation(r.location_dest_id[1]) : '—',
        fecha: new Date(`${r.date.replace(' ', 'T')}Z`).toISOString(),
      }));
  });
}

// ---------------------------------------------------------------------------
// Historial de movimientos
// ---------------------------------------------------------------------------

export type HistorialRango = 'hoy' | '7d' | '30d' | '12m';
export const HISTORIAL_RANGOS: HistorialRango[] = ['hoy', '7d', '30d', '12m'];

export type MovimientoTipo = 'entrada' | 'salida' | 'interno';

export interface HistorialMovimiento {
  id: number;
  producto: string;
  cantidad: number;
  unidad: string;
  origen: string;
  destino: string;
  tipo: MovimientoTipo;
  fecha: string;
}

export interface HistorialBucket {
  /** Etiqueta ya formateada para el eje (hora, día o mes). */
  label: string;
  entradas: number;
  salidas: number;
  internos: number;
}

export interface HistorialTop {
  nombre: string;
  movimientos: number;
}

export interface HistorialResult {
  rango: HistorialRango;
  totales: { total: number; entradas: number; salidas: number; internos: number; productos: number; ubicaciones: number };
  /** Total del período anterior de igual largo, para mostrar la variación. */
  totalAnterior: number;
  serie: HistorialBucket[];
  /** [díaSemana 0=Lun..6=Dom][hora 0..23] → cantidad de movimientos. */
  heatmap: number[][];
  /** Movimientos por rack (A–F); lo que no es una celda de rack cae en "Otros". */
  porRack: HistorialTop[];
  topProductos: HistorialTop[];
  topUbicaciones: HistorialTop[];
  recientes: HistorialMovimiento[];
  /** true si se alcanzó el tope de filas leídas (los números serían un piso, no el total exacto). */
  truncado: boolean;
}

const HISTORIAL_TTL_MS = 2 * 60 * 1000;
const HISTORIAL_MAX_ROWS = 30000;
const HISTORIAL_RECIENTES = 2000;
const BA_OFFSET_MS = -3 * 60 * 60 * 1000; // Argentina no tiene horario de verano: UTC-3 fijo.
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Fecha "pared" de Buenos Aires: se lee con los getters UTC del Date desplazado. */
function toBA(utcMs: number): Date {
  return new Date(utcMs + BA_OFFSET_MS);
}

function odooDate(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 19).replace('T', ' ');
}

function startOfBADayUtc(utcMs: number): number {
  const ba = toBA(utcMs);
  return Date.UTC(ba.getUTCFullYear(), ba.getUTCMonth(), ba.getUTCDate()) - BA_OFFSET_MS;
}

function rangoInicio(rango: HistorialRango, now: number): { inicio: number; inicioAnterior: number } {
  const hoy = startOfBADayUtc(now);
  if (rango === 'hoy') return { inicio: hoy, inicioAnterior: hoy - DAY_MS };
  if (rango === '7d') return { inicio: hoy - 6 * DAY_MS, inicioAnterior: hoy - 13 * DAY_MS };
  if (rango === '30d') return { inicio: hoy - 29 * DAY_MS, inicioAnterior: hoy - 59 * DAY_MS };
  const ba = toBA(now);
  return {
    inicio: Date.UTC(ba.getUTCFullYear(), ba.getUTCMonth() - 11, 1) - BA_OFFSET_MS,
    inicioAnterior: Date.UTC(ba.getUTCFullYear(), ba.getUTCMonth() - 23, 1) - BA_OFFSET_MS,
  };
}

function esInterna(nombre: string): boolean {
  return nombre.startsWith('WH/Existencias/');
}

function rackDe(codigo: string): string {
  const m = LOCATION_CODE_RE.exec(codigo);
  return m ? `Rack ${m[1]}` : 'Otros';
}

function topN(map: Map<string, number>, n: number): HistorialTop[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([nombre, movimientos]) => ({ nombre, movimientos }));
}

/**
 * Agrega los `stock.move.line` terminados que tocan WH/Existencias en el
 * período pedido. Clasifica cada uno como entrada (viene de fuera del
 * depósito), salida (va hacia afuera) o interno (rack ↔ rack). Se cuentan
 * *movimientos*, no cantidades, porque las unidades se mezclan (kg, m, u...).
 * También cuenta el período anterior de igual largo, solo para el comparativo.
 */
export async function getHistorialMovimientos(rango: HistorialRango): Promise<HistorialResult> {
  return withTtlCache(cacheKey('almacen:historial', { rango }), HISTORIAL_TTL_MS, async () => {
    type Row = {
      id: number;
      product_id: [number, string] | false;
      quantity: number;
      product_uom_id: [number, string] | false;
      location_id: [number, string] | false;
      location_dest_id: [number, string] | false;
      date: string;
    };
    const now = Date.now();
    const { inicio, inicioAnterior } = rangoInicio(rango, now);

    const baseDomain = [
      ['state', '=', 'done'],
      '|',
      ['location_id.complete_name', 'like', 'WH/Existencias/%'],
      ['location_dest_id.complete_name', 'like', 'WH/Existencias/%'],
    ];

    const [allRows, totalAnterior] = await Promise.all([
      searchReadAll<Row>({
        model: 'stock.move.line',
        domain: [...baseDomain, ['date', '>=', odooDate(inicio)]] as never,
        fields: ['product_id', 'quantity', 'product_uom_id', 'location_id', 'location_dest_id', 'date'],
        order: 'date desc',
        limit: 5000,
      }),
      searchCount('stock.move.line', [...baseDomain, ['date', '>=', odooDate(inicioAnterior)], ['date', '<', odooDate(inicio)]] as never),
    ]);
    const rows = allRows.slice(0, HISTORIAL_MAX_ROWS);

    // Eje de la serie: horas (hoy), días (7d/30d) o meses (12m), con los huecos en cero.
    const bucketKey = (utcMs: number): { key: string; label: string } => {
      const ba = toBA(utcMs);
      if (rango === 'hoy') {
        const h = ba.getUTCHours();
        return { key: String(h), label: `${String(h).padStart(2, '0')}h` };
      }
      if (rango === '12m') return { key: `${ba.getUTCFullYear()}-${ba.getUTCMonth()}`, label: MESES[ba.getUTCMonth()]! };
      const d = ba.getUTCDate();
      return {
        key: `${ba.getUTCFullYear()}-${ba.getUTCMonth()}-${d}`,
        label: `${String(d).padStart(2, '0')}/${String(ba.getUTCMonth() + 1).padStart(2, '0')}`,
      };
    };
    const buckets = new Map<string, HistorialBucket>();
    const empty = (label: string): HistorialBucket => ({ label, entradas: 0, salidas: 0, internos: 0 });
    if (rango === 'hoy') {
      for (let h = 0; h < 24; h++) buckets.set(String(h), empty(`${String(h).padStart(2, '0')}h`));
    } else if (rango === '12m') {
      const ba = toBA(now);
      for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(ba.getUTCFullYear(), ba.getUTCMonth() - i, 1));
        buckets.set(`${d.getUTCFullYear()}-${d.getUTCMonth()}`, empty(MESES[d.getUTCMonth()]!));
      }
    } else {
      const dias = rango === '7d' ? 7 : 30;
      const hoy = startOfBADayUtc(now);
      for (let i = dias - 1; i >= 0; i--) {
        const { key, label } = bucketKey(hoy - i * DAY_MS + 12 * 60 * 60 * 1000);
        buckets.set(key, empty(label));
      }
    }

    const heatmap: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const totales = { total: 0, entradas: 0, salidas: 0, internos: 0, productos: 0, ubicaciones: 0 };
    const productos = new Map<string, number>();
    const ubicaciones = new Map<string, number>();
    const racks = new Map<string, number>();
    const recientes: HistorialMovimiento[] = [];

    for (const r of rows) {
      if (!r.product_id) continue;
      const origenFull = r.location_id ? r.location_id[1] : '';
      const destinoFull = r.location_dest_id ? r.location_dest_id[1] : '';
      const origenIn = esInterna(origenFull);
      const destinoIn = esInterna(destinoFull);
      const tipo: MovimientoTipo = origenIn && destinoIn ? 'interno' : destinoIn ? 'entrada' : 'salida';
      const utcMs = new Date(`${r.date.replace(' ', 'T')}Z`).getTime();
      const ba = toBA(utcMs);

      totales.total++;
      if (tipo === 'entrada') totales.entradas++;
      else if (tipo === 'salida') totales.salidas++;
      else totales.internos++;

      const b = buckets.get(bucketKey(utcMs).key);
      if (b) {
        if (tipo === 'entrada') b.entradas++;
        else if (tipo === 'salida') b.salidas++;
        else b.internos++;
      }

      const dow = (ba.getUTCDay() + 6) % 7; // 0 = lunes
      heatmap[dow]![ba.getUTCHours()]!++;

      productos.set(r.product_id[1], (productos.get(r.product_id[1]) ?? 0) + 1);
      // La "ubicación tocada" es la celda del depósito involucrada (destino si entra, origen si sale).
      const celda = shortenLocation(destinoIn ? destinoFull : origenFull);
      if (celda) {
        ubicaciones.set(celda, (ubicaciones.get(celda) ?? 0) + 1);
        const rack = rackDe(celda);
        racks.set(rack, (racks.get(rack) ?? 0) + 1);
      }

      if (recientes.length < HISTORIAL_RECIENTES) {
        recientes.push({
          id: r.id,
          producto: r.product_id[1],
          cantidad: r.quantity,
          unidad: r.product_uom_id ? formatUom(r.product_uom_id[1]) : '',
          origen: origenFull ? shortenLocation(origenFull) : '—',
          destino: destinoFull ? shortenLocation(destinoFull) : '—',
          tipo,
          fecha: new Date(utcMs).toISOString(),
        });
      }
    }

    totales.productos = productos.size;
    totales.ubicaciones = ubicaciones.size;

    return {
      rango,
      totales,
      totalAnterior,
      serie: [...buckets.values()],
      heatmap,
      porRack: [...racks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([nombre, movimientos]) => ({ nombre, movimientos })),
      topProductos: topN(productos, 6),
      topUbicaciones: topN(ubicaciones, 8),
      recientes,
      truncado: allRows.length >= HISTORIAL_MAX_ROWS,
    };
  });
}

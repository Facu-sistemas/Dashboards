import { searchReadAll } from './client';
import { withTtlCache } from '@/lib/cache';
import { addDaysIso, monthBounds } from '@/lib/date';
import { getArgentinaTodayIso } from './oee';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS } from './oee';
import { getBusinessDayChecker, getDiasHabiles } from './business-calendar';
import { getFacturacionGerencia } from './facturacion-gerencia';

/**
 * "Avance de carga" (Logística) — réplica dinámica del tablero operativo de
 * planta del equipo de logística. Todo en **m³** (`product.product.volume`),
 * no en m²: Odoo no tiene ningún campo de m², y la captura del tablero de
 * referencia mide m³.
 *
 * Criterio diario (idéntico al del tablero de referencia): movimientos
 * `stock.move` de `WH/Existencias` → `WH/Salida` (tipo de operación
 * "Recolectar", WH/PICK) contabilizados únicamente en estado Hecho, fechados
 * por la "Fecha efectiva" del picking (`stock.picking.date_done`, hora
 * Argentina). Cuenta todos los productos con volumen (no solo colchones y
 * living) para coincidir con lo que muestra logística; los que no tienen
 * volumen cargado (scrap, servicios, materia prima) suman 0.
 *
 * Objetivo diario (m³): el objetivo mensual de facturación consensuado
 * (colchones en unidades, sillones en UE — mismo tablero de gestión que usa
 * Gerencia General) se convierte a m³ con el m³ promedio por unidad real de
 * los últimos {PROMEDIO_MESES} meses cerrados, y se divide por los días
 * hábiles del mes (calendario laboral de Odoo). El m³ por colchón incluye
 * las bases/espumas que viajan con él; el m³ por UE de sillón sale de
 * dividir el volumen de living por sus unidades equivalentes.
 *
 * Jornada: lunes a viernes 6:00 a 14:18 según el calendario laboral de la
 * compañía en Odoo ("Jornada de Frontera Living S.A"; confirmado 2026-10-16).
 */

const EXISTENCIAS = 'WH/Existencias';
const SALIDA = 'WH/Salida';
const PICKING_TYPE_RECOLECTAR = 3;
const ARG_UTC_OFFSET_H = 3; // Argentina = UTC-3, sin horario de verano
const PROMEDIO_MESES = 3;
const JORNADA_INICIO_H = 6;
const JORNADA_FIN_H = 14.3;
const TTL_MS = 2 * 60 * 1000;
const BASE_TTL_MS = 6 * 60 * 60 * 1000;
/** Objetivo de eficiencia mensual (cargado / capacidad acumulada), el mismo 95% del tablero de referencia. */
const EFICIENCIA_OBJETIVO_PCT = 95;
/** Categorías cuyos movimientos cuentan como "colchón" (unidad) — Bases (8) viaja con el colchón, aporta m³ pero no unidades. */
const COLCHON_UNIDAD_CATEG_IDS = [5, 9, 6, 20];

export interface CargaDia {
  fecha: string;
  m3: number;
  pickings: number;
}

export interface CargaLogisticaResult {
  hoy: string;
  /** Hora actual Argentina en horas decimales (14.5 = 14:30). */
  horaActual: number;
  jornada: { inicio: number; fin: number };
  esDiaHabil: boolean;
  m3Hoy: number;
  pickingsHoy: number;
  objetivoDia: number;
  /** Cuánto debería llevar cargado a esta hora según la fracción de jornada transcurrida. */
  objetivoAEstaHora: number;
  faltaHoy: number;
  horasRestantes: number;
  ritmoNecesarioM3h: number;
  diasHabilesMes: number;
  /** Días hábiles ya cerrados del mes (sin contar hoy). */
  diasHabilesCerrados: number;
  m3Mes: number;
  capacidadAcumulada: number;
  eficienciaPct: number | null;
  eficienciaObjetivoPct: number;
  objetivoMensualM3: number;
  porDia: CargaDia[];
  facturacion: {
    colchones: { real: number; objetivo: number };
    sillonesUE: { real: number; objetivo: number };
  };
  /** m³ por unidad usados para convertir el objetivo en unidades a m³ — transparencia del cálculo. */
  conversion: { m3PorColchon: number; m3PorUeSillon: number; mesesBase: string[] };
}

interface MoveRow extends Record<string, unknown> {
  product_id: [number, string];
  quantity: number;
  picking_id: [number, string] | false;
}
interface PickingRow extends Record<string, unknown> {
  id: number;
  date_done: string | false;
}
interface ProductRow extends Record<string, unknown> {
  id: number;
  volume: number;
  x_studio_equivalente_produccion: number;
  categ_id: [number, string];
}

/** "YYYY-MM-DD HH:MM:SS" (UTC, como lo devuelve Odoo) → { fecha, hora } en hora Argentina. */
function toArgentina(utc: string): { fecha: string; hora: number } {
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  const local = new Date(d.getTime() - ARG_UTC_OFFSET_H * 3_600_000);
  return { fecha: local.toISOString().slice(0, 10), hora: local.getUTCHours() + local.getUTCMinutes() / 60 };
}

/** Fecha local Argentina "YYYY-MM-DD" → límite inferior en UTC para filtrar `date_done` (que Odoo guarda en UTC). */
function localDayStartUtc(iso: string): string {
  return `${iso} 0${ARG_UTC_OFFSET_H}:00:00`;
}

function nowArgentinaHour(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}

async function locationId(completeName: string): Promise<number> {
  const rows = await searchReadAll<{ id: number }>({
    model: 'stock.location',
    domain: [['complete_name', '=', completeName]],
    fields: ['id'],
    limit: 1,
  });
  if (!rows[0]) throw new Error(`No se encontró la ubicación "${completeName}" en Odoo`);
  return rows[0].id;
}

interface MoveAgg {
  /** m³ por día (clave "YYYY-MM-DD") y cantidad de pickings distintos. */
  m3PorDia: Map<string, number>;
  pickingsPorDia: Map<string, Set<number>>;
  /** Por mes "YYYY-MM": m³ de colchones (incl. bases), unidades de colchón, m³ de living, UE de living. */
  porMes: Map<string, { m3Colchon: number; unidadesColchon: number; m3Living: number; ueLiving: number }>;
}

async function loadMoves(desde: string, hastaExclusive: string): Promise<MoveAgg> {
  const [origenId, destinoId] = await Promise.all([locationId(EXISTENCIAS), locationId(SALIDA)]);
  const desdeUtc = localDayStartUtc(desde);
  const hastaUtc = localDayStartUtc(hastaExclusive);

  const [pickings, moves] = await Promise.all([
    searchReadAll<PickingRow>({
      model: 'stock.picking',
      domain: [['picking_type_id', '=', PICKING_TYPE_RECOLECTAR], ['state', '=', 'done'], ['date_done', '>=', desdeUtc], ['date_done', '<', hastaUtc]],
      fields: ['date_done'],
    }),
    searchReadAll<MoveRow>({
      model: 'stock.move',
      domain: [
        ['state', '=', 'done'],
        ['location_id', '=', origenId],
        ['location_dest_id', '=', destinoId],
        ['picking_id.date_done', '>=', desdeUtc],
        ['picking_id.date_done', '<', hastaUtc],
      ],
      fields: ['product_id', 'quantity', 'picking_id'],
    }),
  ]);

  const fechaPorPicking = new Map<number, string>();
  for (const p of pickings) if (p.date_done) fechaPorPicking.set(p.id, toArgentina(p.date_done).fecha);

  const productIds = [...new Set(moves.map((m) => m.product_id[0]))];
  const products = productIds.length
    ? await searchReadAll<ProductRow>({
        model: 'product.product',
        domain: [['id', 'in', productIds]],
        fields: ['volume', 'x_studio_equivalente_produccion', 'categ_id'],
        context: { active_test: false },
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const agg: MoveAgg = { m3PorDia: new Map(), pickingsPorDia: new Map(), porMes: new Map() };
  for (const m of moves) {
    if (!m.picking_id) continue;
    const fecha = fechaPorPicking.get(m.picking_id[0]);
    const prod = productById.get(m.product_id[0]);
    if (!fecha || !prod) continue;

    const m3 = m.quantity * (prod.volume || 0);
    agg.m3PorDia.set(fecha, (agg.m3PorDia.get(fecha) ?? 0) + m3);
    if (!agg.pickingsPorDia.has(fecha)) agg.pickingsPorDia.set(fecha, new Set());
    agg.pickingsPorDia.get(fecha)!.add(m.picking_id[0]);

    const mes = fecha.slice(0, 7);
    const acc = agg.porMes.get(mes) ?? { m3Colchon: 0, unidadesColchon: 0, m3Living: 0, ueLiving: 0 };
    const categ = prod.categ_id[0];
    if (COLCHONES_CATEG_IDS.includes(categ)) {
      acc.m3Colchon += m3;
      if (COLCHON_UNIDAD_CATEG_IDS.includes(categ)) acc.unidadesColchon += m.quantity;
    } else if (LIVING_CATEG_IDS.includes(categ)) {
      acc.m3Living += m3;
      acc.ueLiving += m.quantity * (prod.x_studio_equivalente_produccion || 0);
    }
    agg.porMes.set(mes, acc);
  }
  return agg;
}

function monthKeysBefore(monthKey: string, count: number): string[] {
  const [y, m] = monthKey.split('-').map(Number);
  const keys: string[] = [];
  for (let i = count; i >= 1; i--) {
    const d = new Date(Date.UTC(y!, m! - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

export function getCargaLogistica(): Promise<CargaLogisticaResult> {
  return withTtlCache('logistica:carga', TTL_MS, compute);
}

async function compute(): Promise<CargaLogisticaResult> {
  const hoy = getArgentinaTodayIso();
  const monthKey = hoy.slice(0, 7);
  const year = Number(hoy.slice(0, 4));
  const monthIdx = Number(hoy.slice(5, 7)) - 1;
  const { start: mesInicio, endExclusive: mesFin } = monthBounds(monthKey);
  const mesesBase = monthKeysBefore(monthKey, PROMEDIO_MESES);
  const baseInicio = monthBounds(mesesBase[0]!).start;

  const [agg, baseAgg, esHabil, dias, facturacion] = await Promise.all([
    loadMoves(mesInicio, mesFin),
    // Los meses cerrados no cambian: el promedio m³/unidad se recalcula cada tanto, no en cada refresco.
    withTtlCache(`logistica:carga:base:${monthKey}`, BASE_TTL_MS, () => loadMoves(baseInicio, mesInicio)),
    getBusinessDayChecker(),
    getDiasHabiles(year),
    getFacturacionGerencia(),
  ]);

  // m³ por unidad: promedio ponderado de los meses cerrados previos.
  const base = mesesBase.reduce(
    (a, k) => {
      const r = baseAgg.porMes.get(k);
      if (!r) return a;
      return {
        m3Colchon: a.m3Colchon + r.m3Colchon,
        unidadesColchon: a.unidadesColchon + r.unidadesColchon,
        m3Living: a.m3Living + r.m3Living,
        ueLiving: a.ueLiving + r.ueLiving,
      };
    },
    { m3Colchon: 0, unidadesColchon: 0, m3Living: 0, ueLiving: 0 }
  );
  const m3PorColchon = base.unidadesColchon > 0 ? base.m3Colchon / base.unidadesColchon : 0;
  const m3PorUeSillon = base.ueLiving > 0 ? base.m3Living / base.ueLiving : 0;

  const objColchones = facturacion.objetivo.colchones[monthIdx] ?? 0;
  const objSillones = facturacion.objetivo.sillones[monthIdx] ?? 0;
  const objetivoMensualM3 = objColchones * m3PorColchon + objSillones * m3PorUeSillon;

  const diasHabilesMes = dias.diasTotal[monthIdx] ?? 0;
  const objetivoDiario = diasHabilesMes > 0 ? objetivoMensualM3 / diasHabilesMes : 0;

  // Días del mes hasta hoy, con su m³ real.
  const porDia: CargaDia[] = [];
  for (let d = mesInicio; d <= hoy; d = addDaysIso(d, 1)) {
    porDia.push({ fecha: d, m3: agg.m3PorDia.get(d) ?? 0, pickings: agg.pickingsPorDia.get(d)?.size ?? 0 });
  }
  const m3Mes = porDia.reduce((a, d) => a + d.m3, 0);
  const hoyRow = porDia[porDia.length - 1];
  const m3Hoy = hoyRow?.m3 ?? 0;

  const diaHabilHoy = esHabil(hoy);
  const horaActual = nowArgentinaHour();
  const fraccion = !diaHabilHoy
    ? 0
    : Math.min(1, Math.max(0, (horaActual - JORNADA_INICIO_H) / (JORNADA_FIN_H - JORNADA_INICIO_H)));
  const objetivoDia = diaHabilHoy ? objetivoDiario : 0;
  const objetivoAEstaHora = objetivoDia * fraccion;
  const faltaHoy = Math.max(0, objetivoDia - m3Hoy);
  const horasRestantes = diaHabilHoy ? Math.max(0, JORNADA_FIN_H - Math.max(horaActual, JORNADA_INICIO_H)) : 0;

  // Capacidad KPI acumulada: objetivo diario por cada día hábil cerrado + la parte de hoy ya transcurrida.
  const diasHabilesCerrados = diasHabilesEntre(mesInicio, hoy, esHabil);
  const capacidadAcumulada = objetivoDiario * (diasHabilesCerrados + fraccion);

  return {
    hoy,
    horaActual,
    jornada: { inicio: JORNADA_INICIO_H, fin: JORNADA_FIN_H },
    esDiaHabil: diaHabilHoy,
    m3Hoy,
    pickingsHoy: hoyRow?.pickings ?? 0,
    objetivoDia,
    objetivoAEstaHora,
    faltaHoy,
    horasRestantes,
    ritmoNecesarioM3h: horasRestantes > 0 ? faltaHoy / horasRestantes : 0,
    diasHabilesMes,
    diasHabilesCerrados,
    m3Mes,
    capacidadAcumulada,
    eficienciaPct: capacidadAcumulada > 0 ? (m3Mes / capacidadAcumulada) * 100 : null,
    eficienciaObjetivoPct: EFICIENCIA_OBJETIVO_PCT,
    objetivoMensualM3,
    porDia,
    facturacion: {
      colchones: { real: facturacion.real.colchonesCant[monthIdx] ?? 0, objetivo: objColchones },
      sillonesUE: { real: facturacion.real.sillonesUE[monthIdx] ?? 0, objetivo: objSillones },
    },
    conversion: { m3PorColchon, m3PorUeSillon, mesesBase },
  };
}

/** Días hábiles del mes anteriores a `hoy` (hoy no cuenta, se suma aparte como fracción de jornada). */
function diasHabilesEntre(desde: string, hoy: string, esHabil: (iso: string) => boolean): number {
  let n = 0;
  for (let d = desde; d < hoy; d = addDaysIso(d, 1)) if (esHabil(d)) n++;
  return n;
}

import type { CarteraClientesData, CarteraRecord } from '../../lib/odoo/cartera-clientes';

export type Estado = 'Activo' | 'Dormido' | 'Perdido' | 'Nuevo';
export type Categoria = 'A' | 'B' | 'C';
export type ParetoMode = '6' | '12' | 'ytd' | 'all';

export interface Controles {
  cutoffStr: string;
  periodoActivo: number;
  montoMinimo: number;
  umbralDormido: number;
  paretoMode: ParetoMode;
  compareDays: number;
}

export const CONTROLES_DEFAULT: Omit<Controles, 'cutoffStr'> = {
  periodoActivo: 90,
  montoMinimo: 10_000_000,
  umbralDormido: 180,
  paretoMode: 'all',
  compareDays: 180,
};

export interface ClienteStat {
  ci: number;
  lastDate: string;
  firstDate: string;
  daysSince: number;
  paretoTotal: number;
  activoWindowTotal: number;
  nOrdersTotal: number;
  estado: Estado;
  isNew: boolean;
  esActivoRentable: boolean;
  vendor: number;
  cat: Categoria;
}

export interface Snapshot {
  clientStats: ClienteStat[];
  byCi: Map<number, ClienteStat>;
  totalSales: number;
  pStart: string;
}

const dstr = (d: Date) => d.toISOString().slice(0, 10);
const parseD = (s: string) => new Date(s + 'T00:00:00');
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/** Keeps only records whose company is in `companyIdxs` — applied before `groupByClient` so every downstream calc (snapshot, Pareto, ISC) reflects just the selected company/companies. */
export function filterRecordsByCompanies(records: CarteraRecord[], companyIdxs: Set<number>): CarteraRecord[] {
  return records.filter((r) => companyIdxs.has(r[5]));
}

/** Groups raw records by client, sorted ascending by date — built once per dataset. */
export function groupByClient(records: CarteraRecord[]): Map<number, CarteraRecord[]> {
  const byClient = new Map<number, CarteraRecord[]>();
  for (const r of records) {
    if (!byClient.has(r[0])) byClient.set(r[0], []);
    byClient.get(r[0])!.push(r);
  }
  for (const arr of byClient.values()) arr.sort((a, b) => (a[1] < b[1] ? -1 : 1));
  return byClient;
}

function paretoWindowStart(cutoffStr: string, mode: ParetoMode, minDate: string): string {
  if (mode === 'all') return minDate;
  if (mode === 'ytd') return cutoffStr.slice(0, 4) + '-01-01';
  const cutoff = parseD(cutoffStr);
  const start = new Date(cutoff);
  start.setMonth(start.getMonth() - parseInt(mode, 10));
  return dstr(start);
}

export function computeSnapshot(
  byClient: Map<number, CarteraRecord[]>,
  minDate: string,
  cutoffStr: string,
  periodoActivo: number,
  montoMinimo: number,
  umbralDormido: number,
  paretoMode: ParetoMode
): Snapshot {
  const cutoff = parseD(cutoffStr);
  const pStart = paretoWindowStart(cutoffStr, paretoMode, minDate);

  const clientStats: Omit<ClienteStat, 'cat'>[] = [];
  for (const [ci, arr] of byClient.entries()) {
    const upTo = arr.filter((r) => r[1] <= cutoffStr);
    if (upTo.length === 0) continue;
    const lastDate = upTo[upTo.length - 1]![1];
    const firstDate = upTo[0]![1];
    const daysSince = daysBetween(parseD(lastDate), cutoff);
    const daysSinceFirst = daysBetween(parseD(firstDate), cutoff);

    let paretoTotal = 0;
    let activoWindowTotal = 0;
    let nOrdersTotal = 0;
    for (const r of upTo) {
      nOrdersTotal += r[4];
      if (r[1] >= pStart) paretoTotal += r[2];
      if (daysBetween(parseD(r[1]), cutoff) <= periodoActivo) activoWindowTotal += r[2];
    }

    const isNew = daysSinceFirst <= periodoActivo;
    let estado: Estado;
    if (isNew) estado = 'Nuevo';
    else if (daysSince <= periodoActivo) estado = 'Activo';
    else if (daysSince <= umbralDormido) estado = 'Dormido';
    else estado = 'Perdido';

    const esActivoRentable = daysSince <= periodoActivo && activoWindowTotal >= montoMinimo;

    clientStats.push({
      ci,
      lastDate,
      firstDate,
      daysSince,
      paretoTotal,
      activoWindowTotal,
      nOrdersTotal,
      estado,
      isNew,
      esActivoRentable,
      vendor: upTo[upTo.length - 1]![3],
    });
  }

  const withSales = clientStats.filter((c) => c.paretoTotal > 0).sort((a, b) => b.paretoTotal - a.paretoTotal);
  const totalSales = withSales.reduce((s, c) => s + c.paretoTotal, 0);
  const catByCi = new Map<number, Categoria>();
  let cum = 0;
  for (const c of withSales) {
    cum += c.paretoTotal;
    const share = totalSales > 0 ? cum / totalSales : 1;
    catByCi.set(c.ci, share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C');
  }

  const withCat: ClienteStat[] = clientStats.map((c) => ({ ...c, cat: catByCi.get(c.ci) ?? 'C' }));
  const byCi = new Map(withCat.map((c) => [c.ci, c]));
  return { clientStats: withCat, totalSales, pStart, byCi };
}

/** Clientes con recencia + monto mínimo ("Activo Rentable") en estado Activo o Nuevo — el "Cliente Activo" oficial del tablero. */
export function activosRentables(snap: Snapshot): ClienteStat[] {
  return snap.clientStats.filter((c) => (c.estado === 'Activo' || c.estado === 'Nuevo') && c.esActivoRentable);
}

/* ================= ISC ================= */

const ISC_WEIGHTS: Record<string, number> = {
  AA: 100, AB: 60, AC: 30,
  DA: 50, DB: 20, DC: 10,
  NA: 100, NB: 60, NC: 30,
  Amax: 100, Bmax: 60, Cmax: 30,
};
export const ISC_TARGET = 0.8;

export function isc(snap: Snapshot): number {
  let score = 0;
  let max = 0;
  for (const c of snap.clientStats) {
    max += ISC_WEIGHTS[c.cat + 'max']!;
    if (c.estado === 'Perdido') continue;
    score += ISC_WEIGHTS[c.estado[0] + c.cat] ?? 0;
  }
  return max > 0 ? score / max : 0;
}

/* ================= movimiento ================= */

export type Movimiento = 'Recuperado' | 'Nuevo (primera compra)' | 'Caído' | 'Sin cambio' | 'Sin comparación';

export function computeMovimiento(c: ClienteStat, prevByCi: Map<number, ClienteStat>): Movimiento {
  const p = prevByCi.get(c.ci);
  const wasActive = !!p && (p.estado === 'Activo' || p.estado === 'Nuevo');
  const isActive = c.estado === 'Activo' || c.estado === 'Nuevo';

  if (!p) return c.estado === 'Nuevo' ? 'Nuevo (primera compra)' : 'Sin comparación';
  if (!wasActive && isActive) return 'Recuperado';
  if (wasActive && !isActive) return 'Caído';
  if (c.estado === 'Nuevo') return 'Nuevo (primera compra)';
  return 'Sin cambio';
}

/* ================= trailing monthly snapshots ================= */

export interface TrailingPoint {
  label: string; // YYYY-MM
  ds: string;
  snap: Snapshot;
}

/** 12 trailing monthly snapshots ending at `cutoffStr`, skipping months before `umbralDormido` days have elapsed since the dataset's first record (before that, "Perdido" is mathematically impossible and would inflate ISC/activos). */
export function trailingSnapshots(
  byClient: Map<number, CarteraRecord[]>,
  minDate: string,
  controles: Controles
): TrailingPoint[] {
  const warmupEnd = dstr(addDays(parseD(minDate), controles.umbralDormido));
  const points: TrailingPoint[] = [];
  const cutoff = parseD(controles.cutoffStr);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(cutoff);
    d.setMonth(d.getMonth() - i);
    const ds = dstr(d);
    if (ds < minDate || ds < warmupEnd) continue;
    const snap = computeSnapshot(byClient, minDate, ds, controles.periodoActivo, controles.montoMinimo, controles.umbralDormido, controles.paretoMode);
    points.push({ label: ds.slice(0, 7), ds, snap });
  }
  return points;
}

export interface ObjetivoPoint {
  label: string;
  ds: string;
  nActivo: number;
}

/** Same idea as trailingSnapshots but cutoff always = maxDate (the objetivo panel is always "as of today", independent of the Fecha de corte control). */
export function objetivoMonthlySeries(
  byClient: Map<number, CarteraRecord[]>,
  minDate: string,
  maxDate: string,
  controles: Omit<Controles, 'cutoffStr'>
): ObjetivoPoint[] {
  const warmupEnd = dstr(addDays(parseD(minDate), controles.umbralDormido));
  const points: ObjetivoPoint[] = [];
  const cutoff = parseD(maxDate);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(cutoff);
    d.setMonth(d.getMonth() - i);
    const ds = dstr(d);
    if (ds < minDate || ds < warmupEnd) continue;
    const snap = computeSnapshot(byClient, minDate, ds, controles.periodoActivo, controles.montoMinimo, controles.umbralDormido, controles.paretoMode);
    points.push({ label: ds.slice(0, 7), ds, nActivo: activosRentables(snap).length });
  }
  return points;
}

/* ================= misc helpers ================= */

export function minMaxDate(records: CarteraRecord[]): { minDate: string; maxDate: string } {
  const dates = records.map((r) => r[1]).sort();
  return { minDate: dates[0] ?? '2025-01-01', maxDate: dates[dates.length - 1] ?? '2025-01-01' };
}

export function compareCutoff(cutoffStr: string, compareDays: number): string {
  return dstr(addDays(parseD(cutoffStr), -compareDays));
}

/** Promedio de días entre compras consecutivas de un cliente (>=2 órdenes hasta cutoff); null si no aplica. */
export function frecuenciaCliente(arr: CarteraRecord[], cutoffStr: string): number | null {
  const upTo = arr.filter((r) => r[1] <= cutoffStr);
  if (upTo.length < 2) return null;
  const span = daysBetween(parseD(upTo[0]![1]), parseD(upTo[upTo.length - 1]![1]));
  return span / (upTo.length - 1);
}

export function pctDelta(now: number, before: number): { cls: 'up' | 'down' | 'flat'; txt: string } {
  if (before === 0) return { cls: 'flat', txt: 's/d previo' };
  const d = (now - before) / before;
  const cls = d > 0.001 ? 'up' : d < -0.001 ? 'down' : 'flat';
  const txt = `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%`;
  return { cls, txt };
}

export function pctDeltaRaw(now: number, before: number): { cls: 'up' | 'down' | 'flat'; txt: string } {
  const d = now - before;
  const cls = d > 0.0005 ? 'up' : d < -0.0005 ? 'down' : 'flat';
  const txt = `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} pts`;
  return { cls, txt };
}

export type { CarteraClientesData, CarteraRecord };

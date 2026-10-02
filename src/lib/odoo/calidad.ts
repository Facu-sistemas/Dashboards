import { searchRead, searchReadAll, searchCount } from './client';
import { getFronteraCompany } from './reference';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS } from './oee';
import { currentMonthKey, lastMonthKeys, monthsBetween, rangePresetStartDate, type DateRangePreset } from '../date';
import type { OdooDomain } from './types';

const TREND_MONTHS = 12;

const PRIORITY_LABELS: Record<string, string> = {
  '0': 'Baja',
  '1': 'Media',
  '2': 'Alta',
  '3': 'Urgente',
};
const PRIORITY_ORDER = ['Baja', 'Media', 'Alta', 'Urgente'];

export interface TicketsPorTipoRow {
  tipo: string;
  cantidad: number;
}

export interface TicketsPorPrioridadRow {
  prioridad: string;
  cantidad: number;
}

export interface TicketsMonthlyPoint {
  month: string; // "YYYY-MM"
  cantidad: number;
}

export interface NotasCreditoGarantiaPoint {
  month: string; // "YYYY-MM"
  living: number;
  colchon: number;
  sinSector: number;
  /** Monto total de TODAS las notas de crédito posteadas ese mes (cualquier motivo), para poder dimensionar qué % representa la garantía. */
  totalNotasCredito: number;
  /** (living+colchon+sinSector)/totalNotasCredito × 100 — null si no hubo notas de crédito ese mes (dividir por 0 no tiene sentido). */
  pctDelTotal: number | null;
}

export interface TicketsSoporteResult {
  total: number;
  porTipo: TicketsPorTipoRow[];
  porPrioridad: TicketsPorPrioridadRow[];
  mensual: TicketsMonthlyPoint[];
  notasCreditoGarantia: NotasCreditoGarantiaPoint[];
}

/**
 * `x_studio_motivo` on `account.move` ("Tipo de Nota de Crédito") stores this
 * value with a typo — "Garantatía". Originally confirmed live (2026-09) with
 * the Odoo UI label reading "Garantía" — by 2026-10 that label had been
 * changed in Odoo Studio to "Logistica" (another case of Odoo-side changes
 * outside this app's control), but the stored technical value is still
 * "Garantatía", so this filter keeps matching the same rows either way.
 */
const CREDIT_NOTE_WARRANTY_MOTIVO = 'Garantatía';

/**
 * `x_studio_motivo = 'Producto'` is the "no conformidad" / Calidad motivo
 * (shown in the Odoo UI as "Calidad") — the other credit-note reason that,
 * together with `CREDIT_NOTE_WARRANTY_MOTIVO`, Calidad wants counted as a
 * "devolución" for Colchón (see `getReparaciones`).
 */
const CREDIT_NOTE_NO_CONFORMIDAD_MOTIVO = 'Producto';

/**
 * Selector de empresa para Notas de Crédito por Garantía — deliberately
 * separate from Tickets' `companyId` (siempre Frontera Living S.A. para
 * tickets, ver `getTicketsSoporte`). 'all' es el default y reproduce la
 * vista `cids=1-2` de Odoo que el usuario usa para confirmar estos números.
 */
export type NotasCreditoEmpresa = 'all' | 'frontera' | 'presupuesto';

const EMPRESA_NAME: Record<Exclude<NotasCreditoEmpresa, 'all'>, string> = {
  frontera: 'Frontera Living S.A',
  presupuesto: 'Presupuesto',
};

async function resolveEmpresaDomain(empresa: NotasCreditoEmpresa): Promise<OdooDomain> {
  if (empresa === 'all') return [];
  type Row = { id: number; name: string };
  const rows = await searchRead<Row>({ model: 'res.company', fields: ['name'] });
  const company = rows.find((r) => r.name === EMPRESA_NAME[empresa]);
  // No match => an empty (impossible) filter rather than silently falling
  // back to "all", so a renamed/missing company shows 0 instead of lying.
  return [['company_id', '=', company?.id ?? -1]];
}

/**
 * Monto ($) de notas de crédito por garantía, por mes, separado Living vs.
 * Colchón — histórico completo sin recorte de rango: a diferencia de
 * Tickets, este dato recién empezó a cargarse en Odoo en septiembre 2026,
 * así que no hay un "antes" no comparable que excluir; el gráfico
 * simplemente crece un mes por vez.
 *
 * Deliberately NOT scoped to `company_id` by default (unlike
 * `getTicketsSoporte`) — confirmed live against the user's own Odoo view
 * (`cids=1-2`, both "Frontera Living S.A" and "Presupuesto"): restricting to
 * one company dropped 5 of 14 September rows and undercounted Colchón by
 * ~$1.5M. `empresa` lets the user narrow to one company when they want to.
 */
async function getNotasCreditoGarantia(empresa: NotasCreditoEmpresa): Promise<NotasCreditoGarantiaPoint[]> {
  type Row = { invoice_date: string; x_studio_sector: string | false; x_studio_motivo: string | false; amount_total_signed: number };

  const empresaDomain = await resolveEmpresaDomain(empresa);

  // Un solo fetch de TODAS las notas de crédito posteadas (cualquier
  // motivo) — de ahí sacamos tanto el desglose de Garantía (Living/Colchón)
  // como el total mensual que sirve de denominador para el %.
  const rows = await searchReadAll<Row>({
    model: 'account.move',
    domain: [
      ['move_type', '=', 'out_refund'],
      ['state', '=', 'posted'],
      ...empresaDomain,
    ],
    fields: ['invoice_date', 'x_studio_sector', 'x_studio_motivo', 'amount_total_signed'],
  });

  const garantiaRows = rows.filter((r) => r.x_studio_motivo === CREDIT_NOTE_WARRANTY_MOTIVO);
  if (garantiaRows.length === 0) return [];

  const byMonth = new Map<string, { living: number; colchon: number; sinSector: number }>();
  for (const r of garantiaRows) {
    const month = r.invoice_date.slice(0, 7);
    const bucket = byMonth.get(month) ?? { living: 0, colchon: 0, sinSector: 0 };
    const monto = Math.abs(r.amount_total_signed);
    if (r.x_studio_sector === 'Living') bucket.living += monto;
    else if (r.x_studio_sector === 'Colchon') bucket.colchon += monto;
    else bucket.sinSector += monto;
    byMonth.set(month, bucket);
  }

  const totalByMonth = new Map<string, number>();
  for (const r of rows) {
    const month = r.invoice_date.slice(0, 7);
    totalByMonth.set(month, (totalByMonth.get(month) ?? 0) + Math.abs(r.amount_total_signed));
  }

  const months = [...byMonth.keys()].sort();
  const allMonths = monthsBetween(months[0]!, currentMonthKey());
  return allMonths.map((month) => {
    const bucket = byMonth.get(month) ?? { living: 0, colchon: 0, sinSector: 0 };
    const totalNotasCredito = totalByMonth.get(month) ?? 0;
    const garantiaTotal = bucket.living + bucket.colchon + bucket.sinSector;
    const pctDelTotal = totalNotasCredito > 0 ? (garantiaTotal / totalNotasCredito) * 100 : null;
    return { month, ...bucket, totalNotasCredito, pctDelTotal };
  });
}

/**
 * Only "Tipo" (`ticket_type_id`) and "Prioridad" (`priority`) are usably
 * populated on real tickets — confirmed live that "Motivo"
 * (`x_studio_motivo` / `x_studio_motivo_1`, split by Tipo) is set on only 1
 * of 219 tickets, and "Bajo garantía" has zero real variance (218/219
 * false). The heatmap Tipo×Motivo and Pareto-de-Motivos from the original
 * plan would render as essentially empty against real data, so this v1
 * only covers what Calidad actually tracks today: tickets by Tipo, by
 * Prioridad, and monthly volume. Revisit once Motivo gets filled in
 * consistently.
 */
export async function getTicketsSoporte(range: DateRangePreset, notasCreditoEmpresa: NotasCreditoEmpresa = 'all'): Promise<TicketsSoporteResult> {
  const { companyId } = await getFronteraCompany();

  type Row = { ticket_type_id: [number, string] | false; priority: string; create_date: string };
  const [allRows, notasCreditoGarantia] = await Promise.all([
    searchReadAll<Row>({
      model: 'helpdesk.ticket',
      domain: [['company_id', '=', companyId]],
      fields: ['ticket_type_id', 'priority', 'create_date'],
    }),
    getNotasCreditoGarantia(notasCreditoEmpresa),
  ]);

  const startDate = rangePresetStartDate(range);
  const filtered = startDate ? allRows.filter((r) => r.create_date >= startDate) : allRows;

  const tipoCounts = new Map<string, number>();
  for (const r of filtered) {
    const tipo = r.ticket_type_id ? r.ticket_type_id[1] : 'Sin tipo';
    tipoCounts.set(tipo, (tipoCounts.get(tipo) ?? 0) + 1);
  }
  const porTipo = [...tipoCounts.entries()].map(([tipo, cantidad]) => ({ tipo, cantidad })).sort((a, b) => b.cantidad - a.cantidad);

  const prioridadCounts = new Map<string, number>();
  for (const r of filtered) {
    const label = PRIORITY_LABELS[r.priority] ?? r.priority;
    prioridadCounts.set(label, (prioridadCounts.get(label) ?? 0) + 1);
  }
  const porPrioridad = PRIORITY_ORDER.map((prioridad) => ({ prioridad, cantidad: prioridadCounts.get(prioridad) ?? 0 }));

  // Fixed last-12-months trend, independent of the range filter — same
  // convention as Facturación's monthly trend row.
  const months = lastMonthKeys(TREND_MONTHS);
  const monthSet = new Set(months);
  const monthCounts = new Map<string, number>();
  for (const r of allRows) {
    const month = r.create_date.slice(0, 7);
    if (monthSet.has(month)) monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
  }
  const mensual = months.map((month) => ({ month, cantidad: monthCounts.get(month) ?? 0 }));

  return { total: filtered.length, porTipo, porPrioridad, mensual, notasCreditoGarantia };
}

export interface ReparacionSectorMonthlyPoint {
  month: string; // "YYYY-MM"
  cantidadReparaciones: number;
  horasReparacion: number;
  totalRecuperado: number;
  unidadesFabricadas: number;
  /** cantidadReparaciones / unidadesFabricadas × 1000 — null si no se fabricó nada ese mes (dividir por 0 no tiene sentido). */
  reparacionesPorMilUnidades: number | null;
}

export interface ReparacionesSectorResult {
  totalReparaciones: number;
  totalHoras: number;
  totalRecuperado: number;
  totalUnidadesFabricadas: number;
  mensual: ReparacionSectorMonthlyPoint[];
}

export interface ReparacionColchonMonthlyPoint {
  month: string; // "YYYY-MM"
  cantidadNotasCredito: number;
  montoNotasCredito: number;
  /** De `repair.order` (único lugar donde se cargan horas) — complementario a las notas de crédito, no son necesariamente las mismas órdenes. */
  horasReparacion: number;
  unidadesFabricadas: number;
  /** cantidadNotasCredito / unidadesFabricadas × 1000 — null si no se fabricó nada ese mes (dividir por 0 no tiene sentido). */
  notasCreditoPorMilUnidades: number | null;
}

export interface ReparacionesColchonResult {
  totalNotasCredito: number;
  totalMontoNotasCredito: number;
  totalHoras: number;
  totalUnidadesFabricadas: number;
  mensual: ReparacionColchonMonthlyPoint[];
}

export interface ReparacionesResult {
  /** Reparaciones (`repair.order`) cuyo producto no cae en ninguna categoría Living/Colchón (sin producto cargado, PI, Servicio, Reventa, etc.) — se informan aparte, no entran en ninguno de los dos sectores. */
  totalSinSector: number;
  living: ReparacionesSectorResult;
  colchon: ReparacionesColchonResult;
}

type RepairRow = { create_date: string; x_studio_horas_de_reparacion: number; x_studio_total_recuperado: number };
type ProductionRow = { date_finished: string; qty_produced: number };

async function fetchRepairRows(categIds: number[], companyId: number, startDate: string | null): Promise<RepairRow[]> {
  const domain: OdooDomain = [
    ['state', '=', 'done'],
    ['company_id', '=', companyId],
    ['product_id.categ_id', 'in', categIds],
  ];
  if (startDate) domain.push(['create_date', '>=', startDate]);
  return searchReadAll<RepairRow>({
    model: 'repair.order',
    domain,
    fields: ['create_date', 'x_studio_horas_de_reparacion', 'x_studio_total_recuperado'],
  });
}

async function fetchProductionRows(categIds: number[], companyId: number, startDate: string | null): Promise<ProductionRow[]> {
  const domain: OdooDomain = [
    ['state', '=', 'done'],
    ['company_id', '=', companyId],
    ['product_id.categ_id', 'in', categIds],
  ];
  if (startDate) domain.push(['date_finished', '>=', startDate]);
  return searchReadAll<ProductionRow>({ model: 'mrp.production', domain, fields: ['date_finished', 'qty_produced'] });
}

type CreditNoteRow = { invoice_date: string; amount_total_signed: number };

/**
 * Notas de crédito de Colchón por Garantía + No conformidad — fuente que
 * Calidad pidió usar en vez de `repair.order` para el sector Colchón:
 * tienen mejor cobertura/carga que las órdenes de reparación. Deliberately
 * NOT scoped to `company_id` (same reasoning as `getNotasCreditoGarantia`:
 * restricting to one company undercounts real rows — confirmed live for
 * Garantía, assumed to hold here too since it's the same model/field).
 */
async function fetchNotasCreditoColchon(startDate: string | null): Promise<CreditNoteRow[]> {
  const domain: OdooDomain = [
    ['move_type', '=', 'out_refund'],
    ['state', '=', 'posted'],
    ['x_studio_sector', '=', 'Colchon'],
    ['x_studio_motivo', 'in', [CREDIT_NOTE_WARRANTY_MOTIVO, CREDIT_NOTE_NO_CONFORMIDAD_MOTIVO]],
  ];
  if (startDate) domain.push(['invoice_date', '>=', startDate]);
  return searchReadAll<CreditNoteRow>({ model: 'account.move', domain, fields: ['invoice_date', 'amount_total_signed'] });
}

function bucketColchon(
  creditNoteRows: CreditNoteRow[],
  repairRows: RepairRow[],
  productionRows: ProductionRow[],
  months: string[]
): ReparacionesColchonResult {
  const ncByMonth = new Map<string, { cantidad: number; monto: number }>();
  for (const r of creditNoteRows) {
    const month = r.invoice_date.slice(0, 7);
    const bucket = ncByMonth.get(month) ?? { cantidad: 0, monto: 0 };
    bucket.cantidad += 1;
    bucket.monto += Math.abs(r.amount_total_signed);
    ncByMonth.set(month, bucket);
  }

  const horasByMonth = new Map<string, number>();
  for (const r of repairRows) {
    const month = r.create_date.slice(0, 7);
    horasByMonth.set(month, (horasByMonth.get(month) ?? 0) + r.x_studio_horas_de_reparacion);
  }

  const productionByMonth = new Map<string, number>();
  for (const r of productionRows) {
    const month = r.date_finished.slice(0, 7);
    productionByMonth.set(month, (productionByMonth.get(month) ?? 0) + r.qty_produced);
  }

  const mensual = months.map((month) => {
    const ncBucket = ncByMonth.get(month) ?? { cantidad: 0, monto: 0 };
    const unidadesFabricadas = productionByMonth.get(month) ?? 0;
    return {
      month,
      cantidadNotasCredito: ncBucket.cantidad,
      montoNotasCredito: ncBucket.monto,
      horasReparacion: horasByMonth.get(month) ?? 0,
      unidadesFabricadas,
      notasCreditoPorMilUnidades: unidadesFabricadas > 0 ? (ncBucket.cantidad / unidadesFabricadas) * 1000 : null,
    };
  });

  return {
    totalNotasCredito: creditNoteRows.length,
    totalMontoNotasCredito: creditNoteRows.reduce((sum, r) => sum + Math.abs(r.amount_total_signed), 0),
    totalHoras: repairRows.reduce((sum, r) => sum + r.x_studio_horas_de_reparacion, 0),
    totalUnidadesFabricadas: productionRows.reduce((sum, r) => sum + r.qty_produced, 0),
    mensual,
  };
}

function bucketSector(repairRows: RepairRow[], productionRows: ProductionRow[], months: string[]): ReparacionesSectorResult {
  const repairByMonth = new Map<string, { cantidad: number; horas: number; recuperado: number }>();
  for (const r of repairRows) {
    const month = r.create_date.slice(0, 7);
    const bucket = repairByMonth.get(month) ?? { cantidad: 0, horas: 0, recuperado: 0 };
    bucket.cantidad += 1;
    bucket.horas += r.x_studio_horas_de_reparacion;
    bucket.recuperado += r.x_studio_total_recuperado;
    repairByMonth.set(month, bucket);
  }

  const productionByMonth = new Map<string, number>();
  for (const r of productionRows) {
    const month = r.date_finished.slice(0, 7);
    productionByMonth.set(month, (productionByMonth.get(month) ?? 0) + r.qty_produced);
  }

  const mensual = months.map((month) => {
    const repairBucket = repairByMonth.get(month) ?? { cantidad: 0, horas: 0, recuperado: 0 };
    const unidadesFabricadas = productionByMonth.get(month) ?? 0;
    return {
      month,
      cantidadReparaciones: repairBucket.cantidad,
      horasReparacion: repairBucket.horas,
      totalRecuperado: repairBucket.recuperado,
      unidadesFabricadas,
      reparacionesPorMilUnidades: unidadesFabricadas > 0 ? (repairBucket.cantidad / unidadesFabricadas) * 1000 : null,
    };
  });

  return {
    totalReparaciones: repairRows.length,
    totalHoras: repairRows.reduce((sum, r) => sum + r.x_studio_horas_de_reparacion, 0),
    totalRecuperado: repairRows.reduce((sum, r) => sum + r.x_studio_total_recuperado, 0),
    totalUnidadesFabricadas: productionRows.reduce((sum, r) => sum + r.qty_produced, 0),
    mensual,
  };
}

/**
 * Living sigue cruzando `repair.order` (devoluciones en reparación) contra
 * `mrp.production` cerrada de su categoría — confirmado en vivo (2026-10-02)
 * que 149 de 291 reparaciones son "Sillon / Lean" (Living). Queda tal cual
 * por ahora; Calidad puede pedir migrarlo a otra fuente más adelante, igual
 * que se hizo con Colchón (ver abajo).
 *
 * Colchón, a pedido de Calidad, usa Notas de Crédito (Garantía + No
 * conformidad, ver `fetchNotasCreditoColchon`) como fuente de "devoluciones"
 * en vez de `repair.order` — tienen mejor cobertura de carga para ese
 * sector. Las horas de reparación siguen viniendo de `repair.order` (único
 * lugar donde se cargan) y se muestran como dato complementario, no como
 * parte del mismo conteo.
 *
 * `x_studio_horas_de_reparacion` y `x_studio_total_recuperado` en
 * `repair.order` se cargan de forma excluyente según el caso — una
 * reparación puede tener horas > 0 y recuperado = 0, u otra al revés — por
 * eso Living sigue sumando ambas por separado en vez de combinarlas.
 */
export async function getReparaciones(range: DateRangePreset): Promise<ReparacionesResult> {
  const { companyId } = await getFronteraCompany();
  const startDate = rangePresetStartDate(range);

  const totalDomain: OdooDomain = [
    ['state', '=', 'done'],
    ['company_id', '=', companyId],
  ];
  if (startDate) totalDomain.push(['create_date', '>=', startDate]);

  const [livingRepairs, livingProduction, colchonRepairs, colchonProduction, colchonCreditNotes, totalReparaciones] =
    await Promise.all([
      fetchRepairRows(LIVING_CATEG_IDS, companyId, startDate),
      fetchProductionRows(LIVING_CATEG_IDS, companyId, startDate),
      fetchRepairRows(COLCHONES_CATEG_IDS, companyId, startDate),
      fetchProductionRows(COLCHONES_CATEG_IDS, companyId, startDate),
      fetchNotasCreditoColchon(startDate),
      searchCount('repair.order', totalDomain),
    ]);

  const allMonthKeys = [
    ...new Set(
      [...livingRepairs, ...colchonRepairs]
        .map((r) => r.create_date.slice(0, 7))
        .concat([...livingProduction, ...colchonProduction].map((r) => r.date_finished.slice(0, 7)))
        .concat(colchonCreditNotes.map((r) => r.invoice_date.slice(0, 7)))
    ),
  ].sort();
  const months = allMonthKeys.length > 0 ? monthsBetween(allMonthKeys[0]!, currentMonthKey()) : [];

  return {
    totalSinSector: totalReparaciones - livingRepairs.length - colchonRepairs.length,
    living: bucketSector(livingRepairs, livingProduction, months),
    colchon: bucketColchon(colchonCreditNotes, colchonRepairs, colchonProduction, months),
  };
}

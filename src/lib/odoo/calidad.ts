import { searchRead, searchReadAll, searchCount } from './client';
import { getFronteraCompany } from './reference';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS } from './oee';
import { addDaysIso, currentMonthKey, monthBounds, monthsBetween, rangePresetStartDate, type DateRangePreset } from '@/lib/date';
import type { OdooDomain } from './types';
import { fetchNotasColchonComoCnc, type NotaDevolucion } from './notas-credito-devolucion';
import { PRODUCTO_HORA_ID } from './costo-devoluciones';

/**
 * `x_studio_motivo` on `account.move` ("Tipo de Nota de Crédito") stores this
 * value with a typo — "Garantatía". Originally confirmed live (2026-09) with
 * the Odoo UI label reading "Garantía" — by 2026-10 that label had been
 * changed in Odoo Studio to "Logistica" (another case of Odoo-side changes
 * outside this app's control), but the stored technical value is still
 * "Garantatía", so this filter keeps matching the same rows either way.
 */
export const CREDIT_NOTE_WARRANTY_MOTIVO = 'Garantatía';

/**
 * `x_studio_motivo = 'Producto'` is the "no conformidad" / Calidad motivo
 * (shown in the Odoo UI as "Calidad") — the other credit-note reason that,
 * together with `CREDIT_NOTE_WARRANTY_MOTIVO`, Calidad wants counted as a
 * "devolución" for Colchón (see `getReparaciones`).
 */
export const CREDIT_NOTE_NO_CONFORMIDAD_MOTIVO = 'Producto';

export interface TicketsPorMotivoRow {
  motivo: string;
  cantidad: number;
}

/** Un punto del gráfico creadas vs. cerradas: un día ("YYYY-MM-DD") o, en períodos largos, un mes ("YYYY-MM"). */
export interface ReparacionesFlujoPoint {
  clave: string;
  creadas: number;
  cerradas: number;
}

export interface ReparacionGasto {
  ref: string;
  ticket: string | null;
  producto: string;
  estado: string;
  creada: string; // YYYY-MM-DD
  cerrada: string | null;
  horas: number;
  horasMonto: number;
  /** Valor de la tela y piezas agregadas ($): costo del producto × cantidad. */
  materiales: number;
  /** Detalle legible de lo que se agregó: "CUEROTEX BEIGE × 1 m". */
  materialesDetalle: string;
  total: number;
}

export interface TicketDetalle {
  id: number;
  ref: string;
  tipo: string;
  motivo: string;
  etapa: string;
  creado: string;
  cerrado: string | null;
  cliente: string;
  /** Descripción del ticket en texto plano (viene como HTML en Odoo). */
  descripcion: string;
}

export interface TicketsSoporteResult {
  desde: string;
  hasta: string;
  /** Tickets creados en el período. */
  total: number;
  porMotivo: TicketsPorMotivoRow[];
  /** 'dia' si el gráfico va día por día, 'mes' si el período es largo. */
  granularidad: 'dia' | 'mes';
  /** Ventana que cubre el gráfico (si se eligió un solo día, se muestra el mes entero para dar contexto). */
  flujoDesde: string;
  flujoHasta: string;
  flujo: ReparacionesFlujoPoint[];
  /** Totales de reparaciones dentro de [desde, hasta]. */
  reparacionesCreadas: number;
  reparacionesCerradas: number;
  gasto: {
    valorHora: number;
    cantidad: number;
    horas: number;
    horasMonto: number;
    materiales: number;
    total: number;
    items: ReparacionGasto[];
  };
  tickets: TicketDetalle[];
}

/** Odoo guarda UTC; Argentina es UTC-3 todo el año (sin horario de verano). */
function diaArgentina(utc: string): string {
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

function htmlATexto(html: string | false): string {
  if (!html) return '';
  return html
    .replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function diasEntre(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let d = desde; d <= hasta; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

const DIAS_MAX_GRAFICO = 92;

/**
 * Tickets de Soporte del período [desde, hasta] (fechas inclusivas, día argentino).
 *
 *  - Por motivo: tickets CREADOS en el período, agrupados por `x_studio_motivo`
 *    (Living) o `x_studio_motivo_1` (el otro formulario): Post-Venta / Calidad / Transporte / Devolución.
 *  - Creadas vs. cerradas: órdenes de reparación (`repair.order`, sin canceladas).
 *    Creada = `create_date`; cerrada = fecha del movimiento de stock en que se
 *    terminó (la orden no guarda fecha de cierre propia), o su última
 *    modificación si no tiene movimientos.
 *  - Gasto: de las reparaciones creadas en el período, horas × valor hora
 *    (precio de SERVICIO DE REPARACION, igual que Calidad CNC) + costo de la tela y piezas agregadas.
 */
export async function getTicketsSoporte(desde: string, hasta: string): Promise<TicketsSoporteResult> {
  const { companyId } = await getFronteraCompany();

  type TicketRow = {
    id: number;
    name: string;
    ticket_type_id: [number, string] | false;
    stage_id: [number, string] | false;
    partner_id: [number, string] | false;
    x_studio_motivo: string | false;
    x_studio_motivo_1: string | false;
    description: string | false;
    create_date: string;
    close_date: string | false;
  };
  type RepairRow = {
    id: number;
    name: string;
    state: string;
    create_date: string;
    write_date: string;
    ticket_id: [number, string] | false;
    product_id: [number, string] | false;
    x_studio_horas_de_reparacion: number;
  };
  type MoveRow = {
    repair_id: [number, string] | false;
    product_id: [number, string];
    product_uom_qty: number;
    quantity: number;
    product_uom: [number, string] | false;
    repair_line_type: string | false;
    state: string;
    date: string;
  };

  const [tickets, repairs, productoHora] = await Promise.all([
    searchReadAll<TicketRow>({
      model: 'helpdesk.ticket',
      domain: [['company_id', '=', companyId]],
      fields: ['name', 'ticket_type_id', 'stage_id', 'partner_id', 'x_studio_motivo', 'x_studio_motivo_1', 'description', 'create_date', 'close_date'],
    }),
    searchReadAll<RepairRow>({
      model: 'repair.order',
      domain: [['company_id', '=', companyId], ['state', '!=', 'cancel']],
      fields: ['name', 'state', 'create_date', 'write_date', 'ticket_id', 'product_id', 'x_studio_horas_de_reparacion'],
    }),
    searchRead<{ id: number; lst_price: number }>({ model: 'product.product', domain: [['id', '=', PRODUCTO_HORA_ID]], fields: ['lst_price'], limit: 1 }),
  ]);
  const valorHora = productoHora[0]?.lst_price ?? 0;

  const repairIds = repairs.map((r) => r.id);
  const moves = repairIds.length
    ? await searchReadAll<MoveRow>({
        model: 'stock.move',
        domain: [['repair_id', 'in', repairIds], ['state', '!=', 'cancel']],
        fields: ['repair_id', 'product_id', 'product_uom_qty', 'quantity', 'product_uom', 'repair_line_type', 'state', 'date'],
      })
    : [];
  const agregadas = moves.filter((m) => m.repair_line_type === 'add' && m.product_id[0] !== PRODUCTO_HORA_ID);
  const prodIds = [...new Set(agregadas.map((m) => m.product_id[0]))];
  const costos = new Map<number, number>();
  if (prodIds.length) {
    const rows = await searchReadAll<{ id: number; standard_price: number }>({
      model: 'product.product',
      domain: [['id', 'in', prodIds]],
      fields: ['standard_price'],
      context: { active_test: false },
    });
    for (const r of rows) costos.set(r.id, r.standard_price);
  }

  // ---- Reparaciones: fecha de creación, de cierre y gasto ----
  const movesPorOrden = new Map<number, MoveRow[]>();
  for (const m of moves) {
    if (!m.repair_id) continue;
    const list = movesPorOrden.get(m.repair_id[0]) ?? [];
    list.push(m);
    movesPorOrden.set(m.repair_id[0], list);
  }
  const fichas = repairs.map((r) => {
    const creada = diaArgentina(r.create_date);
    let cerrada: string | null = null;
    if (r.state === 'done') {
      const hechos = (movesPorOrden.get(r.id) ?? []).filter((m) => m.state === 'done').map((m) => m.date);
      cerrada = diaArgentina(hechos.length ? hechos.sort().at(-1)! : r.write_date);
    }
    const piezas = (movesPorOrden.get(r.id) ?? []).filter((m) => m.repair_line_type === 'add' && m.product_id[0] !== PRODUCTO_HORA_ID);
    const materiales = piezas.reduce((s, m) => s + (costos.get(m.product_id[0]) ?? 0) * (m.quantity || m.product_uom_qty), 0);
    const detalle = piezas
      .map((m) => `${m.product_id[1]} × ${m.quantity || m.product_uom_qty}${m.product_uom ? ` ${m.product_uom[1]}` : ''}`)
      .join(' · ');
    const horas = r.x_studio_horas_de_reparacion || 0;
    const item: ReparacionGasto = {
      ref: r.name,
      ticket: r.ticket_id ? r.ticket_id[1] : null,
      producto: r.product_id ? r.product_id[1] : '—',
      estado: r.state,
      creada,
      cerrada,
      horas,
      horasMonto: horas * valorHora,
      materiales,
      materialesDetalle: detalle,
      total: horas * valorHora + materiales,
    };
    return item;
  });
  const enRango = (f: string) => f >= desde && f <= hasta;

  // ---- Gráfico creadas vs cerradas ----
  const unSoloDia = desde === hasta;
  const flujoDesde = unSoloDia ? monthBounds(desde.slice(0, 7)).start : desde;
  const flujoHasta = unSoloDia ? addDaysIso(monthBounds(desde.slice(0, 7)).endExclusive, -1) : hasta;
  const granularidad: 'dia' | 'mes' = diasEntre(flujoDesde, flujoHasta).length > DIAS_MAX_GRAFICO ? 'mes' : 'dia';
  const claves = granularidad === 'dia' ? diasEntre(flujoDesde, flujoHasta) : monthsBetween(flujoDesde.slice(0, 7), flujoHasta.slice(0, 7));
  const claveDe = (f: string) => (granularidad === 'dia' ? f : f.slice(0, 7));
  const flujoMap = new Map<string, ReparacionesFlujoPoint>(claves.map((k) => [k, { clave: k, creadas: 0, cerradas: 0 }]));
  for (const f of fichas) {
    if (f.creada >= flujoDesde && f.creada <= flujoHasta) flujoMap.get(claveDe(f.creada))!.creadas += 1;
    if (f.cerrada && f.cerrada >= flujoDesde && f.cerrada <= flujoHasta) flujoMap.get(claveDe(f.cerrada))!.cerradas += 1;
  }

  // ---- Gasto: reparaciones creadas en el período ----
  const items = fichas.filter((f) => enRango(f.creada)).sort((a, b) => b.total - a.total || b.creada.localeCompare(a.creada));
  const horas = items.reduce((s, i) => s + i.horas, 0);
  const materiales = items.reduce((s, i) => s + i.materiales, 0);

  // ---- Tickets del período ----
  const delPeriodo = tickets.filter((t) => enRango(diaArgentina(t.create_date)));
  const motivoDe = (t: TicketRow) => t.x_studio_motivo || t.x_studio_motivo_1 || 'Sin motivo';
  const conteo = new Map<string, number>();
  for (const t of delPeriodo) conteo.set(motivoDe(t), (conteo.get(motivoDe(t)) ?? 0) + 1);

  return {
    desde,
    hasta,
    total: delPeriodo.length,
    porMotivo: [...conteo.entries()].map(([motivo, cantidad]) => ({ motivo, cantidad })).sort((a, b) => b.cantidad - a.cantidad),
    granularidad,
    flujoDesde,
    flujoHasta,
    flujo: [...flujoMap.values()],
    reparacionesCreadas: fichas.filter((f) => enRango(f.creada)).length,
    reparacionesCerradas: fichas.filter((f) => f.cerrada && enRango(f.cerrada)).length,
    gasto: { valorHora, cantidad: items.length, horas, horasMonto: horas * valorHora, materiales, total: horas * valorHora + materiales, items },
    tickets: delPeriodo
      .map((t) => ({
        id: t.id,
        ref: t.name,
        tipo: t.ticket_type_id ? t.ticket_type_id[1] : 'Sin tipo',
        motivo: motivoDe(t),
        etapa: t.stage_id ? t.stage_id[1] : '—',
        creado: diaArgentina(t.create_date),
        cerrado: t.close_date ? diaArgentina(t.close_date) : null,
        cliente: t.partner_id ? t.partner_id[1] : '—',
        descripcion: htmlATexto(t.description),
      }))
      .sort((a, b) => b.creado.localeCompare(a.creado) || b.id - a.id),
  };
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
  /** Desglose del total anterior por motivo: Garantía vs. Calidad (no conformidad). */
  cantidadGarantia: number;
  montoGarantia: number;
  cantidadCalidad: number;
  montoCalidad: number;
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
  /** Valor de la hora de reparación ($): precio del producto SERVICIO DE REPARACION en Odoo (el mismo que usa Costo de devoluciones). */
  valorHora: number;
  living: ReparacionesSectorResult;
  colchon: ReparacionesColchonResult;
}

type RepairRow = { create_date: string; x_studio_horas_de_reparacion: number; x_studio_total_recuperado: number };
type ProductionRow = { date_finished: string; qty_produced: number; x_studio_unidades_eq: number };

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
  return searchReadAll<ProductionRow>({ model: 'mrp.production', domain, fields: ['date_finished', 'qty_produced', 'x_studio_unidades_eq'] });
}

/**
 * Notas de crédito de Colchón por devolución (Calidad, Garantía/Logística,
 * transporte, errores de carga) — fuente que Calidad pidió usar en vez de
 * `repair.order` para el sector Colchón: tienen mejor cobertura de carga.
 * No entran los descuentos, acuerdos comerciales ni publicidad. La
 * clasificación es la misma que usa Costo de no calidad
 * (`fetchNotasColchonComoCnc`).
 */
function bucketColchon(
  creditNoteRows: NotaDevolucion[],
  repairRows: RepairRow[],
  productionRows: ProductionRow[],
  months: string[]
): ReparacionesColchonResult {
  const emptyBucket = () => ({ cantidad: 0, monto: 0, cantGarantia: 0, montoGarantia: 0, cantCalidad: 0, montoCalidad: 0 });
  const ncByMonth = new Map<string, ReturnType<typeof emptyBucket>>();
  for (const r of creditNoteRows) {
    const month = r.invoiceDate.slice(0, 7);
    const bucket = ncByMonth.get(month) ?? emptyBucket();
    const monto = r.amountUntaxed;
    bucket.cantidad += 1;
    bucket.monto += monto;
    if (r.grupo === 'garantia') {
      bucket.cantGarantia += 1;
      bucket.montoGarantia += monto;
    } else {
      bucket.cantCalidad += 1;
      bucket.montoCalidad += monto;
    }
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
    const ncBucket = ncByMonth.get(month) ?? emptyBucket();
    const unidadesFabricadas = productionByMonth.get(month) ?? 0;
    return {
      month,
      cantidadNotasCredito: ncBucket.cantidad,
      montoNotasCredito: ncBucket.monto,
      cantidadGarantia: ncBucket.cantGarantia,
      montoGarantia: ncBucket.montoGarantia,
      cantidadCalidad: ncBucket.cantCalidad,
      montoCalidad: ncBucket.montoCalidad,
      horasReparacion: horasByMonth.get(month) ?? 0,
      unidadesFabricadas,
      notasCreditoPorMilUnidades: unidadesFabricadas > 0 ? (ncBucket.cantidad / unidadesFabricadas) * 1000 : null,
    };
  });

  return {
    totalNotasCredito: creditNoteRows.length,
    totalMontoNotasCredito: creditNoteRows.reduce((sum, r) => sum + r.amountUntaxed, 0),
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
    // Living en Unidades equivalentes: misma fuente que Gerencia General > Producción.
    productionByMonth.set(month, (productionByMonth.get(month) ?? 0) + r.x_studio_unidades_eq);
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
    totalUnidadesFabricadas: productionRows.reduce((sum, r) => sum + r.x_studio_unidades_eq, 0),
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
 * conformidad, ver `fetchNotasColchonComoCnc`) como fuente de "devoluciones"
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

  const [livingRepairs, livingProduction, colchonRepairs, colchonProduction, colchonCreditNotes, totalReparaciones, productoHora] =
    await Promise.all([
      fetchRepairRows(LIVING_CATEG_IDS, companyId, startDate),
      fetchProductionRows(LIVING_CATEG_IDS, companyId, startDate),
      fetchRepairRows(COLCHONES_CATEG_IDS, companyId, startDate),
      fetchProductionRows(COLCHONES_CATEG_IDS, companyId, startDate),
      fetchNotasColchonComoCnc(startDate),
      searchCount('repair.order', totalDomain),
      searchRead<{ id: number; lst_price: number }>({ model: 'product.product', domain: [['id', '=', PRODUCTO_HORA_ID]], fields: ['lst_price'], limit: 1 }),
    ]);

  const allMonthKeys = [
    ...new Set(
      [...livingRepairs, ...colchonRepairs]
        .map((r) => r.create_date.slice(0, 7))
        .concat([...livingProduction, ...colchonProduction].map((r) => r.date_finished.slice(0, 7)))
        .concat(colchonCreditNotes.map((r) => r.invoiceDate.slice(0, 7)))
    ),
  ].sort();
  const months = allMonthKeys.length > 0 ? monthsBetween(allMonthKeys[0]!, currentMonthKey()) : [];

  return {
    totalSinSector: totalReparaciones - livingRepairs.length - colchonRepairs.length,
    valorHora: productoHora[0]?.lst_price ?? 0,
    living: bucketSector(livingRepairs, livingProduction, months),
    colchon: bucketColchon(colchonCreditNotes, colchonRepairs, colchonProduction, months),
  };
}

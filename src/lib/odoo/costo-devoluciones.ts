import { searchRead, searchReadAll } from './client';
import { CREDIT_NOTE_NO_CONFORMIDAD_MOTIVO, CREDIT_NOTE_WARRANTY_MOTIVO } from './calidad';
import { getPartners, normalizarProvincia } from './mapa-destinos';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS } from './oee';
import { getArgentinaTodayIso } from './oee';
import { lastMonthKeys, monthBounds } from '../date';
import type { OdooDomain } from './types';

export type SectorDevolucion = 'living' | 'colchon';

export interface EmpresaOption {
  id: number;
  name: string;
}

/**
 * Un registro por orden de reparación o nota de crédito, ya ubicado en mes,
 * sector, empresa y provincia. El front agrega y filtra sobre esto sin
 * volver a consultar Odoo.
 */
export interface DevolucionRegistro {
  mes: string; // "YYYY-MM"
  sector: SectorDevolucion;
  empresa: number;
  provincia: string;
  /** true = cuenta como devolución del índice (Living: orden de reparación; Colchón: nota de crédito). Las reparaciones de Colchón no cuentan, pero sus horas sí cuestan. */
  cuenta: boolean;
  horas: number;
  recuperado: number;
  /** Monto ($) de la nota de crédito (solo Colchón). */
  notaCredito: number;
}

export interface ProduccionRegistro {
  mes: string;
  sector: SectorDevolucion;
  empresa: number;
  unidades: number;
}

export interface CostoDevolucionesData {
  /** Últimos 12 meses, el más reciente primero. */
  meses: string[];
  mesActual: string;
  empresas: EmpresaOption[];
  registros: DevolucionRegistro[];
  produccion: ProduccionRegistro[];
}

const MESES_VENTANA = 12;

interface RepairRow extends Record<string, unknown> {
  partner_id: [number, string] | false;
  company_id: [number, string] | false;
  create_date: string;
  x_studio_horas_de_reparacion: number;
  x_studio_total_recuperado: number;
}

interface CreditNoteRow extends Record<string, unknown> {
  partner_id: [number, string] | false;
  company_id: [number, string] | false;
  invoice_date: string;
  amount_total_signed: number;
}

interface ProductionRow extends Record<string, unknown> {
  company_id: [number, string] | false;
  date_finished: string;
  qty_produced: number;
}

function fetchRepairs(categIds: number[], desde: string): Promise<RepairRow[]> {
  return searchReadAll<RepairRow>({
    model: 'repair.order',
    domain: [
      ['state', '=', 'done'],
      ['product_id.categ_id', 'in', categIds],
      ['create_date', '>=', `${desde} 00:00:00`],
    ],
    fields: ['partner_id', 'company_id', 'create_date', 'x_studio_horas_de_reparacion', 'x_studio_total_recuperado'],
  });
}

function fetchProduction(categIds: number[], desde: string): Promise<ProductionRow[]> {
  return searchReadAll<ProductionRow>({
    model: 'mrp.production',
    domain: [
      ['state', '=', 'done'],
      ['product_id.categ_id', 'in', categIds],
      ['date_finished', '>=', `${desde} 00:00:00`],
    ],
    fields: ['company_id', 'date_finished', 'qty_produced'],
  });
}

/** Mismo filtro que `fetchNotasCreditoColchon` de calidad.ts (todas las empresas), con cliente y empresa para poder abrirlas. */
function fetchNotasCreditoColchon(desde: string): Promise<CreditNoteRow[]> {
  const domain: OdooDomain = [
    ['move_type', '=', 'out_refund'],
    ['state', '=', 'posted'],
    ['x_studio_sector', '=', 'Colchon'],
    ['x_studio_motivo', 'in', [CREDIT_NOTE_WARRANTY_MOTIVO, CREDIT_NOTE_NO_CONFORMIDAD_MOTIVO]],
    ['invoice_date', '>=', desde],
  ];
  return searchReadAll<CreditNoteRow>({
    model: 'account.move',
    domain,
    fields: ['partner_id', 'company_id', 'invoice_date', 'amount_total_signed'],
  });
}

/**
 * Cruce devoluciones × mes × sector × empresa × provincia del cliente.
 * Misma definición de "devolución" que la pestaña Reparaciones (Living =
 * órdenes de reparación, Colchón = notas de crédito de Garantía + Calidad),
 * así el índice "cada 1.000" coincide. Hoy las reparaciones y la producción
 * son todas de Frontera Living S.A.; las notas de crédito de Colchón se
 * reparten entre Frontera y Presupuesto — por eso el filtro de empresa casi
 * solo mueve Colchón.
 *
 * La provincia es la del cliente de la nota u orden, no la de la dirección
 * de entrega original.
 */
export async function getCostoDevolucionesData(): Promise<CostoDevolucionesData> {
  const mesActual = getArgentinaTodayIso().slice(0, 7);
  const mesesAsc = lastMonthKeys(MESES_VENTANA);
  const desde = monthBounds(mesesAsc[0]!).start;

  const [empresas, livingRepairs, colchonRepairs, notasCredito, livingProd, colchonProd] = await Promise.all([
    searchRead<{ id: number; name: string }>({ model: 'res.company', fields: ['name'], order: 'id asc' }),
    fetchRepairs(LIVING_CATEG_IDS, desde),
    fetchRepairs(COLCHONES_CATEG_IDS, desde),
    fetchNotasCreditoColchon(desde),
    fetchProduction(LIVING_CATEG_IDS, desde),
    fetchProduction(COLCHONES_CATEG_IDS, desde),
  ]);

  const partnerIds = [...livingRepairs, ...colchonRepairs, ...notasCredito].flatMap((r) => (r.partner_id ? [r.partner_id[0]] : []));
  const partners = await getPartners(partnerIds);
  const provinciaDe = (partnerId: [number, string] | false): string => {
    const state = partnerId ? partners.get(partnerId[0])?.state_id : undefined;
    return normalizarProvincia(state ? state[1] : undefined);
  };

  const registros: DevolucionRegistro[] = [];
  const reparacion = (r: RepairRow, sector: SectorDevolucion, cuenta: boolean) =>
    registros.push({
      mes: r.create_date.slice(0, 7),
      sector,
      empresa: r.company_id ? r.company_id[0] : 0,
      provincia: provinciaDe(r.partner_id),
      cuenta,
      horas: r.x_studio_horas_de_reparacion,
      recuperado: r.x_studio_total_recuperado,
      notaCredito: 0,
    });
  for (const r of livingRepairs) reparacion(r, 'living', true);
  for (const r of colchonRepairs) reparacion(r, 'colchon', false);
  for (const n of notasCredito) {
    registros.push({
      mes: n.invoice_date.slice(0, 7),
      sector: 'colchon',
      empresa: n.company_id ? n.company_id[0] : 0,
      provincia: provinciaDe(n.partner_id),
      cuenta: true,
      horas: 0,
      recuperado: 0,
      notaCredito: Math.abs(n.amount_total_signed),
    });
  }

  const produccion = new Map<string, ProduccionRegistro>();
  const sumarProduccion = (rows: ProductionRow[], sector: SectorDevolucion) => {
    for (const r of rows) {
      const mes = r.date_finished.slice(0, 7);
      const empresa = r.company_id ? r.company_id[0] : 0;
      const key = `${mes}|${sector}|${empresa}`;
      const reg = produccion.get(key) ?? { mes, sector, empresa, unidades: 0 };
      reg.unidades += r.qty_produced;
      produccion.set(key, reg);
    }
  };
  sumarProduccion(livingProd, 'living');
  sumarProduccion(colchonProd, 'colchon');

  return {
    meses: [...mesesAsc].reverse(),
    mesActual,
    empresas: empresas.map((e) => ({ id: e.id, name: e.name })),
    registros,
    produccion: [...produccion.values()],
  };
}

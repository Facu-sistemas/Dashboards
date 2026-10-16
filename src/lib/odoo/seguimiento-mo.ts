import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { withTtlCache, cacheKey } from '@/lib/cache';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS, getArgentinaTodayIso } from './oee';

export type SeguimientoSemaforo = 'verde' | 'amarillo' | 'rojo';

export interface SeguimientoUmbrales {
  /** Primer día (desde la creación de la MO) en que pasa a amarillo. */
  amarilloDesde: number;
  /** Primer día en que pasa a rojo. */
  rojoDesde: number;
}

export interface SeguimientoOrden {
  id: number;
  reference: string;
  productName: string;
  sector: string;
  /** Fecha de creación de la MO, "YYYY-MM-DD" en hora de Argentina. */
  createdDate: string;
  /** Días corridos desde la creación hasta hoy (Argentina). */
  ageDays: number;
  semaforo: SeguimientoSemaforo;
  /** Estado de producción cargado en Odoo ("Iniciado" / "No Iniciado"). */
  iniciado: boolean;
  qty: number;
}

export interface SeguimientoSector {
  sector: string;
  total: number;
  verde: number;
  amarillo: number;
  rojo: number;
  /** Antigüedad promedio en días de las MO abiertas del sector. */
  avgDays: number;
}

export interface SeguimientoGrupo {
  umbrales: SeguimientoUmbrales;
  total: number;
  verde: number;
  amarillo: number;
  rojo: number;
  avgDays: number;
  maxDays: number;
  sectores: SeguimientoSector[];
  /** Todas las MO abiertas del grupo, la más vieja primero. */
  ordenes: SeguimientoOrden[];
}

export interface SeguimientoMoResult {
  today: string;
  colchones: SeguimientoGrupo;
  living: SeguimientoGrupo;
}

// Colchones: verde hasta 9 días, amarillo 10-14, rojo 15+. Living: verde hasta 19, amarillo 20-29, rojo 30+.
export const UMBRALES_COLCHONES: SeguimientoUmbrales = { amarilloDesde: 10, rojoDesde: 15 };
export const UMBRALES_LIVING: SeguimientoUmbrales = { amarilloDesde: 20, rojoDesde: 30 };

const OPEN_STATES = ['draft', 'confirmed', 'progress', 'to_close'];
const TTL_MS = 60 * 1000;
const ARGENTINA_UTC_OFFSET_H = 3;

type MoRow = {
  id: number;
  name: string;
  product_id: [number, string];
  create_date: string;
  product_qty: number;
  x_studio_estado_produccion: string | false;
  x_studio_categoria_producto_r: [number, string] | false;
};

function semaforoDe(ageDays: number, u: SeguimientoUmbrales): SeguimientoSemaforo {
  if (ageDays >= u.rojoDesde) return 'rojo';
  if (ageDays >= u.amarilloDesde) return 'amarillo';
  return 'verde';
}

/** Odoo guarda create_date en UTC ("YYYY-MM-DD HH:MM:SS"); lo pasamos al día calendario de Argentina (UTC-3, sin DST). */
function argentinaDate(odooUtc: string): string {
  const d = new Date(`${odooUtc.replace(' ', 'T')}Z`);
  return new Date(d.getTime() - ARGENTINA_UTC_OFFSET_H * 3600 * 1000).toISOString().slice(0, 10);
}

function diffDays(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

/** El sector es la categoría de producto sin el prefijo del grupo ("Colchones / Espuma" → "Espuma"). */
function sectorDe(categ: MoRow['x_studio_categoria_producto_r']): string {
  if (!categ) return 'Sin categoría';
  const parts = categ[1].split('/');
  return parts[parts.length - 1]!.trim();
}

async function fetchGrupo(categIds: number[], companyId: number, today: string, umbrales: SeguimientoUmbrales): Promise<SeguimientoGrupo> {
  const rows = await searchReadAll<MoRow>({
    model: 'mrp.production',
    domain: [
      ['company_id', '=', companyId],
      ['state', 'in', OPEN_STATES],
      ['product_id.categ_id', 'in', categIds],
    ],
    fields: ['name', 'product_id', 'create_date', 'product_qty', 'x_studio_estado_produccion', 'x_studio_categoria_producto_r'],
    order: 'create_date asc',
  });

  const ordenes: SeguimientoOrden[] = rows.map((r) => {
    const createdDate = argentinaDate(r.create_date);
    const ageDays = Math.max(0, diffDays(createdDate, today));
    return {
      id: r.id,
      reference: r.name,
      productName: r.product_id[1],
      sector: sectorDe(r.x_studio_categoria_producto_r),
      createdDate,
      ageDays,
      semaforo: semaforoDe(ageDays, umbrales),
      iniciado: r.x_studio_estado_produccion === 'Iniciado',
      qty: r.product_qty,
    };
  });

  const porSector = new Map<string, SeguimientoSector & { sumDays: number }>();
  for (const o of ordenes) {
    const s = porSector.get(o.sector) ?? { sector: o.sector, total: 0, verde: 0, amarillo: 0, rojo: 0, avgDays: 0, sumDays: 0 };
    s.total += 1;
    s[o.semaforo] += 1;
    s.sumDays += o.ageDays;
    porSector.set(o.sector, s);
  }
  const sectores: SeguimientoSector[] = [...porSector.values()]
    .map(({ sumDays, ...s }) => ({ ...s, avgDays: s.total > 0 ? sumDays / s.total : 0 }))
    .sort((a, b) => b.total - a.total);

  const total = ordenes.length;
  const count = (c: SeguimientoSemaforo) => ordenes.filter((o) => o.semaforo === c).length;
  return {
    umbrales,
    total,
    verde: count('verde'),
    amarillo: count('amarillo'),
    rojo: count('rojo'),
    avgDays: total > 0 ? ordenes.reduce((s, o) => s + o.ageDays, 0) / total : 0,
    maxDays: ordenes.reduce((m, o) => Math.max(m, o.ageDays), 0),
    sectores,
    ordenes,
  };
}

/**
 * Seguimiento de las órdenes de fabricación abiertas (borrador / confirmada /
 * en progreso / por cerrar) de Colchones y Living: cuántos días lleva cada una
 * en fábrica desde su fecha de creación, con semáforo según el umbral de cada
 * rubro. El "sector" es la categoría de producto de la MO.
 */
export async function getSeguimientoMo(
  umbralesColchones: SeguimientoUmbrales = UMBRALES_COLCHONES,
  umbralesLiving: SeguimientoUmbrales = UMBRALES_LIVING
): Promise<SeguimientoMoResult> {
  const today = getArgentinaTodayIso();
  return withTtlCache(cacheKey('seguimiento-mo', { today, umbralesColchones, umbralesLiving }), TTL_MS, async () => {
    const { companyId } = await getFronteraCompany();
    const [colchones, living] = await Promise.all([
      fetchGrupo(COLCHONES_CATEG_IDS, companyId, today, umbralesColchones),
      fetchGrupo(LIVING_CATEG_IDS, companyId, today, umbralesLiving),
    ]);
    return { today, colchones, living };
  });
}

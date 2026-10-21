import { readGroup, searchRead, searchReadAll } from '@/lib/odoo/client';
import { withTtlCache } from '@/lib/cache';
import { getClientesActivosCompanies } from '@/lib/odoo/clientes-activos';
import { getArgentinaTodayIso } from '@/lib/odoo/oee';
import { patronesExcluidos } from '@/lib/odoo/rentabilidad/exclusiones';
import type { OdooDomain, OdooReadGroupResult } from '@/lib/odoo/types';

/**
 * Ventas reales del módulo Rentabilidad, leídas de Odoo (solo lectura).
 *
 * Fuente: `account.move.line` de facturas de cliente posteadas
 * (`out_invoice`) MENOS notas de crédito (`out_refund`), con signo, importe
 * `price_subtotal` (sin IVA). Se netean TODAS las N/C (exclusiones.ts documenta la prueba
 * contra la planilla). Se incluyen ambas compañías y los productos de flete facturados
 * (categoría Servicio), y se EXCLUYEN las categorías Financiero, Garantía, Materia Prima
 * y "PI" suelta (no figuran en la planilla).
 *
 * El "flete" de la planilla es un recargo regional embebido en el precio, no
 * un producto: `res.partner.region_id` ("COSTA BS AS - 12,5%") da el % de
 * recargo del cliente y Monto s/flete = Subtotal / (1 + %). Se calcula en
 * consultas.ts a partir de `recargos` de este dataset.
 *
 * Categoría / subcategoría: de `product.product.categ_id` -> `complete_name`
 * ("Sillon / Lean" => categoría "Sillon", subcategoría "Lean"). Las raíces
 * con la barra pegada ("Colchones/bonificacion", "Sillon/Bonificacion") se
 * parten igual, así quedan como subcategoría de su categoría. Raíces sin
 * hijos (Servicio, Scrap, PI...) tienen subcategoría "(sin subcategoría)".
 *
 * Cliente = `commercial_partner_id` del partner de la línea.
 *
 * Granularidad: cliente x variante x mes. Todo con `read_group` (agregado en
 * servidor, sin límite); lookups por lotes de ids con `searchReadAll`.
 */

/**
 * Categorías que la planilla de rentabilidad no incluye (confirmado contra sus totales de septiembre 2026:
 * con estas exclusiones el subtotal da 2.909.488.042 al peso). Por raíz, y por nombre completo exacto
 * (la categoría "PI" suelta, no sus hijas como "PI / Block Espuma").
 */
export const CATEGORIAS_EXCLUIDAS = ['Financiero', 'Garantia', 'Materia Prima'];
export const CATEGORIAS_EXCLUIDAS_EXACTAS = ['PI'];

export const SIN_SUBCATEGORIA = '(sin subcategoría)';
export const SIN_PRODUCTO = '(sin producto)';
const TTL_MS = 60_000;
const ID_CHUNK = 800;

export interface ProductoMeta {
  name: string;
  categoria: string;
  subcategoria: string;
}

export interface VentaGrano {
  clienteId: number;
  /** product.product (0 = línea sin producto). */
  varianteId: number;
  /** product.template (0 = línea sin producto). */
  templateId: number;
  /** 1..12 */
  mes: number;
  /** price_subtotal neto de NC (con recargo de región incluido). */
  subtotal: number;
  cantidad: number;
}

export interface VentasDataset {
  anio: number;
  grano: VentaGrano[];
  clientes: Record<number, string>;
  /** % de recargo regional del cliente comercial, en fracción (0,125). Ausente = sin región cargada. */
  recargos: Record<number, number>;
  productos: Record<number, ProductoMeta>;
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function partirCategoria(completeName: string): { categoria: string; subcategoria: string } {
  const partes = completeName
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length === 0) return { categoria: '(sin categoría)', subcategoria: SIN_SUBCATEGORIA };
  return { categoria: partes[0]!, subcategoria: partes.length > 1 ? partes.slice(1).join(' / ') : SIN_SUBCATEGORIA };
}

/** "COSTA BS AS - 12,5%" -> 0.125. null si el texto no trae porcentaje. */
export function recargoDeRegion(nombreRegion: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(nombreRegion);
  return m ? Number(m[1]!.replace(',', '.')) / 100 : null;
}

type CategoriaOdoo = { id: number; complete_name: string };

async function getCategorias(): Promise<Map<number, { categoria: string; subcategoria: string; completo: string }>> {
  const rows = await searchReadAll<CategoriaOdoo>({ model: 'product.category', fields: ['complete_name'] });
  return new Map(rows.map((r) => [r.id, { ...partirCategoria(r.complete_name), completo: r.complete_name }]));
}

/** Nombres de categorías raíz de product.category (para el filtro Categoría), sin las excluidas. */
export async function getCategoriasRaiz(): Promise<string[]> {
  const cats = await getCategorias();
  return [...new Set([...cats.values()].map((c) => c.categoria))]
    .filter((c) => !CATEGORIAS_EXCLUIDAS.includes(c))
    .sort((a, b) => a.localeCompare(b, 'es'));
}

/** Años desde la primera factura de cliente posteada hasta hoy (opciones del filtro Año), el más nuevo primero. */
export async function getAniosDisponibles(): Promise<number[]> {
  return withTtlCache('rentabilidad:anios', 10 * 60_000, async () => {
    const first = await searchRead<{ invoice_date: string }>({
      model: 'account.move',
      domain: [
        ['move_type', '=', 'out_invoice'],
        ['state', '=', 'posted'],
        ['invoice_date', '!=', false],
      ],
      fields: ['invoice_date'],
      order: 'invoice_date asc',
      limit: 1,
    });
    const actual = Number(getArgentinaTodayIso().slice(0, 4));
    const desde = first[0] ? Number(first[0].invoice_date.slice(0, 4)) : actual;
    const out: number[] = [];
    for (let y = actual; y >= desde; y--) out.push(y);
    return out;
  });
}

type GrupoRow = OdooReadGroupResult & {
  partner_id: [number, string] | false;
  product_id: [number, string] | false;
  price_subtotal: number;
  quantity: number;
};

/** Ventas (neto de NC) del año a granularidad cliente x variante x mes. Cacheado 60s por (año, categoría). */
export async function getVentasDataset(anio: number, categoria: string | null = null, empresaId: number | null = null): Promise<VentasDataset> {
  return withTtlCache(`rentabilidad:ventas:${anio}:${categoria ?? '*'}:${empresaId ?? 'ambas'}:${patronesExcluidos().join(',')}`, TTL_MS, () => fetchVentasDataset(anio, categoria, empresaId));
}

/** Compañías de Odoo (opciones del filtro Empresa). */
export async function getEmpresas(): Promise<{ id: number; nombre: string }[]> {
  return (await getClientesActivosCompanies()).map((c) => ({ id: c.id, nombre: c.name }));
}

async function fetchVentasDataset(anio: number, categoria: string | null, empresaId: number | null): Promise<VentasDataset> {
  const desde = `${anio}-01-01`;
  const hasta = `${anio + 1}-01-01`;

  const categorias = await getCategorias();

  const base: OdooDomain = [
    ['parent_state', '=', 'posted'],
    ['display_type', '=', 'product'],
    ['invoice_date', '>=', desde],
    ['invoice_date', '<', hasta],
  ];
  // company_id de la línea = compañía que facturó. null = ambas (Frontera Living S.A + Presupuesto).
  if (empresaId !== null) base.push(['company_id', '=', empresaId]);
  const idsExcluidos = [...categorias.entries()].filter(([, c]) => CATEGORIAS_EXCLUIDAS.includes(c.categoria) || CATEGORIAS_EXCLUIDAS_EXACTAS.includes(c.completo)).map(([id]) => id);
  if (idsExcluidos.length > 0) base.push(['product_id.categ_id', 'not in', idsExcluidos]);
  if (categoria) {
    const idsCategoria = [...categorias.entries()].filter(([, c]) => c.categoria === categoria).map(([id]) => id);
    base.push(['product_id.categ_id', 'in', idsCategoria.length > 0 ? idsCategoria : [0]]);
  }

  const exclusionesNC: OdooDomain = patronesExcluidos().map((patron) => ['product_id.name', 'not ilike', patron]);
  const agrupar = (tipo: 'out_invoice' | 'out_refund') =>
    readGroup({
      model: 'account.move.line',
      domain: [['move_type', '=', tipo], ...base, ...(tipo === 'out_refund' ? exclusionesNC : [])],
      fields: ['price_subtotal', 'quantity'],
      groupBy: ['partner_id', 'product_id', 'invoice_date:month'],
      lazy: false,
    }) as Promise<GrupoRow[]>;

  const [facturas, notas] = await Promise.all([agrupar('out_invoice'), agrupar('out_refund')]);

  // product.product (variante) -> product.template + categoría; res.partner -> partner comercial (+ región).
  const variantIds = new Set<number>();
  const partnerIds = new Set<number>();
  for (const g of [...facturas, ...notas]) {
    if (g.product_id) variantIds.add(g.product_id[0]);
    if (g.partner_id) partnerIds.add(g.partner_id[0]);
  }

  type VarRow = { id: number; product_tmpl_id: [number, string]; categ_id: [number, string] | false };
  type PartnerRow = { id: number; name: string; commercial_partner_id: [number, string] | false; region_id?: [number, string] | false };
  const leerPartners = (ids: number[]) =>
    Promise.all(
      chunks(ids, ID_CHUNK).map((c) =>
        searchReadAll<PartnerRow>({
          model: 'res.partner',
          domain: [['id', 'in', c]],
          fields: ['name', 'commercial_partner_id', 'region_id'],
          context: { active_test: false },
        })
      )
    ).then((r) => r.flat());

  const [variantRows, partnerRows] = await Promise.all([
    Promise.all(
      chunks([...variantIds], ID_CHUNK).map((ids) =>
        searchReadAll<VarRow>({
          model: 'product.product',
          domain: [['id', 'in', ids]],
          fields: ['product_tmpl_id', 'categ_id'],
          context: { active_test: false },
        })
      )
    ).then((r) => r.flat()),
    leerPartners([...partnerIds]),
  ]);

  const tmplByVariant = new Map<number, number>();
  const productos: Record<number, ProductoMeta> = {};
  for (const v of variantRows) {
    const tid = v.product_tmpl_id[0];
    tmplByVariant.set(v.id, tid);
    if (!productos[tid]) {
      const cat = v.categ_id ? categorias.get(v.categ_id[0]) : undefined;
      productos[tid] = {
        name: v.product_tmpl_id[1],
        categoria: cat?.categoria ?? '(sin categoría)',
        subcategoria: cat?.subcategoria ?? SIN_SUBCATEGORIA,
      };
    }
  }
  productos[0] = { name: SIN_PRODUCTO, categoria: '(sin categoría)', subcategoria: SIN_SUBCATEGORIA };

  // El recargo vive en el partner comercial: se leen esos registros (pueden ser distintos de los de las líneas).
  const comercialByPartner = new Map<number, number>();
  for (const p of partnerRows) comercialByPartner.set(p.id, p.commercial_partner_id ? p.commercial_partner_id[0] : p.id);
  const comercialRows = await leerPartners([...new Set(comercialByPartner.values())]);
  const clientes: Record<number, string> = { 0: '(sin cliente)' };
  const recargos: Record<number, number> = {};
  for (const c of comercialRows) {
    clientes[c.id] = c.name;
    const r = c.region_id ? recargoDeRegion(c.region_id[1]) : null;
    if (r !== null) recargos[c.id] = r;
  }

  const acumulado = new Map<string, VentaGrano>();
  const sumar = (rows: GrupoRow[], signo: 1 | -1) => {
    for (const g of rows) {
      const mesDesde = g.__range?.['invoice_date:month']?.from;
      if (!mesDesde) continue;
      const mes = Number(mesDesde.slice(5, 7));
      const clienteId = g.partner_id ? (comercialByPartner.get(g.partner_id[0]) ?? g.partner_id[0]) : 0;
      const varianteId = g.product_id ? g.product_id[0] : 0;
      const templateId = tmplByVariant.get(varianteId) ?? 0;
      const key = `${clienteId}|${varianteId}|${mes}`;
      const fila = acumulado.get(key) ?? { clienteId, varianteId, templateId, mes, subtotal: 0, cantidad: 0 };
      fila.subtotal += signo * g.price_subtotal;
      fila.cantidad += signo * g.quantity;
      acumulado.set(key, fila);
    }
  };
  sumar(facturas, 1);
  sumar(notas, -1);

  return { anio, grano: [...acumulado.values()], clientes, recargos, productos };
}

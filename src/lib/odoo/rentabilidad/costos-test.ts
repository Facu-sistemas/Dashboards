import { searchReadAll } from '@/lib/odoo/client';
import { withTtlCache } from '@/lib/cache';
import { COMPANIA_COSTOS } from '@/lib/odoo/rentabilidad/contribucion';
import { claveTexto, leerPestana, numeroAR } from '@/lib/odoo/rentabilidad/planilla-google';

/**
 * Tab "Costos (test)" de Finanzas: la pestaña `Costos` de la planilla de rentabilidad (código de barras, nombre, costo,
 * categoría, volumen, cantidad de patas, largo de tela, precio de venta) armada EN VIVO desde Odoo, y contrastada fila por
 * fila contra lo que dice la planilla. Solo lectura.
 *
 * Mapeo (verificado contra la planilla, coincide al centavo en los productos que están en las dos):
 *   Código de barras -> product.product.barcode        Costo           -> standard_price (compañía 1, como la planilla)
 *   Nombre           -> product.product.name           Categoría       -> categ_id.complete_name
 *   Volumen          -> volume                         Cantidad patas  -> x_studio_cantidad_patas
 *   Largo de tela    -> cloth_length                   Precio de venta -> lst_price
 */

const TTL_MS = 60_000;

/** Categorías que la planilla no lista: productos intermedios (PI, salvo Block Espuma), financieros, garantías y consumibles. */
export function categoriaFueraDeCostos(categoria: string): boolean {
  const c = categoria.trim().toLowerCase();
  if (c === 'pi' || (c.startsWith('pi /') && c !== 'pi / block espuma')) return true;
  return c === 'financiero' || c === 'garantia' || c === 'materiales consumibles';
}

export interface CostoProducto {
  varianteId: number;
  codigo: string;
  nombre: string;
  costo: number;
  categoria: string;
  volumen: number;
  patas: number;
  largoTela: number;
  precioVenta: number;
  /** Tiempo estimado de línea (hs) cargado en Odoo (x_studio_tiempo_estimado). Lo usa "Costos productos (test)". */
  tiempoHs: number;
  /** Grupo de la tela (x_studio_grupo: 2, 3 o 4; 0 = sin asignar). Solo tiene sentido en telas. */
  grupo: number;
}

interface VarianteOdoo extends Record<string, unknown> {
  id: number;
  barcode: string | false;
  name: string;
  standard_price: number;
  categ_id: [number, string] | false;
  volume: number;
  x_studio_cantidad_patas: number;
  cloth_length: number;
  lst_price: number;
  x_studio_tiempo_estimado: number;
  x_studio_grupo: number;
}

/** Todos los productos con código de barras, con los campos de la pestaña Costos. Cacheado 60 s. */
export async function getProductosOdoo(): Promise<CostoProducto[]> {
  return withTtlCache('rentabilidad-test:productos-odoo', TTL_MS, async () => {
    const rows = await searchReadAll<VarianteOdoo>({
      model: 'product.product',
      domain: [['barcode', '!=', false]],
      fields: ['barcode', 'name', 'standard_price', 'categ_id', 'volume', 'x_studio_cantidad_patas', 'cloth_length', 'lst_price', 'x_studio_tiempo_estimado', 'x_studio_grupo'],
      context: { allowed_company_ids: [COMPANIA_COSTOS] },
    });
    return rows.map((r) => ({
      varianteId: r.id,
      codigo: String(r.barcode),
      nombre: r.name,
      costo: r.standard_price,
      categoria: r.categ_id ? r.categ_id[1] : '(sin categoría)',
      volumen: r.volume,
      patas: r.x_studio_cantidad_patas,
      largoTela: r.cloth_length,
      precioVenta: r.lst_price,
      tiempoHs: r.x_studio_tiempo_estimado,
      grupo: r.x_studio_grupo || 0,
    }));
  });
}

export interface CostoPlanilla {
  codigo: string;
  nombre: string;
  costo: number | null;
  categoria: string;
  volumen: number | null;
  patas: number | null;
  largoTela: number | null;
  precioVenta: number | null;
}

/** Pestaña `Costos` de la planilla (columnas A-H). */
export async function getCostosPlanilla(): Promise<CostoPlanilla[]> {
  const filas = await leerPestana('costos');
  return filas
    .slice(1)
    .filter((f) => (f[0] ?? '').trim() !== '')
    .map((f) => ({
      codigo: f[0]!.trim(),
      nombre: f[1] ?? '',
      costo: numeroAR(f[2]),
      categoria: f[3] ?? '',
      volumen: numeroAR(f[4]),
      patas: numeroAR(f[5]),
      largoTela: numeroAR(f[6]),
      precioVenta: numeroAR(f[7]),
    }));
}

export type CampoCosto = 'nombre' | 'costo' | 'categoria' | 'volumen' | 'patas' | 'largoTela' | 'precioVenta';
export type EstadoCosto = 'ok' | 'difiere' | 'solo-odoo';

export interface CostoFila extends CostoProducto {
  estado: EstadoCosto;
  /** Campos que no coinciden con la planilla (solo si estado = 'difiere'). */
  difs: CampoCosto[];
  /** Valores de la planilla para esos campos (solo si estado = 'difiere'). */
  planilla: Partial<Record<CampoCosto, string | number | null>> | null;
}

export interface CostosResultado {
  filas: CostoFila[];
  /** Productos que están en la planilla y no en Odoo (con esas categorías visibles). */
  soloPlanilla: CostoPlanilla[];
  categorias: string[];
  resumen: {
    enOdoo: number;
    enPlanilla: number;
    coinciden: number;
    difieren: number;
    soloOdoo: number;
    soloPlanilla: number;
    /** Cantidad de diferencias por campo. */
    porCampo: Record<CampoCosto, number>;
  };
  generado: string;
}

const iguales = (a: number, b: number | null, tol = 0.01) => b !== null && Math.abs(a - b) <= tol;
const normCategoria = (s: string) => s.replace(/\s*\/\s*/g, '/').trim().toLowerCase();

export async function getCostosTest(): Promise<CostosResultado> {
  const [odoo, planilla] = await Promise.all([getProductosOdoo(), getCostosPlanilla()]);
  const visibles = odoo.filter((p) => !categoriaFueraDeCostos(p.categoria));
  const porCodigo = new Map(planilla.map((p) => [p.codigo, p]));
  const codigosOdoo = new Set(odoo.map((p) => p.codigo));

  const porCampo: Record<CampoCosto, number> = { nombre: 0, costo: 0, categoria: 0, volumen: 0, patas: 0, largoTela: 0, precioVenta: 0 };
  let coinciden = 0;
  let difieren = 0;
  let soloOdoo = 0;

  const filas: CostoFila[] = visibles.map((p) => {
    const pl = porCodigo.get(p.codigo);
    if (!pl) {
      soloOdoo++;
      return { ...p, estado: 'solo-odoo', difs: [], planilla: null };
    }
    const difs: CampoCosto[] = [];
    if (claveTexto(p.nombre) !== claveTexto(pl.nombre)) difs.push('nombre');
    if (!iguales(p.costo, pl.costo)) difs.push('costo');
    if (normCategoria(p.categoria) !== normCategoria(pl.categoria)) difs.push('categoria');
    if (!iguales(p.volumen, pl.volumen, 0.005)) difs.push('volumen');
    if (!iguales(p.patas, pl.patas, 0)) difs.push('patas');
    if (!iguales(p.largoTela, pl.largoTela, 0.005)) difs.push('largoTela');
    if (!iguales(p.precioVenta, pl.precioVenta)) difs.push('precioVenta');
    if (difs.length === 0) {
      coinciden++;
      return { ...p, estado: 'ok', difs: [], planilla: null };
    }
    difieren++;
    for (const d of difs) porCampo[d]++;
    const valores: CostoFila['planilla'] = {};
    for (const d of difs) valores[d] = pl[d];
    return { ...p, estado: 'difiere', difs, planilla: valores };
  });

  const soloPlanilla = planilla.filter((p) => !codigosOdoo.has(p.codigo));
  const categorias = [...new Set(filas.map((f) => f.categoria))].sort((a, b) => a.localeCompare(b, 'es'));

  return {
    filas,
    soloPlanilla,
    categorias,
    resumen: {
      enOdoo: visibles.length,
      enPlanilla: planilla.length,
      coinciden,
      difieren,
      soloOdoo,
      soloPlanilla: soloPlanilla.length,
      porCampo,
    },
    generado: new Date().toISOString(),
  };
}

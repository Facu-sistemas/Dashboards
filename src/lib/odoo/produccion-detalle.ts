import { getFronteraCompany } from './reference';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS, getArgentinaTodayIso } from './oee';
import { getEquivalenteByTemplate } from './producto-equivalente';
import { fetchMonthlyRows } from './produccion-gerencia';

/**
 * Desglose por producto de los totales de "Producción" (Gerencia General):
 * mismas filas de `mrp.production` que produccion-gerencia.ts, pero
 * agrupadas por `product_tmpl_id` en vez de sumadas en un solo total —
 * responde "¿qué modelos componen esos 1597 sillones UE / 10158
 * colchones?". Igual que ahí, sillones en UE (qty_produced ×
 * x_studio_equivalente_produccion) y colchones en cantidad cruda son la
 * medida "nativa" de cada categoría, pero se exponen ambas medidas por
 * producto para que el toggle de la pestaña pueda mostrar cualquiera.
 *
 * `familia` y `modelo` NO salen de `product.template.categ_id` —
 * confirmado en vivo que esa categoría no distingue modelos (cada
 * variante de tela/color de un mismo sillón quedaba como su propio
 * grupo). El nombre de cada producto puntual trae el modelo y la
 * tela/color separados por " - " ("STELLA SOFA ELECTRICO 2/3 CPO -
 * CUEROTEX STONE", "MOVEX SOFA 2/3 CPO (STD) - DENSE HERMES 21#") — de ahí
 * se derivan ambos niveles: `modelo` es todo antes del " - " (agrupa las
 * telas/colores de un mismo sillón, que es lo que la pestaña llama
 * "Producto" — la variante de tela sola no tenía sentido como fila propia)
 * y `familia` es la primera palabra del modelo (Stella, Movex, Sirius,
 * Onix...).
 */

export interface ProduccionDetalleProducto {
  nombre: string;
  modelo: string;
  familia: string;
  categoria: 'sillones' | 'colchones';
  /** Un valor por mes del año en curso (índice 0 = enero), igual que el resto de Gerencia General. */
  cant: number[];
  ue: number[];
}

export interface ProduccionDetalleResult {
  year: number;
  mesesConDatos: number;
  productos: ProduccionDetalleProducto[];
}

function extraerModelo(nombre: string): string {
  return nombre.split(' - ')[0]?.trim() || nombre;
}

/** "STELLA SOFA ELECTRICO 2/3 CPO" -> "STELLA" (primera palabra del modelo). */
function extraerFamilia(modelo: string): string {
  return modelo.split(/\s+/)[0] || 'Sin familia';
}

function sumarPorProducto(
  rows: { date_finished: string; qty_produced: number; product_tmpl_id?: [number, string] }[],
  mesesConDatos: number,
  ueByTemplate: Map<number, number>,
  categoria: 'sillones' | 'colchones',
): ProduccionDetalleProducto[] {
  const porTemplate = new Map<number, ProduccionDetalleProducto>();
  for (const r of rows) {
    const tmplId = r.product_tmpl_id?.[0];
    if (tmplId === undefined) continue;
    const nombre = r.product_tmpl_id![1];
    let p = porTemplate.get(tmplId);
    if (!p) {
      const modelo = extraerModelo(nombre);
      p = { nombre, modelo, familia: extraerFamilia(modelo), categoria, cant: new Array(mesesConDatos).fill(0), ue: new Array(mesesConDatos).fill(0) };
      porTemplate.set(tmplId, p);
    }
    const mes = Number(r.date_finished.slice(5, 7)) - 1;
    if (mes < 0 || mes >= mesesConDatos) continue;
    p.cant[mes]! += r.qty_produced;
    p.ue[mes]! += r.qty_produced * (ueByTemplate.get(tmplId) ?? 0);
  }
  return [...porTemplate.values()];
}

export async function getProduccionDetalle(): Promise<ProduccionDetalleResult> {
  const today = getArgentinaTodayIso();
  const year = Number(today.slice(0, 4));
  const mesesConDatos = Number(today.slice(5, 7));
  const start = `${year}-01-01`;
  const endExclusive = `${year + 1}-01-01`;

  const { companyId } = await getFronteraCompany();

  const [livingRows, colchonesRows] = await Promise.all([
    fetchMonthlyRows(LIVING_CATEG_IDS, companyId, start, endExclusive, true),
    fetchMonthlyRows(COLCHONES_CATEG_IDS, companyId, start, endExclusive, true),
  ]);

  const templateIds = [
    ...new Set([...livingRows, ...colchonesRows].map((r) => r.product_tmpl_id?.[0]).filter((id): id is number => id !== undefined)),
  ];
  const ueByTemplate = await getEquivalenteByTemplate(templateIds);

  const productos = [
    ...sumarPorProducto(livingRows, mesesConDatos, ueByTemplate, 'sillones'),
    ...sumarPorProducto(colchonesRows, mesesConDatos, ueByTemplate, 'colchones'),
  ];

  return { year, mesesConDatos, productos };
}

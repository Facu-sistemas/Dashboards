import { searchReadAll } from '@/lib/odoo/client';
import { getParametrosCosteo } from '@/lib/supabase/rentabilidad-config';
import { TIEMPOS_PLANILLA_HS } from '@/lib/odoo/rentabilidad/tiempos-planilla';
import type { ModoCostos, ProveedorCostoInfo } from '@/lib/rentabilidad/types';

/**
 * Capa de costos del módulo Rentabilidad: costo unitario de lo vendido, en ARS.
 *
 * Implementa lo que se puede reproducir desde Odoo de la planilla de
 * rentabilidad (ver LOGICA-EXCEL.md, secciones 2.2 y 3.2):
 *
 *   Contribución $ = Monto s/flete - (Costo MP + Costo MOD+indirecta) x cantidad
 *   MP  = standard_price de la variante + (Largo de tela del modelo x precio de la tela)
 *   MOD = Tiempo estimado (hs) x valor hora productivo   (x 1,55 si no es colchón)
 *
 * Fuentes en Odoo (verificadas en vivo, 2026-10):
 *  - `product.product.standard_price` = columna "Costo" de la planilla (NO incluye
 *    la tela: Sirius 1/3 da 123.510,48 igual que la planilla, que suma la tela aparte).
 *  - `product.product.x_studio_tiempo_estimado` = tiempo de línea (hs). Coincide con
 *    la planilla en sillones (Sirius 4,0667 hs) pero NO en colchones/espumas
 *    (Odoo 0,1305 hs vs planilla 0,1989 hs en la espuma de cuna; resorte 0,0645 vs
 *    0,5292), y el campo UE (x_studio_equivalente_produccion) tampoco se relaciona
 *    linealmente con las horas de la planilla. Para colchones se usa la hoja
 *    "Tiempos colchones" embebida abajo (reproduce el MOD de los casos 2 y 6).
 *    PI y colchones Varios quedan SIN COSTO (mod = null), no se inventa.
 *  - `product.template.cloth_length` (Largo de tela) del producto padre
 *    (`x_studio_producto_padre` de la variante); la tela de la variante es el
 *    `product.product` cuyo código de barras es el tramo `MP04...` del de la variante.
 *    Se usa su `standard_price` ACTUAL; la planilla usa la hoja manual "Telas"
 *    (Cuero Silk: 3.848,10 en Odoo vs 3.556,00 en la planilla).
 *  - Categorías sin MO (Reventa, Bonificación, Scrap, Materia Prima, Servicio,
 *    Financiero, Garantía): MP = standard_price, MOD = 0.
 *
 * NO está en Odoo (parámetros editables, tabla rentabilidad_parametros_costeo, con
 * defaults de la planilla): valor hora productivo por mes, coeficiente de
 * indirecta (1,55) y los pozos de no productiva / fijos (no entran en la
 * contribución de fila, solo en la rentabilidad; no se calculan acá).
 *
 * Limitación: standard_price es el costo VIGENTE en Odoo, no el histórico del
 * mes de la factura; el valor hora sí es el del mes.
 */

/** Costo por UNIDAD vendida, en ARS. `null` = no se conoce: la línea queda "sin costo". */
export interface CostoUnitario {
  /** Materia prima. */
  mp: number | null;
  /** Mano de obra directa + indirecta. */
  mod: number | null;
  /** Costos fijos asignados (no entran en la contribución de fila). */
  fijos: number | null;
}

export interface CostoProvider {
  readonly id: string;
  readonly descripcion: string;
  /** false = stub sin datos. */
  readonly activo: boolean;
  /**
   * Costos unitarios por variante (product.product) y mes del año dado.
   * Clave del Map: `costoKey(varianteId, mes)`. Lo que no se pueda costear no
   * aparece (o trae null): queda "sin costo".
   */
  getCostosUnitarios(anio: number, varianteIds: number[], meses: number[], modo: ModoCostos): Promise<Map<string, CostoUnitario>>;
}

export function costoKey(varianteId: number, mes: number): string {
  return `${varianteId}|${mes}`;
}

export class CostoProviderStub implements CostoProvider {
  readonly id = 'stub';
  readonly descripcion = 'Sin costos: pendiente de implementar el costeo desde Odoo (ver LOGICA-EXCEL.md).';
  readonly activo = false;

  async getCostosUnitarios(): Promise<Map<string, CostoUnitario>> {
    return new Map();
  }
}

// --- Defaults de la planilla (LOGICA-EXCEL.md, "Series de parámetros por mes") ---

const VALOR_HORA_DEFECTO_ACTUAL = 20869.1054;
/** Valor hora productivo por mes "YYYY-MM". Meses no listados usan el último vigente. */
const VALOR_HORA_POR_MES: Record<string, number> = {
  '2025-10': 20869.1054,
  '2025-11': 20869.1054,
  '2025-12': 20869.1054,
  '2026-01': 17858.8658,
  '2026-02': 17883.8939,
  '2026-03': 18550.1929,
  '2026-04': 19830.254,
  '2026-05': 19898.4493,
  '2026-06': 20869.1054,
  '2026-07': 20869.1054,
  '2026-08': 20869.1054,
  '2026-09': 20869.1054,
};
const COEF_INDIRECTA_DEFECTO = 1.55;

/** Categorías sin MO ni fijos en la planilla (COUNTIF con comodines, sin distinguir mayúsculas). */
const SIN_MO = ['reventa', 'bonificacion', 'scrap', 'materia prima', 'servicio', 'financiero', 'garantia'];

function sinMO(categoria: string): boolean {
  const c = categoria.toLowerCase();
  return SIN_MO.some((s) => c.includes(s));
}

function esSillon(categoria: string): boolean {
  return categoria.toLowerCase().startsWith('sillon');
}

const ID_CHUNK = 800;

/**
 * standard_price es company_dependent en Odoo (verificado: en la compañía 2 "Presupuesto" vale 0 para todos los
 * productos). Se lee SIEMPRE en el contexto de la compañía 1 "Frontera Living S.A" (la misma que usa la planilla),
 * sin importar en qué compañía se facturó la línea.
 */
export const COMPANIA_COSTOS = 1;
const CONTEXTO_COSTOS = { active_test: false, allowed_company_ids: [COMPANIA_COSTOS] };
function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Tela de una variante: el código de barras de tela (categoría Materia Prima / Tela Living) más largo contenido en el de la variante ("0137S13STDRMP04C40116" -> "MP04C40116"). */
export function codigoTela(barcode: string, codigosTela: string[]): string | null {
  let mejor: string | null = null;
  for (const c of codigosTela) if (barcode.includes(c) && (mejor === null || c.length > mejor.length)) mejor = c;
  return mejor;
}

// --- Tiempos de colchones: hoja "Tiempos colchones" de la planilla (septiembre 2026), en DÍAS (fracción) ---
// hs = días x 24. Clave: categoría de Odoo -> grupo de medida -> detalle. El grupo sale del ancho del nombre
// (<=120 Grupo 1; 130-150 Grupo 2; >=160 Grupo 3, regla deducida de "Colchones capacidad", 483 filas) y el
// detalle de unos pocos modelos (Olimpo, Select/Sense = Remallado, Zafiro = Manija/aireador, Cuna).
const TIEMPOS_COLCHON_DIAS: Record<string, Record<string, number>> = {
  'Colchones / Bases': { '1': 0.013888888888888888, '2': 0.015277777777777777, '1Olimpo': 0.01597222222222222, '2Olimpo': 0.017361111111111112 },
  'Colchones / Eps': { '1': 0.0140625, '2': 0.017881944444444443, '3': 0.020902777777777777 },
  'Colchones / Espuma': {
    '1': 0.010543981481481482, '1Remallado': 0.011932870370370371, '1Manija': 0.012824074074074075,
    '2': 0.014097222222222223, '2Remallado': 0.016064814814814813, '2Manija': 0.016377314814814813,
    '3': 0.01857638888888889, '3Remallado': 0.021030092592592593, '3Manija': 0.020856481481481483,
    cuna: 0.008287037037037037,
  },
  'Colchones / Resorte': {
    '1': 0.0203125, '2': 0.02204861111111111, '3': 0.024375,
    '1Remallado': 0.021701388888888888, '2Remallado': 0.02332175925925926, '3Remallado': 0.026828703703703705,
  },
};

/** Tiempo de línea (hs) de un colchón según la hoja de la planilla, o null si no hay dato (queda sin costo). */
export function tiempoColchonHs(categoria: string, nombre: string): number | null {
  const tabla = TIEMPOS_COLCHON_DIAS[categoria];
  if (!tabla) return null;
  const n = nombre.toUpperCase();
  const m = /(\d{2,3})X(\d{2,3})/.exec(n);
  if (!m) return null;
  if (categoria === 'Colchones / Espuma' && n.includes('CUNA')) return tabla['cuna']! * 24;
  const ancho = Number(m[1]);
  const grupo = ancho <= 120 ? '1' : ancho <= 150 ? '2' : '3';
  let detalle = '';
  if (/OLIMPO/.test(n)) detalle = 'Olimpo';
  else if (/ESPUMA (SELECT|SENSE)/.test(n)) detalle = 'Remallado';
  else if (/ESPUMA ZAFIRO/.test(n)) detalle = 'Manija';
  const dias = tabla[grupo + detalle];
  return dias === undefined ? null : dias * 24;
}

interface VarianteCosto {
  id: number;
  name: string;
  barcode: string | false;
  standard_price: number;
  x_studio_tiempo_estimado: number;
  categ_id: [number, string] | false;
  x_studio_producto_padre: [number, string] | false;
}

export class CostoProviderOdoo implements CostoProvider {
  readonly id = 'odoo-excel';
  readonly descripcion =
    'Costo MP (standard_price + tela) y MOD (tiempo x valor hora) desde Odoo; tiempos de colchones y de algunos productos tomados de la planilla (tiempos-planilla.ts).';
  readonly activo = true;

  async getCostosUnitarios(anio: number, varianteIds: number[], meses: number[], modo: ModoCostos): Promise<Map<string, CostoUnitario>> {
    const usarPlanilla = modo === 'planilla';
    const params = await getParametrosCosteo();
    const coef = params['coef_indirecta_no_colchon'] ?? COEF_INDIRECTA_DEFECTO;
    const valorHora = (mes: number): number => {
      const clave = `${anio}-${String(mes).padStart(2, '0')}`;
      return params[`valor_hora_${anio}_${String(mes).padStart(2, '0')}`] ?? params['valor_hora_productivo'] ?? VALOR_HORA_POR_MES[clave] ?? VALOR_HORA_DEFECTO_ACTUAL;
    };

    const variantes = (
      await Promise.all(
        chunks(varianteIds, ID_CHUNK).map((ids) =>
          searchReadAll<VarianteCosto & Record<string, unknown>>({
            model: 'product.product',
            domain: [['id', 'in', ids]],
            fields: ['name', 'barcode', 'standard_price', 'x_studio_tiempo_estimado', 'categ_id', 'x_studio_producto_padre'],
            context: CONTEXTO_COSTOS,
          })
        )
      )
    ).flat();

    // Largo de tela por producto padre y precio de cada tela (por código de barras).
    const padreIds = [...new Set(variantes.map((v) => (v.x_studio_producto_padre ? v.x_studio_producto_padre[0] : 0)).filter((id) => id > 0))];
    const [padres, telas] = await Promise.all([
      Promise.all(
        chunks(padreIds, ID_CHUNK).map((ids) =>
          searchReadAll<{ id: number; cloth_length: number }>({
            model: 'product.template',
            domain: [['id', 'in', ids]],
            fields: ['cloth_length'],
            context: CONTEXTO_COSTOS,
          })
        )
      ).then((r) => r.flat()),
      searchReadAll<{ barcode: string | false; standard_price: number }>({
        model: 'product.product',
        domain: [['categ_id.complete_name', '=', 'Materia Prima / Tela Living']],
        fields: ['barcode', 'standard_price'],
        context: CONTEXTO_COSTOS,
      }),
    ]);
    const largoPorPadre = new Map(padres.map((p) => [p.id, p.cloth_length]));
    const precioTela = new Map(telas.filter((t) => t.barcode).map((t) => [t.barcode as string, t.standard_price]));
    const codigosTela = [...precioTela.keys()];

    const out = new Map<string, CostoUnitario>();
    for (const v of variantes) {
      const categoria = v.categ_id ? v.categ_id[1] : '';
      let mp: number | null = v.standard_price;
      const hsPlanilla = usarPlanilla && v.barcode ? TIEMPOS_PLANILLA_HS[v.barcode] : undefined;
      let moBase: number | null;
      let indirecta = 1;

      if (sinMO(categoria)) {
        moBase = 0;
      } else if (esSillon(categoria)) {
        const largo = v.x_studio_producto_padre ? (largoPorPadre.get(v.x_studio_producto_padre[0]) ?? 0) : 0;
        const cod = v.barcode ? codigoTela(v.barcode, codigosTela) : null;
        const precio = cod ? precioTela.get(cod) : undefined;
        if (largo > 0) {
          // Si el modelo usa tela pero no se encuentra su precio, el MP no es confiable: sin costo.
          mp = precio !== undefined ? mp + largo * precio : null;
        }
        moBase = hsPlanilla ?? v.x_studio_tiempo_estimado;
        indirecta = coef;
      } else if (categoria === 'PI / Block Espuma') {
        // Odoo tiene 0 hs; la planilla usa 0,05 hs (tiempos-planilla.ts). Sin ese dato queda sin costo.
        moBase = hsPlanilla ?? null;
        indirecta = coef;
      } else if (categoria.toLowerCase().startsWith('colchones')) {
        // El tiempo de Odoo no sirve para colchones: se usa la hoja "Tiempos colchones" de la planilla (ver tiempoColchonHs).
        moBase = hsPlanilla ?? tiempoColchonHs(categoria, v.name);
      } else {
        // PI (Block Espuma, etc.) y otras: sin fuente de tiempos -> sin costo.
        moBase = null;
      }

      for (const mes of meses) {
        out.set(costoKey(v.id, mes), {
          mp,
          mod: moBase === null ? null : moBase * valorHora(mes) * indirecta,
          fijos: null,
        });
      }
    }
    return out;
  }
}

const proveedorActivo: CostoProvider = new CostoProviderOdoo();

export function getCostoProvider(): CostoProvider {
  return proveedorActivo;
}

export function infoProveedor(p: CostoProvider, modo: ModoCostos): ProveedorCostoInfo {
  return { id: p.id, descripcion: p.descripcion, activo: p.activo, modo };
}

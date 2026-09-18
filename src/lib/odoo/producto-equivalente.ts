import { searchReadAll } from './client';

/**
 * "Unidad Equivalente" (UE) — multiplicador por `product.template`
 * (`x_studio_equivalente_produccion`) que pondera cada sillón vendido según
 * cuánto "cuenta" ese modelo (un modelo grande pesa más que uno chico).
 * Mismo campo que ya usa Producción > Plan de Producción
 * (plan-produccion.ts) para su propio "UE real vs objetivo" de Living.
 *
 * Confirmado en vivo (2026-09-18) contra el dato cargado a mano en la
 * planilla histórica: "Sillones equivalente" de Agosto (VENTAS REALES,
 * celda K61) = 1281, tipeado a mano por alguien mirando Odoo. Sillon/Lean +
 * Sillon/Tradicional + Sillon/Deliveries (unidades crudas, product_uom_qty)
 * ponderadas por este campo dan 1279,8 — dentro de <0,1% de esa referencia.
 * Sillon/Accesorio no tiene este campo cargado (multiplica a 0) y por eso
 * queda afuera del cálculo — no hace falta excluirlo explícitamente del
 * dominio, el propio campo lo neutraliza.
 *
 * `active_test: false` es obligatorio en ambas consultas: varios modelos
 * de sillón vendidos en el pasado ya están archivados (`active = false`)
 * hoy en Odoo — sin este contexto, `search_read` los excluye en
 * silencio y esos renglones quedan con UE 0 (confirmado en vivo: sin esto,
 * Agosto daba 1222 en vez de 1279,8 — perdía justo las ventas de modelos
 * ya discontinuados).
 */
export async function getEquivalenteByTemplate(templateIds: number[]): Promise<Map<number, number>> {
  if (templateIds.length === 0) return new Map();
  const templates = await searchReadAll<{ id: number; x_studio_equivalente_produccion: number }>({
    model: 'product.template',
    domain: [['id', 'in', templateIds]],
    fields: ['x_studio_equivalente_produccion'],
    context: { active_test: false },
  });
  return new Map(templates.map((t) => [t.id, t.x_studio_equivalente_produccion || 0]));
}

export async function getTemplateIdByVariant(variantIds: number[]): Promise<Map<number, number>> {
  if (variantIds.length === 0) return new Map();
  const variants = await searchReadAll<{ id: number; product_tmpl_id: [number, string] }>({
    model: 'product.product',
    domain: [['id', 'in', variantIds]],
    fields: ['product_tmpl_id'],
    context: { active_test: false },
  });
  return new Map(variants.map((v) => [v.id, v.product_tmpl_id[0]]));
}

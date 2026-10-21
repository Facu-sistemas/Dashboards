/**
 * Notas de crédito que NO restan de la venta de Rentabilidad. Un solo lugar para
 * cambiar el criterio. Se detectan por el NOMBRE DEL PRODUCTO de la línea de
 * la N/C (mismo criterio que PRODUCTO_NO_DEVOLUCION de notas-credito-devolucion.ts;
 * el motivo/nota de la N/C viene vacío en 148 de las 153 de septiembre 2026).
 * Se aplica solo a `out_refund`. Patrón = substring sin distinguir mayúsculas.
 *
 * DECISIÓN (oct-2026): NO se excluye ninguna. Se probaron las 64 combinaciones de restar o no
 * cada grupo de N/C (descuento, acuerdo comercial, flete, publicidad, rodados, garantía)
 * contra los totales de septiembre 2026 de la planilla (subtotal 2.909.488.042). Diferencia del
 * subtotal total contra la planilla, según qué N/C NO se restaran:
 *
 *   | N/C que no se resta             | Monto N/C   | Dif. subtotal total |
 *   |---------------------------------|-------------|---------------------|
 *   | ninguna (se restan todas)       |           - |                   0 |
 *   | acuerdo comercial (col.+sill.)  |  22.388.977 |         +22.388.977 |
 *   | rodados (categoría Servicio)    |  13.636.364 |         +13.636.364 |
 *   | flete (N/C flete)               |     707.510 |            +707.510 |
 *   | descuento                       |  27.156.132 |                   0 |
 *   | publicidad                      |     230.758 |                   0 |
 *   | garantía                        |   8.891.265 |                   0 |
 *
 * Descuento, publicidad y garantía dan 0 porque sus productos están en las categorías Financiero y
 * Garantía, que la planilla no incluye (ver CATEGORIAS_EXCLUIDAS en ventas.ts), así que no importa si
 * se restan. Con todas las N/C restadas el subtotal coincide al peso con la planilla y también los
 * subtotales por categoría de Colchones, Lean, Tradicional, Block Espuma, Reventa, Scrap y Servicio.
 * Por eso el "cuarto criterio" que recordaba el dueño no es una exclusión: la planilla resta todo.
 *
 * Los patrones quedan declarados (activo:false) por si se quiere volver a excluir alguno.
 */
export interface ExclusionNotaCredito {
  id: string;
  /** Substring (ilike) sobre el nombre del producto de la línea de la N/C. */
  patron: string;
  descripcion: string;
  activo: boolean;
}

export const EXCLUSIONES_NOTA_CREDITO: ExclusionNotaCredito[] = [
  { id: 'publicidad', patron: 'PUBLICIDAD', descripcion: 'Publicidad y propaganda', activo: false },
  { id: 'acuerdo_comercial', patron: 'ACUERDO COMERCIAL', descripcion: 'Acuerdo comercial (colchones y sillones)', activo: false },
  { id: 'flete', patron: 'FLETE', descripcion: 'Nota de crédito por servicio flete', activo: false },
  { id: 'descuento', patron: 'NOTA DE CREDITO POR DESCUENTO', descripcion: 'Descuento', activo: false },
];

export function patronesExcluidos(): string[] {
  return EXCLUSIONES_NOTA_CREDITO.filter((e) => e.activo).map((e) => e.patron);
}

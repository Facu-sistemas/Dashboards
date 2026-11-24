/**
 * Reglas de la planilla de rentabilidad sobre ventas, compartidas por los tabs "(test)" de Finanzas.
 */

/**
 * Categorías que la planilla de rentabilidad no incluye (confirmado contra sus totales de septiembre 2026:
 * con estas exclusiones el subtotal da 2.909.488.042 al peso). Por raíz, y por nombre completo exacto
 * (la categoría "PI" suelta, no sus hijas como "PI / Block Espuma").
 */
export const CATEGORIAS_EXCLUIDAS = ['Financiero', 'Garantia', 'Materia Prima'];
export const CATEGORIAS_EXCLUIDAS_EXACTAS = ['PI'];

/** "COSTA BS AS - 12,5%" -> 0.125. null si el texto no trae porcentaje. */
export function recargoDeRegion(nombreRegion: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(nombreRegion);
  return m ? Number(m[1]!.replace(',', '.')) / 100 : null;
}

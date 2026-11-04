/**
 * Reparto de productos entre las dos embaladoras, por nombre del producto (sirve igual para lo
 * cerrado en Odoo que para lo escaneado):
 * - Embaladora 1: Bases (de color y Olimpo), Pocket y EPS (Krom, Jade, Magnum).
 * - Embaladora 2: todo lo demás.
 */
export type Embaladora = 1 | 2;

const EMBALADORA_1 = /^(\[[^\]]*\]\s*)?(BASE|POCKET|EPS|ESP-EPS)\b/i;

export function embaladoraDe(producto: string): Embaladora {
  return EMBALADORA_1.test(producto.trim()) ? 1 : 2;
}

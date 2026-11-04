/**
 * Medidas de block por tipo, con los kg por unidad de la pestaña "KILO BLOCK ODOO" de la planilla de stock de blocks
 * (columna "kilo block odoo 07/08/2025"). Odoo maneja los blocks en kg por tipo sin medida, así que esta tabla es lo que
 * permite pasar de unidades por medida a kg y cruzar contra Odoo. Si cambia un peso o aparece una medida nueva, se edita acá.
 *
 * `odoo` es el nombre del producto de la categoría "PI / Block Espuma" sin el prefijo "POLIESTER " (null = no existe en Odoo).
 */
export interface BloqueMedida {
  tipo: string;
  medida: string;
  kgUnidad: number;
  odoo: string | null;
}

function t(tipo: string, odoo: string | null, medidas: [string, number][]): BloqueMedida[] {
  return medidas.map(([medida, kgUnidad]) => ({ tipo, medida, kgUnidad, odoo }));
}

export const BLOQUES_CATALOGO: BloqueMedida[] = [
  ...t('15 VERDE OSCURO', 'VERDE OSCURO', [['188 x 276', 92.89], ['188 x 312', 105.0]]),
  ...t('15 AMARILLO', 'AMARILLO', [['188 x 276', 90.01]]),
  ...t('18 GRIS CLARO', 'GRIS CLARO', [['188 x 276', 115.24], ['188 x 312', 130.26]]),
  ...t('20 BLANCO (V)', 'BLANCO (V)', [['188 x 276', 126.44], ['188 x 296', 135.61], ['188 x 312', 142.93], ['198 x 316', 152.46], ['198 x 356', 171.77]]),
  ...t('20 NARANJA', 'NARANJA', [['188 x 276', 120.02]]),
  ...t('26 GRIS OSCURO', 'GRIS OSCURO', [['188 x 276', 156.02]]),
  ...t('26 ROSADO', 'ROSADO', [['188 x 276', 156.02]]),
  ...t('26 SOFT - AZUL HIPER', 'AZUL - HIPER', [['188 x 276', 156.02]]),
  ...t('24 CELESTE', 'CELESTE (L)', [['188 x 276', 152.53], ['188 x 296', 163.59], ['188 x 312', 172.42], ['198 x 316', 183.92], ['198 x 356', 207.22]]),
  ...t('28 VERDE (B)', 'VERDE (B)', [['188 x 276', 176.49], ['188 x 312', 199.51], ['198 x 316', 212.81], ['198 x 356', 239.76]]),
  ...t('31 LILA (C)', 'LILA (C)', [['188 x 276', 188.71], ['188 x 312', 213.32], ['198 x 316', 227.55], ['198 x 356', 256.37]]),
  ...t('CILINDRO (BLANCO)', 'CILINDRO BLANCO 20', [['1,80 diam.', 92.15]]),
  ...t('CILINDRO (Celeste)', 'CILINDRO CELESTE 16V', [['1,80 diam.', 75.47]]),
  ...t('Cilindro ALTO 1,50', null, [['1,80 diam.', 67.43]]),
];

export function bloqueKey(tipo: string, medida: string): string {
  return `${tipo}|${medida}`;
}

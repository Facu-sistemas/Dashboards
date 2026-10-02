import type { ChartTheme } from '../shared/useChartTheme';

// Mismo truco que RotacionGastoApp: ciclar tokens de tema en vez de hardcodear
// hex — se mantiene coherente con claro/oscuro. Como máximo 5 colores
// distintos + "Otros" (6to, mutedBar) — compartido entre el gráfico y la
// tabla de Detalle de Producción para que el puntito de color de una fila
// sea el mismo que su línea/barra en el gráfico.
const PALETTE_KEYS = ['primary', 'secondary', 'warn', 'danger', 'axisSecondary', 'mutedBar'] as const;
export const MAX_DESTACADOS = PALETTE_KEYS.length - 1;

export function colorFor(theme: ChartTheme, i: number): string {
  return theme[PALETTE_KEYS[i % PALETTE_KEYS.length]!];
}

/** Color por posición en el ranking (0 = el más alto): los primeros MAX_DESTACADOS tienen color propio, el resto comparte el color de "Otros". */
export function colorPorRanking(theme: ChartTheme, rank: number): string {
  return colorFor(theme, Math.min(rank, MAX_DESTACADOS));
}

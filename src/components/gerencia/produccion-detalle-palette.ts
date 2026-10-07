import type { ChartTheme } from '../shared/useChartTheme';

// Mismo truco que RotacionGastoApp: los primeros colores ciclan tokens de tema
// en vez de hardcodear hex — se mantiene coherente con claro/oscuro. Si se
// piden más destacados que tokens (el campo "Mostrar" de la pestaña llega a
// 10/20), el resto se reparte la rueda de color por ángulo áureo, con
// saturación/luz intermedias para que se lea en ambos temas. "Otros" siempre
// va en mutedBar. Compartido entre el gráfico y la tabla de Detalle de
// Producción para que el puntito de color de una fila sea el mismo que su
// línea/barra en el gráfico.
const THEME_KEYS = ['primary', 'secondary', 'warn', 'danger', 'axisSecondary'] as const;
export const DESTACADOS_DEFAULT = 5;
export const DESTACADOS_MAX = 30;

/** Color de la serie en la posición `i` (0 = la más alta); de `destacados` en adelante es "Otros". */
export function colorFor(theme: ChartTheme, i: number, destacados: number): string {
  if (i >= destacados) return theme.mutedBar;
  const key = THEME_KEYS[i];
  if (key) return theme[key];
  const hue = Math.round(((i - THEME_KEYS.length) * 137.508 + 20) % 360);
  return `hsl(${hue} 60% 55%)`;
}

/** Color por posición en el ranking: los primeros `destacados` tienen color propio, el resto comparte el color de "Otros". */
export function colorPorRanking(theme: ChartTheme, rank: number, destacados: number): string {
  return colorFor(theme, rank, destacados);
}

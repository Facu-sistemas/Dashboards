const plainNumber = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const fullCurrency = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

/**
 * Formato compacto ($1,2M) hecho a mano — igual que `mF()` en el tablero
 * original (public/data/index.html) — en vez de `Intl.NumberFormat` con
 * `notation: 'compact'`. Confirmado en vivo (2026-09-18) que ese modo
 * produce texto distinto en el render de servidor (Node) que en el del
 * navegador para valores chicos/cero ("$0,0" vs "$0"), lo que React
 * detecta como mismatch de hidratación y descarta todo el HTML del
 * servidor — determinístico en todos lados evita el problema de raíz.
 */
export function formatCompactCurrency(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return fullCurrency.format(v);
}

export function formatNumber(v: number): string {
  return plainNumber.format(v);
}

export function formatValue(v: number, format: 'currency' | 'number'): string {
  return format === 'currency' ? formatCompactCurrency(v) : formatNumber(v);
}

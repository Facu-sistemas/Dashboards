const exactFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Monto completo, sin redondear ni abreviar (a diferencia de `formatCompactCurrency`). */
export function formatExactCurrency(v: number): string {
  return exactFmt.format(v);
}

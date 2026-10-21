import type { FiltrosRentabilidad } from '@/lib/rentabilidad/types';

/** Arma el query string de los endpoints /api/rentabilidad/* a partir de los filtros de la UI. */
export function filtrosQuery(f: FiltrosRentabilidad, extra: Record<string, string | number | null | undefined> = {}): string {
  const p = new URLSearchParams();
  p.set('anio', String(f.anio));
  if (f.mesIni !== null) p.set('mesIni', String(f.mesIni));
  if (f.mesFin !== null) p.set('mesFin', String(f.mesFin));
  if (f.categoria) p.set('categoria', f.categoria);
  if (f.clienteId !== null) p.set('cliente', String(f.clienteId));
  if (f.empresaId !== null) p.set('empresa', String(f.empresaId));
  p.set('costos', f.costos);
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

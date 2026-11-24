import { useState, type ReactNode } from 'react';

/** Orden por columna de las tablas de RRHH: un clic ordena ascendente y cada clic siguiente en la misma columna alterna descendente / ascendente. */
export interface Orden {
  col: string;
  desc: boolean;
}

export function useOrden() {
  const [orden, setOrden] = useState<Orden | null>(null);
  const alternar = (col: string) => setOrden((o) => (o && o.col === col ? { col, desc: !o.desc } : { col, desc: false }));
  return { orden, alternar };
}

type Valor = string | number | null | undefined;

/**
 * Ordena una copia de las filas según la columna activa. `getters` dice qué valor compara cada columna; los vacíos
 * (null) van siempre al final, sea cual sea el sentido, y los textos se comparan en castellano (sin distinguir tildes ni mayúsculas).
 */
export function ordenarFilas<T>(rows: T[], orden: Orden | null, getters: Record<string, (r: T) => Valor>): T[] {
  const get = orden ? getters[orden.col] : undefined;
  if (!orden || !get) return rows;
  return [...rows].sort((a, b) => {
    const va = get(a) ?? null;
    const vb = get(b) ?? null;
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const c =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'es', { sensitivity: 'base', numeric: true });
    return orden.desc ? -c : c;
  });
}

interface ThProps {
  col: string;
  orden: Orden | null;
  alternar: (col: string) => void;
  className?: string;
  title?: string;
  children: ReactNode;
}

/** Encabezado de columna clickeable que muestra la flecha del orden activo. */
export function ThOrden({ col, orden, alternar, className = '', title, children }: ThProps) {
  const activa = orden?.col === col;
  return (
    <th
      className={`${className} cursor-pointer select-none hover:text-slate-200 ${activa ? 'text-brand-400' : ''}`}
      title={title ? `${title}\n\nClic para ordenar.` : 'Clic para ordenar (ascendente / descendente).'}
      aria-sort={activa ? (orden!.desc ? 'descending' : 'ascending') : 'none'}
      onClick={() => alternar(col)}
    >
      {children}
      {activa ? (orden!.desc ? ' ↓' : ' ↑') : <span className="opacity-30"> ↕</span>}
    </th>
  );
}

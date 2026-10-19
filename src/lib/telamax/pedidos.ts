import { fechaCorteEfectiva, fromISO, sumarDiasHabiles, toISO } from './fechas';
import type { FilaPlanilla, Planillas } from './types';

/**
 * Órdenes de fabricación (mrp.production) de corte de tela con fecha real de
 * planificación — lo que antes se exportaba con la plantilla APP_TENDIDO.
 */
export interface PedidoOdoo {
  id: number;
  /** Referencia de la orden (WH/MO/…), la columna "Origen" de la plantilla. */
  origen: string;
  /** ISO YYYY-MM-DD (planning_date). */
  fecha: string;
  productoOrigen: string;
  tela: string;
  cantidad: number;
  /** x_studio_linea ('' si está vacía). */
  linea: string;
}

export interface OpcionesPlanillas {
  /** Fecha "hoy" de la planificación (ISO). */
  fecha: string;
  /** Si está activo se incluye todo lo anterior a `fecha` como ATRASADOS; si no, se planifica de `fecha` en adelante. */
  paraAtras: boolean;
  /** Descarta las líneas que empiezan con T (T, T1, T3, T4…). */
  ignorarTradicional: boolean;
}

export interface PlanillasDesdeOdoo {
  planillas: Planillas;
  /** Fecha que se tomó como "día siguiente" (próximo día hábil después de `fecha`). */
  fechaSiguiente: string;
  conteos: { atrasados: number; dia: number; siguiente: number; ignoradasTradicional: number };
}

/** Línea "Tradicional": cualquier valor que empiece con T (T, T1, T3, T4…). */
export function esLineaTradicional(linea: unknown): boolean {
  return typeof linea === 'string' && linea.trim().toUpperCase().startsWith('T');
}

const aFila = (p: PedidoOdoo): FilaPlanilla => ({
  Origen: p.origen,
  'Producto Origen': p.productoOrigen,
  Tela: p.tela,
  'Cantidad a producir': p.cantidad,
  Linea: p.linea,
});

/** Reparte las órdenes en las 3 planillas del motor según la fecha elegida. */
export function armarPlanillas(pedidos: PedidoOdoo[], { fecha, paraAtras, ignorarTradicional }: OpcionesPlanillas): PlanillasDesdeOdoo {
  const fechaSiguiente = toISO(sumarDiasHabiles(fromISO(fecha), 1));
  const planillas: Planillas = { atrasados: [], dia: [], siguiente: [] };
  let ignoradas = 0;

  for (const p of pedidos) {
    if (p.fecha < fecha && !paraAtras) continue;
    const destino = p.fecha < fecha ? 'atrasados' : p.fecha === fecha ? 'dia' : p.fecha === fechaSiguiente ? 'siguiente' : null;
    if (destino === null) continue;
    if (ignorarTradicional && esLineaTradicional(p.linea)) {
      ignoradas += 1;
      continue;
    }
    planillas[destino].push(aFila(p));
  }

  return {
    planillas,
    fechaSiguiente,
    conteos: { atrasados: planillas.atrasados.length, dia: planillas.dia.length, siguiente: planillas.siguiente.length, ignoradasTradicional: ignoradas },
  };
}

/** Día de producción por defecto: hoy, o el próximo día hábil si hoy es fin de semana o feriado. */
export function fechaPorDefecto(hoy: Date): string {
  return toISO(fechaCorteEfectiva(hoy));
}

/** Aplica "ignorar Tradicional" a filas de un .xlsx cargado a mano (columna con "linea" en el nombre). */
export function filtrarTradicionalFilas(filas: FilaPlanilla[]): { filas: FilaPlanilla[]; ignoradas: number } {
  const col = filas.length > 0 ? Object.keys(filas[0]!).find((c) => /l[ií]nea/i.test(c)) : undefined;
  if (!col) return { filas, ignoradas: 0 };
  const quedan = filas.filter((f) => !esLineaTradicional(f[col]));
  return { filas: quedan, ignoradas: filas.length - quedan.length };
}

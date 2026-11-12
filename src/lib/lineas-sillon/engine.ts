/**
 * Motor del Planificador de Líneas de sillones — automatiza la hoja HORARIOS de la
 * planilla "FL - (PCP) - LEAN TIEMPOS". Función pura, sin Odoo ni Supabase, para
 * poder usarla igual en server y en cliente.
 *
 * Cada línea tiene tres estaciones en serie (Carpintería → Tapicería → Ensamble) y la
 * planilla las arma escalonadas: cada estación arranca a las 06:00 con lo que le sobró de
 * ayer (lo que la estación de arriba ya le dejó hecho) y sigue con lo que la de arriba va
 * haciendo hoy. Así nadie espera a nadie:
 *
 *   Carpintería = lo planificado
 *   Tapicería   = sobrante de ayer + la lista de Carpintería
 *   Ensamble    = sobrante de ayer + la lista de Tapicería
 *
 * Los horarios salen como en la planilla: cada estación suma sus tiempos desde las 06:00.
 * Aparte se simula la línea respetando las entregas (una unidad no se puede empezar antes de
 * que la estación de arriba la termine) y se avisa (`esperaMin`) dónde la estación se quedaría
 * sin pieza: es cuando el sobrante no alcanza para cubrir la diferencia de ritmo.
 */

import { JORNADA } from '@/lib/linea-config';

export const NUM_LINEAS = 8;

export type EstacionId = 'carpinteria' | 'tapiceria' | 'ensamble';

export const ESTACIONES: ReadonlyArray<{ id: EstacionId; nombre: string; puesto: string }> = [
  { id: 'carpinteria', nombre: 'Carpintería', puesto: 'C' },
  { id: 'tapiceria', nombre: 'Tapicería (tendido)', puesto: 'T' },
  { id: 'ensamble', nombre: 'Ensamble (estampado)', puesto: 'E' },
];

/** Dato viejo de cada línea (unidades "adelantadas"): quedó sin uso con el escalonado por sobrante; se conserva solo porque está guardado. */
export type Adelanto = Record<EstacionId, number>;
export const ADELANTO_INICIAL: Adelanto = { carpinteria: 0, tapiceria: 0, ensamble: 0 };

/** Minutos de trabajo de una persona-jornada que usa la planilla para las Unidades Equivalentes (U.E.). */
export const MIN_POR_UE = 244;
/** Hora de cierre de la jornada contra la que la planilla mide la eficiencia (06:00 + 488 min + desayuno). */
export const CIERRE_SEG = 14 * 3600 + 8 * 60;
/**
 * Hasta cuánto se puede pasar del cierre una unidad y seguir contando como de hoy: la planilla arma días de hasta 102%
 * (termina 14:20 o 14:21), así que el corte queda en las 14:25. Lo que termina después va para mañana.
 */
export const TOLERANCIA_CIERRE = 1.02;
/** Minutos de trabajo de un día de la línea: de las 06:00 al corte, sin el desayuno. */
const CAPACIDAD_MIN = (CIERRE_SEG * TOLERANCIA_CIERRE) / 60 - JORNADA.inicioMin - JORNADA.pausaDuracionMin;

export interface ProductoDato {
  nombre: string;
  /** Minutos por estación; null = la planilla todavía no lo tiene cargado. */
  minutos: number | null;
  personas: number | null;
}

/** Clave comparable de un nombre: sin tildes, mayúsculas, solo letras y números. */
export const normalizar = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** El producto de una orden viene como `[ref] NOMBRE - TELA`: la planilla trabaja con el nombre sin tela. */
export function baseDeOdoo(display: string): string {
  const sinRef = display.replace(/^\[[^\]]*\]\s*/, '');
  return sinRef.split(' - ')[0]!.trim();
}

export interface Catalogo {
  porClave: Map<string, ProductoDato>;
  /** Alias guardado: clave normalizada del nombre de Odoo → nombre del producto en DATOS. */
  alias: Map<string, string>;
}

export function armarCatalogo(productos: ProductoDato[], alias: Record<string, string>): Catalogo {
  const porClave = new Map(productos.map((p) => [normalizar(p.nombre), p]));
  return { porClave, alias: new Map(Object.entries(alias).map(([k, v]) => [normalizar(k), v])) };
}

export function resolverProducto(nombreOdoo: string, cat: Catalogo): ProductoDato | null {
  const base = baseDeOdoo(nombreOdoo);
  const clave = normalizar(base);
  const viaAlias = cat.alias.get(clave);
  if (viaAlias) return cat.porClave.get(normalizar(viaAlias)) ?? null;
  return cat.porClave.get(clave) ?? null;
}

/** Productos de DATOS parecidos a un nombre de Odoo (por palabras en común), para ofrecer al mapear. */
export function sugerencias(nombreOdoo: string, productos: ProductoDato[], max = 4): ProductoDato[] {
  const tokens = (s: string) =>
    new Set(
      s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .split(/[^A-Z0-9/+]+/)
        .filter((t) => t.length > 1),
    );
  const a = tokens(baseDeOdoo(nombreOdoo));
  return productos
    .map((p) => {
      const b = tokens(p.nombre);
      let comunes = 0;
      for (const t of a) if (b.has(t)) comunes += 1;
      return { p, score: comunes / (a.size + b.size - comunes || 1) };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, max)
    .map((x) => x.p);
}

/** Una unidad física a fabricar (la planilla tiene una fila por unidad). */
export interface UnidadPlan {
  producto: string;
  /** Referencia legible: orden de Odoo, o la nota de una carga manual. */
  origen: string;
  minutos: number;
  /** Personas que trabajan la estación (hoja DATOS): pesa en las U.E. */
  personas: number;
  manual: boolean;
}

/** Una unidad que la estación de arriba ya terminó y esta todavía no trabajó. `origen` = orden de Odoo, o '' si se cargó a mano. */
export interface UnidadSobrante {
  producto: string;
  origen: string;
}

/** Sobrante de ayer por estación (Carpintería no tiene: nadie le entrega nada). */
export interface Sobrante<T = UnidadSobrante> {
  tapiceria: T[];
  ensamble: T[];
}

export interface Tramo {
  idx: number;
  producto: string;
  origen: string;
  manual: boolean;
  iniMin: number;
  finMin: number;
  /** 0 = hoy, 1 = mañana… según dónde termina la unidad: la que cruza el cierre de la jornada cuenta para después. */
  dia: number;
  iniReloj: string;
  finReloj: string;
  /** Segundos desde medianoche en que termina, para medir la eficiencia como la planilla. */
  finRelojSeg: number;
  /** Unidades equivalentes acumuladas hasta esta unidad inclusive (columna U.E. de la planilla). */
  ueAcum: number;
  /** Celda que se dejó en blanco a mano en esta estación: no consume tiempo ni muestra hora. */
  vacio?: boolean;
  /** Sobrante de ayer: la estación de arriba ya la dejó hecha, se puede arrancar a las 06:00. */
  ayer?: boolean;
  /** Minutos de trabajo que la estación queda parada antes de esta unidad porque la de arriba todavía no la entregó (ausente = no espera). */
  esperaMin?: number;
  /** Hora a la que la estación de arriba la entrega, cuando hay espera. */
  llegaReloj?: string;
}

export interface EstacionPlan {
  id: EstacionId;
  nombre: string;
  puesto: string;
  tramos: Tramo[];
  /** Hora de fin de la última unidad de hoy sobre las 14:08 de cierre (1 = 100%). Igual que la fila de eficiencia de la planilla. */
  eficiencia: number;
  /** Primera unidad que arranca mañana o después. */
  pendientes: number;
  /** Unidades de hoy antes de las cuales la estación queda parada esperando a la de arriba. */
  avisos?: number;
  /** Suma de esas esperas, en minutos: lo que la estación terminaría más tarde que el horario de la planilla. */
  esperaTotalMin?: number;
}

/** La planilla corta el desayuno en las 8:59:20 (40 segundos antes de las 9:00). */
const MARGEN_PAUSA_MIN = 40 / 60;

/** Minuto de trabajo continuo → hora de reloj del día en que cae, sumando el desayuno si ya pasó. */
export function relojDe(workMin: number, esInicio: boolean): { dia: number; seg: number; hms: string } {
  const dia = Math.floor(workMin / CAPACIDAD_MIN);
  let dentro = workMin - dia * CAPACIDAD_MIN;
  if (dia > 0 && dentro === 0 && !esInicio) {
    // Un fin exacto de jornada se muestra en el día anterior.
    return relojDe(workMin - 0.0001, false);
  }
  // Igual que la fórmula de la planilla: el desayuno se le suma a la unidad que termina después de las 8:59:20, así que
  // la que termina justo a las 9:00:00 ya figura 9:10:00. El inicio de la siguiente es ese mismo fin.
  const pausaEnTrabajo = JORNADA.pausaDesdeMin - JORNADA.inicioMin - MARGEN_PAUSA_MIN;
  if (dentro > pausaEnTrabajo) dentro += JORNADA.pausaDuracionMin;
  const seg = Math.round((JORNADA.inicioMin + dentro) * 60);
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const ss = seg % 60;
  // Mismo formato que la planilla: 6:14:16 (sin cero adelante en la hora).
  return { dia, seg, hms: `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` };
}

/** Lista propia de una estación (ajuste a mano): una unidad por fila, null = fila en blanco. */
export type ListaEstacion = (UnidadPlan | null)[];

const SIN_SOBRANTE: Sobrante<UnidadPlan> = { tapiceria: [], ensamble: [] };
/** Tolerancia para no avisar por diferencias de redondeo. */
const EPS_MIN = 0.01;

export interface PlanLinea {
  estaciones: EstacionPlan[];
  /**
   * Lo que al cierre de hoy cada estación recibió (su sobrante + lo que la de arriba terminó hoy) y no llegó a hacer:
   * es el sobrante con el que arranca mañana.
   */
  sobranteManana: Sobrante;
}

/**
 * `unidades` es la lista de Carpintería. Tapicería y Ensamble se arman solas (sobrante de ayer + lista de la estación
 * de arriba) salvo que traigan una lista propia en `listas` (armada a mano celda por celda).
 */
export function planearLinea(
  unidades: UnidadPlan[],
  sobrante: Sobrante<UnidadPlan> = SIN_SOBRANTE,
  listas: Partial<Record<EstacionId, ListaEstacion>> = {},
): PlanLinea {
  const estaciones: EstacionPlan[] = [];
  const sobranteManana: Sobrante = { tapiceria: [], ensamble: [] };
  /** Lista real (sin blancos) de la estación anterior y el minuto en que termina cada unidad: según la planilla y según la simulación con esperas. */
  let colaPrev: UnidadPlan[] = [];
  let finPrev: number[] = [];
  let finRealPrev: number[] = [];

  ESTACIONES.forEach((est, j) => {
    const deAyer = est.id === 'carpinteria' ? [] : sobrante[est.id];
    const lista: ListaEstacion = listas[est.id] ?? (j === 0 ? unidades : [...deAyer, ...colaPrev]);

    // De dónde sale cada unidad: primero del sobrante de ayer y después de lo que la estación de arriba hace hoy, en orden.
    // Cada entrada se usa una sola vez; se busca la misma orden y, si no está (lista armada a mano), el mismo producto.
    const stock = deAyer.map((u) => ({ u, fin: 0, finReal: 0, libre: true }));
    const entregas = colaPrev.map((u, i) => ({ u, fin: finPrev[i]!, finReal: finRealPrev[i]!, libre: true }));
    const tomar = (de: typeof stock, u: UnidadPlan) => {
      const x = de.find((e) => e.libre && e.u.producto === u.producto && e.u.origen === u.origen) ?? de.find((e) => e.libre && e.u.producto === u.producto);
      if (x) x.libre = false;
      return x;
    };

    const tramos: Tramo[] = [];
    const cola: UnidadPlan[] = [];
    const fines: number[] = [];
    const finesReales: number[] = [];
    /** Unidades recibidas de arriba (sobrante o entrega de hoy) que esta estación termina hoy. */
    const hechasHoy = new Set<object>();
    let libre = 0;
    /** Reloj de la simulación con esperas (minutos de trabajo). */
    let libreReal = 0;
    let ueAcum = 0;
    lista.forEach((u, i) => {
      if (!u) {
        // Fila en blanco: la estación no hace nada, el reloj no avanza.
        tramos.push({ idx: i + 1, producto: '', origen: '', manual: false, iniMin: libre, finMin: libre, dia: relojDe(libre, true).dia, iniReloj: '', finReloj: '', finRelojSeg: 0, ueAcum, vacio: true });
        return;
      }
      const iniMin = libre;
      const finMin = iniMin + u.minutos;
      libre = finMin;
      const ini = relojDe(iniMin, true);
      const fin = relojDe(finMin, false);
      ueAcum += (u.minutos * u.personas) / MIN_POR_UE;
      const tramo: Tramo = {
        idx: i + 1,
        producto: u.producto,
        origen: u.origen,
        manual: u.manual,
        iniMin,
        finMin,
        dia: fin.dia,
        iniReloj: ini.hms,
        finReloj: fin.hms,
        finRelojSeg: fin.seg,
        ueAcum,
      };
      // Una unidad sin fuente conocida (agregada a mano en esta estación) se toma como disponible desde las 06:00.
      let llega = 0;
      if (j > 0) {
        const deStock = tomar(stock, u);
        const deArriba = deStock ? undefined : tomar(entregas, u);
        if (deStock) tramo.ayer = true;
        llega = deArriba?.finReal ?? 0;
        const fuente = deStock ?? deArriba;
        if (fuente && fin.dia === 0) hechasHoy.add(fuente);
      }
      if (llega - libreReal > EPS_MIN) {
        tramo.esperaMin = llega - libreReal;
        tramo.llegaReloj = relojDe(llega, false).hms;
      }
      libreReal = Math.max(libreReal, llega) + u.minutos;
      tramos.push(tramo);
      cola.push(u);
      fines.push(finMin);
      finesReales.push(libreReal);
    });

    // Una estación que se dejó vacía a mano no trabaja en esta línea ese día (p. ej. líneas que solo hacen Carpintería y
    // Tapicería): lo que sale de la de arriba se va de la línea y no se le acumula como sobrante.
    const noTrabaja = listas[est.id] !== undefined && cola.length === 0;
    if (est.id !== 'carpinteria' && !noTrabaja) {
      // Recibido hasta el cierre de hoy = el sobrante + lo que la estación de arriba termina hoy. Lo que no se hizo queda para mañana.
      const recibidas = [...stock, ...entregas.filter((e) => relojDe(e.fin, false).dia === 0)];
      // Lo armado a mano no tiene orden de Odoo detrás: mañana se cruza por producto.
      sobranteManana[est.id] = recibidas.filter((e) => !hechasHoy.has(e)).map((e) => ({ producto: e.u.producto, origen: e.u.manual ? '' : e.u.origen }));
    }

    const hoy = tramos.filter((t) => t.dia === 0 && !t.vacio);
    const ultimoHoy = hoy[hoy.length - 1];
    estaciones.push({
      id: est.id,
      nombre: est.nombre,
      puesto: est.puesto,
      tramos,
      eficiencia: ultimoHoy ? ultimoHoy.finRelojSeg / CIERRE_SEG : 0,
      pendientes: tramos.filter((t) => t.dia > 0 && !t.vacio).length,
      avisos: hoy.filter((t) => (t.esperaMin ?? 0) > 0).length,
      esperaTotalMin: hoy.reduce((a, t) => a + (t.esperaMin ?? 0), 0),
    });
    colaPrev = cola;
    finPrev = fines;
    finRealPrev = finesReales;
  });

  return { estaciones, sobranteManana };
}

/** Filas a mostrar/imprimir hoy: hasta la última unidad real de hoy de cualquiera de las tres estaciones. */
export function filasDeHoy(estaciones: EstacionPlan[]): number {
  let n = 0;
  for (const e of estaciones) {
    e.tramos.forEach((t, i) => {
      if (t.dia === 0 && !t.vacio) n = Math.max(n, i + 1);
    });
  }
  return n;
}

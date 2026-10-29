/**
 * Motor del Planificador de Líneas de sillones — automatiza la hoja HORARIOS de la
 * planilla "FL - (PCP) - LEAN TIEMPOS". Función pura, sin Odoo ni Supabase, para
 * poder usarla igual en server y en cliente.
 *
 * Cada línea tiene tres estaciones en serie (Carpintería → Tapicería → Ensamble). En la
 * planilla todas arrancan a las 06:00 con la misma lista de productos y cada fila suma el
 * tiempo del producto; acá la estación siguiente solo puede empezar una unidad cuando la
 * anterior la terminó, salvo las primeras N que ya venían adelantadas del día anterior
 * (el "adelanto": trabajo que quedó hecho aguas arriba y que evita esperar al carpintero).
 */

import { JORNADA } from '@/lib/linea-config';

export const NUM_LINEAS = 8;

export type EstacionId = 'carpinteria' | 'tapiceria' | 'ensamble';

export const ESTACIONES: ReadonlyArray<{ id: EstacionId; nombre: string; puesto: string }> = [
  { id: 'carpinteria', nombre: 'Carpintería', puesto: 'C' },
  { id: 'tapiceria', nombre: 'Tapicería (tendido)', puesto: 'T' },
  { id: 'ensamble', nombre: 'Ensamble (estampado)', puesto: 'E' },
];

export type Adelanto = Record<EstacionId, number>;
export const ADELANTO_VACIO: Adelanto = { carpinteria: 0, tapiceria: 0, ensamble: 0 };
/** Sin espera entre estaciones: las tres arrancan a las 06:00 con la misma lista, como la planilla. Es el punto de partida de cada línea. */
export const ADELANTO_PARALELO: Adelanto = { carpinteria: 0, tapiceria: 200, ensamble: 200 };

/** Minutos de trabajo de una persona-jornada que usa la planilla para las Unidades Equivalentes (U.E.). */
export const MIN_POR_UE = 244;
/** Hora de cierre de la jornada contra la que la planilla mide la eficiencia (06:00 + 488 min + desayuno). */
export const CIERRE_SEG = 14 * 3600 + 8 * 60;

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
}

/** Minuto de trabajo continuo → hora de reloj del día en que cae, sumando el desayuno si ya pasó. */
export function relojDe(workMin: number, esInicio: boolean): { dia: number; seg: number; hms: string } {
  const dia = Math.floor(workMin / JORNADA.capacidadMin);
  let dentro = workMin - dia * JORNADA.capacidadMin;
  if (dia > 0 && dentro === 0 && !esInicio) {
    // Un fin exacto de jornada se muestra en el día anterior.
    return relojDe(workMin - 0.0001, false);
  }
  const pausaEnTrabajo = JORNADA.pausaDesdeMin - JORNADA.inicioMin;
  const pasoPausa = esInicio ? dentro >= pausaEnTrabajo : dentro > pausaEnTrabajo;
  if (pasoPausa) dentro += JORNADA.pausaDuracionMin;
  const seg = Math.round((JORNADA.inicioMin + dentro) * 60);
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const ss = seg % 60;
  // Mismo formato que la planilla: 6:14:16 (sin cero adelante en la hora).
  return { dia, seg, hms: `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` };
}

export function planearLinea(unidades: UnidadPlan[], adelanto: Adelanto = ADELANTO_VACIO): EstacionPlan[] {
  const finPrev: number[] = [];
  return ESTACIONES.map((est, j) => {
    const tramos: Tramo[] = [];
    let libre = 0;
    let ueAcum = 0;
    unidades.forEach((u, i) => {
      const disponible = j === 0 || i < adelanto[est.id] ? 0 : finPrev[i]!;
      const iniMin = Math.max(libre, disponible);
      const finMin = iniMin + u.minutos;
      libre = finMin;
      const ini = relojDe(iniMin, true);
      const fin = relojDe(finMin, false);
      ueAcum += (u.minutos * u.personas) / MIN_POR_UE;
      tramos.push({
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
      });
    });
    tramos.forEach((t, i) => (finPrev[i] = t.finMin));
    const hoy = tramos.filter((t) => t.dia === 0);
    const ultimoHoy = hoy[hoy.length - 1];
    return {
      id: est.id,
      nombre: est.nombre,
      puesto: est.puesto,
      tramos,
      eficiencia: ultimoHoy ? ultimoHoy.finRelojSeg / CIERRE_SEG : 0,
      pendientes: tramos.length - hoy.length,
    };
  });
}

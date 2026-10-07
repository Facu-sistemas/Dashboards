/**
 * Comparación de caras (solo matemática, sin dependencias): la usan el reconocimiento, el registro y el reporte de
 * "pares parecidos" del admin, así los tres miden la distancia exactamente igual.
 *
 * Un descriptor es un vector de 128 números; dos caras de la misma persona quedan cerca y las de personas distintas lejos.
 */

/** Distancia máxima para considerar que dos caras son la misma persona (menor = más estricto). */
export const UMBRAL_RECONOCIMIENTO = 0.5;
/** Entre el umbral y este valor dos personas distintas ya se parecen lo suficiente como para vigilarlas. */
export const UMBRAL_PARECIDO = 0.6;
/**
 * Al reconocer, la mejor coincidencia tiene que ganarle a la segunda mejor (otra persona) por al menos esto.
 * Si dos empleados dan casi igual, es preferible no fichar a fichar al equivocado.
 */
export const MARGEN_RECONOCIMIENTO = 0.08;
/** La distancia a una persona es el promedio de sus N muestras más cercanas: una sola muestra afortunada no alcanza para acertar por casualidad. */
const MUESTRAS_PROMEDIADAS = 2;

export interface PersonaCaras {
  empleadoId: number;
  nombre: string;
  muestras: number[][];
}

export interface Coincidencia {
  empleadoId: number;
  nombre: string;
  distancia: number;
}

export function distancia(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let suma = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    suma += d * d;
  }
  return Math.sqrt(suma);
}

/** Distancia de un descriptor a una persona: promedio de sus muestras más cercanas. */
export function distanciaAPersona(descriptor: ArrayLike<number>, muestras: ArrayLike<number>[]): number {
  const ordenadas = muestras.map((m) => distancia(descriptor, m)).sort((x, y) => x - y);
  const k = Math.min(MUESTRAS_PROMEDIADAS, ordenadas.length);
  return ordenadas.slice(0, k).reduce((s, d) => s + d, 0) / k;
}

/** Agrupa las filas de `fichaje_caras` (una por muestra) en una entrada por empleado. */
export function agruparPersonas(caras: { empleadoId: number; empleadoNombre: string; descriptor: number[] }[]): PersonaCaras[] {
  const porEmpleado = new Map<number, PersonaCaras>();
  for (const c of caras) {
    const actual = porEmpleado.get(c.empleadoId);
    if (actual) actual.muestras.push(c.descriptor);
    else porEmpleado.set(c.empleadoId, { empleadoId: c.empleadoId, nombre: c.empleadoNombre, muestras: [c.descriptor] });
  }
  return [...porEmpleado.values()];
}

/** Todas las personas ordenadas de más a menos parecidas al descriptor. */
export function rankingPersonas(descriptor: ArrayLike<number>, personas: PersonaCaras[], excluirEmpleadoId?: number): Coincidencia[] {
  return personas
    .filter((p) => p.empleadoId !== excluirEmpleadoId)
    .map((p) => ({ empleadoId: p.empleadoId, nombre: p.nombre, distancia: distanciaAPersona(descriptor, p.muestras) }))
    .sort((a, b) => a.distancia - b.distancia);
}

export interface ParParecido {
  aId: number;
  aNombre: string;
  bId: number;
  bNombre: string;
  distancia: number;
}

/**
 * Pares de personas cuyas caras quedaron cerca. Para cada par se prueba cada muestra de uno contra el otro (y al
 * revés) con la misma métrica del reconocimiento, y se queda con el peor caso: es la situación en la que se confundirían.
 */
export function calcularParesParecidos(personas: PersonaCaras[], limite = UMBRAL_PARECIDO): ParParecido[] {
  const pares: ParParecido[] = [];
  for (let i = 0; i < personas.length; i++) {
    for (let j = i + 1; j < personas.length; j++) {
      const a = personas[i]!;
      const b = personas[j]!;
      let peor = Infinity;
      for (const m of a.muestras) peor = Math.min(peor, distanciaAPersona(m, b.muestras));
      for (const m of b.muestras) peor = Math.min(peor, distanciaAPersona(m, a.muestras));
      if (peor <= limite) pares.push({ aId: a.empleadoId, aNombre: a.nombre, bId: b.empleadoId, bNombre: b.nombre, distancia: peor });
    }
  }
  return pares.sort((x, y) => x.distancia - y.distancia);
}

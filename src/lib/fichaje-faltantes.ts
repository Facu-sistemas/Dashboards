import type { JornadaPersona } from '@/lib/supabase/fichaje-marcas';

export interface Faltante {
  empleadoId: number;
  empleadoNombre: string;
  /** Hora típica de entrada, en minutos desde la medianoche. */
  entradaTipica: number;
  /** De los últimos días iguales a hoy en los que hubo actividad, en cuántos vino. */
  vino: number;
  de: number;
  /** Minutos que pasaron desde su hora típica (negativo = todavía no es su hora). */
  atraso: number;
}

const DIA_AR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' });
const HORA_AR = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const diaSemana = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay();

/**
 * Quiénes suelen venir un día como hoy y todavía no ficharon. Se miran solo los días de la misma semana (lunes con lunes,
 * sábado con sábado) en los que hubo actividad real, y se considera "habitual" a quien vino al menos la mitad de esos días.
 * `fichadosHoy` son los ids que ya tienen alguna marca hoy.
 */
export interface ResultadoFaltantes {
  faltantes: Faltante[];
  /** Habituales que no se cuentan porque hoy están de licencia/vacaciones (nombre + motivo). */
  enLicencia: { empleadoId: number; empleadoNombre: string; motivo: string }[];
  /** Cuántos días con actividad se usaron como referencia (0 = no hay historial suficiente). */
  diasReferencia: number;
  /** 'semana' = solo días iguales a hoy; 'habiles' = lunes a viernes juntos, por falta de historial. */
  modo: 'semana' | 'habiles';
}

function diasConActividad(previas: JornadaPersona[]): Set<string> {
  const personasPorDia = new Map<string, Set<number>>();
  for (const j of previas) {
    const s = personasPorDia.get(j.dia) ?? new Set<number>();
    s.add(j.empleadoId);
    personasPorDia.set(j.dia, s);
  }
  if (personasPorDia.size === 0) return new Set();
  // Día con actividad real = al menos 30% de la gente que vino el día más concurrido (descarta días de prueba o feriados).
  const maximo = Math.max(...[...personasPorDia.values()].map((s) => s.size));
  return new Set([...personasPorDia.entries()].filter(([, s]) => s.size >= Math.max(2, maximo * 0.3)).map(([d]) => d));
}

export function calcularFaltantes(
  jornadas: JornadaPersona[],
  fichadosHoy: Set<number>,
  ausentes: Record<number, string>,
  ahora = new Date(),
): ResultadoFaltantes {
  const hoy = DIA_AR.format(ahora);
  const sem = diaSemana(hoy);
  const [hh, mm] = HORA_AR.format(ahora).split(':').map(Number);
  const minAhora = hh! * 60 + mm!;

  let modo: 'semana' | 'habiles' = 'semana';
  let previas = jornadas.filter((j) => j.dia !== hoy && diaSemana(j.dia) === sem);
  let diasActivos = diasConActividad(previas);
  // Con poco historial (la función es reciente) se compara con cualquier día hábil.
  if (diasActivos.size < 2 && sem >= 1 && sem <= 5) {
    modo = 'habiles';
    previas = jornadas.filter((j) => j.dia !== hoy && diaSemana(j.dia) >= 1 && diaSemana(j.dia) <= 5);
    diasActivos = diasConActividad(previas);
  }
  if (diasActivos.size < 2) return { faltantes: [], enLicencia: [], diasReferencia: diasActivos.size, modo };

  const porPersona = new Map<number, { nombre: string; dias: Set<string>; entradas: number[] }>();
  for (const j of previas) {
    if (!diasActivos.has(j.dia)) continue;
    const p = porPersona.get(j.empleadoId) ?? { nombre: j.empleadoNombre, dias: new Set<string>(), entradas: [] };
    p.dias.add(j.dia);
    if (j.entrada !== null) p.entradas.push(j.entrada);
    porPersona.set(j.empleadoId, p);
  }

  const faltantes: Faltante[] = [];
  const enLicencia: ResultadoFaltantes['enLicencia'] = [];
  for (const [id, p] of porPersona) {
    if (fichadosHoy.has(id) || p.entradas.length === 0) continue;
    if (p.dias.size / diasActivos.size < 0.5) continue;
    if (ausentes[id]) {
      enLicencia.push({ empleadoId: id, empleadoNombre: p.nombre, motivo: ausentes[id]! });
      continue;
    }
    const tipica = p.entradas.reduce((a, b) => a + b, 0) / p.entradas.length;
    faltantes.push({ empleadoId: id, empleadoNombre: p.nombre, entradaTipica: tipica, vino: p.dias.size, de: diasActivos.size, atraso: minAhora - tipica });
  }
  // Primero los que ya deberían haber llegado, el que más se pasó arriba.
  return { faltantes: faltantes.sort((a, b) => b.atraso - a.atraso), enLicencia, diasReferencia: diasActivos.size, modo };
}

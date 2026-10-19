import type { QuizRow } from '@/lib/quiz-bandas-sheet';

export interface QuizStats {
  total: number;
  confirmadas: number;
  canceladas: number;
  sinQuiz: number;
  /** Quizzes efectivamente mostrados (confirmado + cancelado). */
  conQuiz: number;
  /** Confirmadas sin ningún intento fallido. */
  aciertoPrimerIntento: number;
  /** Confirmadas que tuvieron al menos un error antes de acertar. */
  conError: number;
  erroresTotales: number;
  /** % de quizzes confirmados al primer intento, 0-100. null si no hubo quizzes. */
  pctAcierto: number | null;
  unidades: number;
  segMediana: number | null;
  segPromedio: number | null;
}

export interface DiaPoint {
  fecha: string;
  ok: number;
  conError: number;
  canceladas: number;
  sinQuiz: number;
}

export interface HoraPoint {
  hora: string;
  quizzes: number;
  errores: number;
}

export interface ProductoRow {
  producto: string;
  quizzes: number;
  errores: number;
  canceladas: number;
  /** errores / quizzes, 0-100 */
  pctError: number;
}

export interface UsuarioRow {
  usuario: string;
  total: number;
  quizzes: number;
  errores: number;
  canceladas: number;
  sinQuiz: number;
  segMediana: number | null;
}

export interface BinSeg {
  label: string;
  cantidad: number;
}

/** Una selección equivocada: lo que tocó vs. lo correcto. */
export interface ConfusionRow {
  producto: string;
  elegido: string;
  correcto: string;
  veces: number;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function computeStats(rows: QuizRow[]): QuizStats {
  const confirmadas = rows.filter((r) => r.resultado === 'confirmado');
  const canceladas = rows.filter((r) => r.resultado === 'cancelado').length;
  const sinQuiz = rows.filter((r) => r.resultado === 'sin-quiz').length;
  const conQuiz = confirmadas.length + canceladas;
  const aciertoPrimerIntento = confirmadas.filter((r) => r.intentosFallidos === 0).length;
  const segs = rows.map((r) => r.segundos).filter((s): s is number => s !== null);
  return {
    total: rows.length,
    confirmadas: confirmadas.length,
    canceladas,
    sinQuiz,
    conQuiz,
    aciertoPrimerIntento,
    conError: confirmadas.length - aciertoPrimerIntento,
    erroresTotales: rows.reduce((a, r) => a + r.intentosFallidos, 0),
    pctAcierto: conQuiz > 0 ? (aciertoPrimerIntento / conQuiz) * 100 : null,
    unidades: rows.reduce((a, r) => a + r.cantidad, 0),
    segMediana: median(segs),
    segPromedio: segs.length ? segs.reduce((a, b) => a + b, 0) / segs.length : null,
  };
}

export function porDia(rows: QuizRow[]): DiaPoint[] {
  const map = new Map<string, DiaPoint>();
  for (const r of rows) {
    const p = map.get(r.fecha) ?? { fecha: r.fecha, ok: 0, conError: 0, canceladas: 0, sinQuiz: 0 };
    if (r.resultado === 'sin-quiz') p.sinQuiz++;
    else if (r.resultado === 'cancelado') p.canceladas++;
    else if (r.intentosFallidos > 0) p.conError++;
    else p.ok++;
    map.set(r.fecha, p);
  }
  return [...map.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export function porHora(rows: QuizRow[]): HoraPoint[] {
  const map = new Map<number, HoraPoint>();
  for (const r of rows) {
    if (r.resultado === 'sin-quiz') continue;
    const h = Number(r.hora.slice(0, 2));
    const p = map.get(h) ?? { hora: `${String(h).padStart(2, '0')}h`, quizzes: 0, errores: 0 };
    p.quizzes++;
    p.errores += r.intentosFallidos;
    map.set(h, p);
  }
  if (map.size === 0) return [];
  const hs = [...map.keys()];
  const out: HoraPoint[] = [];
  for (let h = Math.min(...hs); h <= Math.max(...hs); h++) {
    out.push(map.get(h) ?? { hora: `${String(h).padStart(2, '0')}h`, quizzes: 0, errores: 0 });
  }
  return out;
}

export function porProducto(rows: QuizRow[]): ProductoRow[] {
  const map = new Map<string, ProductoRow>();
  for (const r of rows) {
    if (r.resultado === 'sin-quiz') continue;
    const p = map.get(r.producto) ?? { producto: r.producto, quizzes: 0, errores: 0, canceladas: 0, pctError: 0 };
    p.quizzes++;
    p.errores += r.intentosFallidos;
    if (r.resultado === 'cancelado') p.canceladas++;
    map.set(r.producto, p);
  }
  return [...map.values()]
    .map((p) => ({ ...p, pctError: (p.errores / p.quizzes) * 100 }))
    .sort((a, b) => b.errores - a.errores || b.canceladas - a.canceladas || b.quizzes - a.quizzes);
}

export function porUsuario(rows: QuizRow[]): UsuarioRow[] {
  const groups = new Map<string, QuizRow[]>();
  for (const r of rows) groups.set(r.usuario, [...(groups.get(r.usuario) ?? []), r]);
  return [...groups.entries()]
    .map(([usuario, rs]) => ({
      usuario,
      total: rs.length,
      quizzes: rs.filter((r) => r.resultado !== 'sin-quiz').length,
      errores: rs.reduce((a, r) => a + r.intentosFallidos, 0),
      canceladas: rs.filter((r) => r.resultado === 'cancelado').length,
      sinQuiz: rs.filter((r) => r.resultado === 'sin-quiz').length,
      segMediana: median(rs.map((r) => r.segundos).filter((s): s is number => s !== null)),
    }))
    .sort((a, b) => b.total - a.total);
}

export function histogramaSegundos(rows: QuizRow[]): BinSeg[] {
  const bins: BinSeg[] = [
    { label: '≤2 s', cantidad: 0 },
    { label: '3-5 s', cantidad: 0 },
    { label: '6-10 s', cantidad: 0 },
    { label: '11-30 s', cantidad: 0 },
    { label: '>30 s', cantidad: 0 },
  ];
  for (const r of rows) {
    if (r.segundos === null) continue;
    const s = r.segundos;
    bins[s <= 2 ? 0 : s <= 5 ? 1 : s <= 10 ? 2 : s <= 30 ? 3 : 4]!.cantidad++;
  }
  return bins;
}

/** Confusiones: qué opción equivocada tocaron en lugar de la correcta (solo filas con intentos fallidos). */
export function confusiones(rows: QuizRow[]): ConfusionRow[] {
  const map = new Map<string, ConfusionRow>();
  for (const r of rows) {
    if (r.intentosFallidos === 0 || r.resultado === 'sin-quiz') continue;
    for (const elegido of r.opcionesElegidas) {
      if (elegido === r.producto) continue;
      const key = `${r.producto}|${elegido}`;
      const c = map.get(key) ?? { producto: r.producto, elegido, correcto: r.producto, veces: 0 };
      c.veces++;
      map.set(key, c);
    }
  }
  return [...map.values()].sort((a, b) => b.veces - a.veces);
}

/** BANDA-EREST70190-ALTO20 → { base: 'EREST70190', alto: '20' } para mostrar en forma corta. */
export function shortProduct(code: string): string {
  return code.replace(/^BANDA-/, '');
}

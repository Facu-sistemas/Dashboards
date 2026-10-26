/**
 * Lectura (solo lectura) del Google Sheet donde se registra el quiz de verificación
 * que se le hace al operario al confirmar una MO de bandas. La planilla es pública
 * ("cualquiera con el enlace"), así que se baja por el export CSV, sin credenciales.
 */

const SHEET_ID = '1f0qhWcaOlUpCVpRJ6lsnvxNzFXQVqqaNNmEaO2NvV64';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const CACHE_MS = 60_000;

export type QuizResultado = 'confirmado' | 'cancelado' | 'sin-quiz' | 'otro';

export interface QuizRow {
  /** YYYY-MM-DD */
  fecha: string;
  /** HH:MM:SS */
  hora: string;
  usuario: string;
  resultado: QuizResultado;
  resultadoOriginal: string;
  producto: string;
  opcionesMostradas: string[];
  /** Opciones tocadas en orden; si hubo error, las equivocadas van antes del acierto. */
  opcionesElegidas: string[];
  intentosFallidos: number;
  segundos: number | null;
  ordenes: string[];
  cantidad: number;
  tipoQuiz: string;
  /** 'Producción' | 'Staging' (pruebas). Filas viejas sin la columna: '—'. */
  entorno: string;
  /** Cantidad que debía ingresar el operario (quiz de cantidad); null si no hubo. */
  cantidadCorrecta: number | null;
  cantidadElegida: string[];
  fallosCantidad: number;
  url: string;
}

export interface QuizBandasData {
  rows: QuizRow[];
  fetchedAt: number;
}

/** CSV con comillas ("a,b", "" escapado) y saltos de línea dentro de campos. */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      out.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

const splitPipe = (s: string) =>
  s
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);

/** "2,00" → 2 ; "1.234,50" → 1234.5 */
function parseNumEs(s: string): number {
  const n = Number(s.trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function toResultado(s: string): QuizResultado {
  const v = s.trim().toLowerCase();
  if (v.startsWith('confirm')) return 'confirmado';
  if (v.startsWith('cancel')) return 'cancelado';
  if (v.startsWith('sin quiz')) return 'sin-quiz';
  return 'otro';
}

export function parseQuizRows(csv: string): QuizRow[] {
  const table = parseCsv(csv);
  const header = table[0]?.map((h) => h.trim()) ?? [];
  const idx = (name: string) => header.indexOf(name);
  const col = {
    fecha: idx('Fecha'),
    hora: idx('Hora'),
    usuario: idx('Usuario Odoo'),
    resultado: idx('Resultado'),
    producto: idx('Producto / tela correcto'),
    mostradas: idx('Opciones mostradas'),
    elegidas: idx('Opciones elegidas (en orden)'),
    intentos: idx('Intentos fallidos'),
    segundos: idx('Seg. hasta decidir'),
    ordenes: idx('Orden(es) de fabricación'),
    cantidades: idx('Cantidad(es)'),
    tipo: idx('Tipo de quiz'),
    url: idx('URL'),
    entorno: idx('Entorno'),
    cantCorrecta: idx('Cantidad correcta'),
    cantElegida: idx('Cantidad elegida (en orden)'),
    fallosCant: idx('Fallos cantidad'),
  };
  if (col.fecha < 0 || col.resultado < 0) throw new Error('La planilla no tiene el formato esperado (faltan columnas Fecha / Resultado).');

  const rows: QuizRow[] = [];
  for (const r of table.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(get(col.fecha));
    if (!m) continue; // filas vacías o basura
    const fecha = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    const hm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(get(col.hora));
    const hora = hm ? `${hm[1]!.padStart(2, '0')}:${hm[2]}:${hm[3] ?? '00'}` : '00:00:00';
    const segRaw = get(col.segundos);
    const elegidas = get(col.elegidas)
      .split(/[>|]/)
      .map((x) => x.trim())
      .filter(Boolean);
    rows.push({
      fecha,
      hora,
      usuario: get(col.usuario) || '—',
      resultado: toResultado(get(col.resultado)),
      resultadoOriginal: get(col.resultado),
      producto: get(col.producto) || '—',
      opcionesMostradas: splitPipe(get(col.mostradas)),
      opcionesElegidas: elegidas,
      intentosFallidos: Math.round(parseNumEs(get(col.intentos))),
      segundos: segRaw === '' ? null : parseNumEs(segRaw),
      ordenes: splitPipe(get(col.ordenes)),
      cantidad: splitPipe(get(col.cantidades)).reduce((a, x) => a + parseNumEs(x), 0),
      tipoQuiz: get(col.tipo) || '—',
      entorno: get(col.entorno) || '—',
      cantidadCorrecta: get(col.cantCorrecta) === '' ? null : parseNumEs(get(col.cantCorrecta)),
      cantidadElegida: get(col.cantElegida)
        .split(/[>|]/)
        .map((x) => x.trim())
        .filter(Boolean),
      fallosCantidad: Math.round(parseNumEs(get(col.fallosCant))),
      url: get(col.url),
    });
  }
  rows.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  return rows;
}

let cache: QuizBandasData | null = null;

export async function getQuizBandas(): Promise<QuizBandasData> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache;
  const res = await fetch(CSV_URL, { redirect: 'follow' });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('csv')) {
    throw new Error(`No se pudo leer la planilla de Google (${res.status}). Revisá que siga compartida como "cualquiera con el enlace".`);
  }
  cache = { rows: parseQuizRows(await res.text()), fetchedAt: Date.now() };
  return cache;
}

/**
 * Lectura (solo lectura) de la planilla de liquidación de RRHH en Google Sheets. La planilla es pública
 * ("cualquiera con el enlace"), así que se baja pestaña por pestaña con el export CSV de Google (gviz),
 * sin credenciales. Los números vienen con la configuración regional argentina ("1.234,50").
 */

export const LIQUIDACION_SHEET_ID = '1uJfCmPSAGZEcNdzaZU-qN8D53kbDPtaVRiXP_60m7ac';
const CACHE_MS = 60_000;

const cache = new Map<string, { at: number; rows: string[][] }>();

/** CSV con comillas ("a,b", "" escapado) y saltos de línea dentro de campos. */
export function parseCsv(text: string): string[][] {
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
      out.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

/**
 * Nombre de pestaña -> gid, leído de la vista HTML pública. Hace falta porque el export por gid trae TODAS las filas, y el que
 * va por nombre (gviz) se saltea las que están ocultas por un filtro de la planilla (RRHH la deja filtrada por convenio y
 * desaparecían los Madereros).
 */
let gids: { at: number; map: Map<string, string> } | null = null;

async function gidDe(tab: string): Promise<string | null> {
  if (!gids || Date.now() - gids.at > 10 * 60_000) {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${LIQUIDACION_SHEET_ID}/htmlview`);
    const map = new Map<string, string>();
    if (res.ok) {
      const html = await res.text();
      for (const m of html.matchAll(/name: "([^"]*)", pageUrl: "[^"]*?[&?]gid=(\d+)/g)) map.set(m[1]!, m[2]!);
    }
    gids = { at: Date.now(), map };
  }
  return gids.map.get(tab) ?? null;
}

function colIndex(letters: string): number {
  return [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
}

/** Recorta un export completo al rango "A5:F1200" (filas y columnas desde 1). */
function recortar(rows: string[][], range: string): string[][] {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
  if (!m) return rows;
  const [c1, c2] = [colIndex(m[1]!), colIndex(m[3]!)];
  return rows.slice(Number(m[2]) - 1, Number(m[4])).map((r) => r.slice(c1, c2 + 1));
}

/** Baja un rango de una pestaña como tabla de texto; la primera fila del rango son los encabezados. */
export async function fetchSheetTable(tab: string, range: string): Promise<string[][]> {
  const key = `${tab}!${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;

  const gid = await gidDe(tab).catch(() => null);
  // Con gid se usa el export completo (incluye filas ocultas por filtros); sin gid, el método anterior por nombre.
  const url = gid
    ? `https://docs.google.com/spreadsheets/d/${LIQUIDACION_SHEET_ID}/export?format=csv&gid=${gid}`
    : `https://docs.google.com/spreadsheets/d/${LIQUIDACION_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}&range=${range}&headers=1`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo leer la planilla de liquidación (Google respondió ${res.status}). ¿Sigue compartida con "cualquiera con el enlace"?`);
  }
  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    throw new Error(`Google no devolvió datos de la pestaña "${tab}": revisá que la planilla esté compartida con "cualquiera con el enlace" y que la pestaña exista.`);
  }
  const parsed = parseCsv(text);
  const rows = gid ? recortar(parsed, range) : parsed;
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

/** Número como lo muestra Google: "1.234,50" / "88,00" / " $80.000,00" / "". */
export function num(v: string | undefined): number {
  if (!v) return 0;
  const clean = v.replace(/[$\s]/g, '');
  const n = Number(clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean);
  return Number.isFinite(n) ? n : 0;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** "MONGES, Nicolás Ezequiel" y "MONGES NICOLAS EZEQUIEL" -> misma clave. */
export function claveNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Número de legajo a partir de la credencial de Odoo ("01/0597" -> 597). */
export function legajoNumero(s: string | null): number | null {
  const m = (s ?? '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

import { normalizar } from './engine';

/**
 * Matriz de polivalencia de Diseño (Google Sheet "Matriz de polivalencia", pestaña "Matriz"): por cada
 * producto y persona, un nivel en cada proceso — 1 no lo sabe hacer solo, 2 lo hace solo, 3 enseña o le gusta.
 * Se lee en vivo por el CSV público de la hoja; si no responde el plan sigue funcionando sin niveles.
 */
const SHEET_ID = '1RgSozUpM3wHLdHin11wJu8eJVVTt9-9aaKGPkG76IPE';
const GID_MATRIZ = '1848867307';
const CACHE_MS = 10 * 60 * 1000;

export type Nivel = 1 | 2 | 3;
/** COS/CAR/TAP/ENS de la hoja. */
export type ProcesoHoja = 'COS' | 'CAR' | 'TAP' | 'ENS';
export const PROCESOS: ProcesoHoja[] = ['COS', 'CAR', 'TAP', 'ENS'];

/** Niveles de una persona por proceso, con el nombre de cada producto como en DATOS (solo los que tienen nivel). */
export type NivelesPersona = Partial<Record<ProcesoHoja, Record<string, Nivel>>>;

export interface PersonaHoja {
  nombre: string;
  /** Palabras normalizadas del nombre: "ACOSTA GABRIELA" y "Gabriela Acosta" dan el mismo conjunto. */
  palabras: string[];
  /** Proceso → clave normalizada del producto de la hoja → nivel. */
  niveles: Record<ProcesoHoja, Record<string, Nivel>>;
}

export interface MatrizPolivalencia {
  personas: PersonaHoja[];
  /** Clave normalizada de la FAMILIA de la hoja → claves normalizadas de sus productos. */
  familias: Record<string, string[]>;
  /** Clave normalizada del producto de la hoja (para el match exacto). */
  productos: Set<string>;
}

/** CSV mínimo (RFC 4180): comillas dobles, comas y saltos de línea dentro de comillas. */
function parseCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') {
        celda += '"';
        i += 1;
      } else if (c === '"') entreComillas = false;
      else celda += c;
    } else if (c === '"') entreComillas = true;
    else if (c === ',') {
      fila.push(celda);
      celda = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i += 1;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
    } else celda += c;
  }
  if (celda || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas;
}

const palabrasDe = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

export function parsearMatriz(csv: string): MatrizPolivalencia {
  const filas = parseCsv(csv);
  const cabecera = filas[0] ?? [];
  const procesos = filas[1] ?? [];

  // Cada persona ocupa 4 columnas seguidas (COS, CAR, TAP, ENS); su nombre está en la primera.
  const columnas: { persona: number; proceso: ProcesoHoja; col: number }[] = [];
  const personas: PersonaHoja[] = [];
  for (let col = 2; col < cabecera.length; col++) {
    const nombre = cabecera[col]?.trim();
    if (!nombre) continue;
    personas.push({ nombre, palabras: palabrasDe(nombre), niveles: { COS: {}, CAR: {}, TAP: {}, ENS: {} } });
    PROCESOS.forEach((proceso, k) => {
      if (procesos[col + k]?.trim() === proceso) columnas.push({ persona: personas.length - 1, proceso, col: col + k });
    });
  }

  const familias: Record<string, string[]> = {};
  const productos = new Set<string>();
  for (const f of filas.slice(2)) {
    const producto = f[1]?.trim();
    if (!producto) continue;
    const clave = normalizar(producto);
    productos.add(clave);
    const familia = normalizar(f[0] ?? '');
    if (familia) (familias[familia] ??= []).push(clave);
    for (const { persona, proceso, col } of columnas) {
      const n = Number(f[col]);
      if (n === 1 || n === 2 || n === 3) personas[persona]!.niveles[proceso][clave] = n;
    }
  }
  return { personas, familias, productos };
}

let cache: { en: number; matriz: MatrizPolivalencia } | null = null;

export async function getMatrizPolivalencia(): Promise<MatrizPolivalencia | null> {
  if (cache && Date.now() - cache.en < CACHE_MS) return cache.matriz;
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID_MATRIZ}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const matriz = parsearMatriz(await res.text());
    cache = { en: Date.now(), matriz };
    return matriz;
  } catch (e) {
    console.error('[lineas-sillon] matriz de polivalencia', (e as Error).message);
    return cache?.matriz ?? null;
  }
}

/** ¿Es la misma persona? Mismas palabras sin importar el orden ("ACOSTA GABRIELA" = "Gabriela Acosta"), o todas las de la hoja dentro del otro nombre (apellido de más en Odoo). */
export function mismoNombre(hoja: string, otro: string): boolean {
  const a = palabrasDe(hoja);
  const b = palabrasDe(otro);
  if (a.length === 0 || b.length === 0) return false;
  if (a.length === b.length && a.every((w) => b.includes(w))) return true;
  return a.length >= 2 && a.every((w) => b.includes(w));
}

/** El único elemento cuyo nombre coincide con el de la hoja; null si no hay ninguno o hay varios. */
export function buscarUnico<T>(lista: T[], hoja: string, nombreDe: (x: T) => string): T | null {
  const exactos = lista.filter((x) => {
    const a = palabrasDe(hoja);
    const b = palabrasDe(nombreDe(x));
    return a.length === b.length && a.every((w) => b.includes(w));
  });
  if (exactos.length === 1) return exactos[0]!;
  const posibles = lista.filter((x) => mismoNombre(hoja, nombreDe(x)));
  return posibles.length === 1 ? posibles[0]! : null;
}

/** Nivel de una persona en un producto de DATOS: match exacto con la hoja o, si no, el de su familia (la más larga que lo prefija). */
export function nivelEnProducto(matriz: MatrizPolivalencia, persona: PersonaHoja, proceso: ProcesoHoja, producto: string): Nivel | null {
  const niveles = persona.niveles[proceso];
  const clave = normalizar(producto);
  if (matriz.productos.has(clave)) return niveles[clave] ?? null;
  const familia = Object.keys(matriz.familias)
    .filter((f) => clave.startsWith(f))
    .sort((a, b) => b.length - a.length)[0];
  if (!familia) return null;
  const todos = matriz.familias[familia]!.map((p) => niveles[p]).filter((n): n is Nivel => !!n);
  return todos.length ? (Math.max(...todos) as Nivel) : null;
}

/** Traduce los niveles de una persona de la hoja a los productos de DATOS (la web trabaja con esos nombres). */
export function nivelesParaDatos(matriz: MatrizPolivalencia, persona: PersonaHoja, productosDatos: string[]): NivelesPersona {
  const out: NivelesPersona = {};
  for (const proceso of PROCESOS) {
    const porProducto: Record<string, Nivel> = {};
    for (const producto of productosDatos) {
      const n = nivelEnProducto(matriz, persona, proceso, producto);
      if (n) porProducto[producto] = n;
    }
    if (Object.keys(porProducto).length > 0) out[proceso] = porProducto;
  }
  return out;
}

/** Proceso en el que la persona sabe más productos (su puesto principal); null si no tiene ninguno. */
export function procesoPrincipal(niveles: NivelesPersona): ProcesoHoja | null {
  const cuentas = PROCESOS.map((p) => [p, Object.keys(niveles[p] ?? {}).length] as const).sort((a, b) => b[1] - a[1]);
  return cuentas[0]![1] > 0 ? cuentas[0]![0] : null;
}

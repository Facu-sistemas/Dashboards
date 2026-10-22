import { searchReadAll } from './client';

/**
 * Objetivo mensual de CNC % facturación, cargado a mano por Gerencia en la hoja
 * "Hoja2" del dashboard de hojas de cálculo "Reunión de equipo de gestión"
 * (spreadsheet.dashboard 40). Fila de meses (ENERO…DICIEMBRE) y, debajo, el
 * objetivo en puntos porcentuales (0,60 = 0,60%). Vale para el mes del año,
 * sin importar el año.
 *
 * Odoo guarda la hoja como un snapshot (base64) más una cola de revisiones
 * (comandos CREATE_SHEET / UPDATE_CELL); acá se reproduce la cola sobre el
 * snapshot, salteando las revisiones deshechas. Solo lectura.
 */

const DASHBOARD_ID = 40;
const HOJA = 'hoja2';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

type Celdas = Map<string, unknown>; // "col,row" (base 0) → contenido
interface Comando {
  type: string;
  sheetId?: string;
  name?: string;
  col?: number;
  row?: number;
  content?: string;
}
interface RevisionRow extends Record<string, unknown> {
  id: number;
  revision_id: string;
  commands: string;
}

/** "AB12" → "27,11" (col,row en base 0). */
function direccion(a: string): string | null {
  const m = /^([A-Z]+)(\d+)$/.exec(a);
  if (!m) return null;
  const col = [...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return `${col},${Number(m[2]) - 1}`;
}

/** Reproduce snapshot + revisiones y devuelve las celdas de la hoja `HOJA`. */
export function celdasDeHoja(
  snapshotB64: string | false,
  revisiones: { revision_id: string; commands: string }[],
  esHoja: (nombre: string) => boolean = (n) => n.trim().toLowerCase() === HOJA
): Celdas | null {
  const hojas = new Map<string, { name: string; celdas: Celdas }>();
  if (snapshotB64) {
    const snap = JSON.parse(Buffer.from(snapshotB64, 'base64').toString('utf8')) as {
      sheets?: { id: string; name: string; cells?: Record<string, { content?: string }> }[];
    };
    for (const sh of snap.sheets ?? []) {
      const celdas: Celdas = new Map();
      for (const [a, c] of Object.entries(sh.cells ?? {})) {
        const d = direccion(a);
        if (d && c.content !== undefined) celdas.set(d, c.content);
      }
      hojas.set(sh.id, { name: sh.name, celdas });
    }
  }

  const parsed = revisiones.map((r) => ({ id: r.revision_id, data: JSON.parse(r.commands) as { type: string; commands?: Comando[]; undoneRevisionId?: string } }));
  const deshechas = new Set(parsed.flatMap((r) => (r.data.type === 'REVISION_UNDONE' && r.data.undoneRevisionId ? [r.data.undoneRevisionId] : [])));
  for (const r of parsed) {
    if (deshechas.has(r.id)) continue;
    for (const cmd of r.data.commands ?? []) {
      if (cmd.type === 'CREATE_SHEET' && cmd.sheetId) hojas.set(cmd.sheetId, { name: cmd.name ?? '', celdas: new Map() });
      else if (cmd.type === 'UPDATE_CELL' && cmd.sheetId && cmd.col !== undefined && cmd.row !== undefined) {
        const h = hojas.get(cmd.sheetId);
        if (!h) continue;
        const clave = `${cmd.col},${cmd.row}`;
        if (cmd.content === undefined || cmd.content === '') h.celdas.delete(clave);
        else h.celdas.set(clave, cmd.content);
      }
    }
  }
  return [...hojas.values()].find((h) => esHoja(h.name))?.celdas ?? null;
}

/** Objetivo por mes del año (1–12), en puntos porcentuales. Falta el mes → sin objetivo. */
export function objetivosDeCeldas(celdas: Celdas): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [clave, v] of celdas) {
    const [col, row] = clave.split(',').map(Number) as [number, number];
    const m = MESES.indexOf(String(v).trim().toLowerCase());
    if (m < 0) continue;
    const valor = Number(String(celdas.get(`${col},${row + 1}`) ?? '').replace(',', '.'));
    if (Number.isFinite(valor) && celdas.has(`${col},${row + 1}`)) out[m + 1] = valor;
  }
  return out;
}

/** Lee el dashboard "Reunión de equipo de gestión" y devuelve las celdas de la hoja que cumpla `esHoja`. */
export async function cargarCeldasDeGestion(esHoja: (nombre: string) => boolean): Promise<Celdas | null> {
  const [dash, revs] = await Promise.all([
    searchReadAll<{ id: number; spreadsheet_snapshot: string | false }>({
      model: 'spreadsheet.dashboard',
      domain: [['id', '=', DASHBOARD_ID]],
      fields: ['spreadsheet_snapshot'],
    }),
    searchReadAll<RevisionRow>({
      model: 'spreadsheet.revision',
      domain: [
        ['res_model', '=', 'spreadsheet.dashboard'],
        ['res_id', '=', DASHBOARD_ID],
      ],
      fields: ['revision_id', 'commands'],
      order: 'id',
    }),
  ]);
  return celdasDeHoja(dash[0]?.spreadsheet_snapshot ?? false, revs, esHoja);
}

export async function getCncObjetivos(): Promise<Record<number, number>> {
  try {
    const celdas = await cargarCeldasDeGestion((n) => n.trim().toLowerCase() === HOJA);
    return celdas ? objetivosDeCeldas(celdas) : {};
  } catch (err) {
    // Sin objetivo el indicador igual funciona: solo falta la línea de meta.
    console.error('[cnc-objetivos]', err instanceof Error ? err.message : err);
    return {};
  }
}

export { MESES as MESES_OBJETIVO };

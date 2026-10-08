// Control de OC vencidas: una fila por línea de OC con fecha prevista pasada y entrante asignado,
// ordenadas por valor. Port de la hoja "Control OC vencidas" del libro v12.
import type { FilaCalc, LineaAsignada, OcLinea } from './motor.ts';

export type SugerenciaOc =
  | 'Reprogramada en Odoo: actualizar la fecha de la OC'
  | 'Confirmar fecha con el proveedor'
  | 'Probable saldo para cerrar'
  | 'Reclamar al proveedor';

export interface FilaControlOc {
  fila: number;
  lineaId: number | null;
  ordenId: number | null;
  productId: number | null;
  oc: string;
  proveedor: string;
  insumo: string;
  categoria: string;
  fechaOrden: string | null;
  fechaPrevista: string | null;
  diasAtraso: number;
  pedido: number;
  recibido: number;
  pctRecibido: number;
  pendiente: number;
  asignado: number;
  valor: number;
  ultimaRecepcion: string | null;
  recepcionProgramada: string | null;
  remito: string;
  hayOcMasNueva: boolean;
  /** Semanas de cobertura sin esta OC; null si no hay consumo semanal. */
  coberturaSinOc: number | null;
  sugerencia: SugerenciaOc;
}

export interface EntradaControlOc {
  fechaExportacion: string;
  ocs: OcLinea[];
  ocLineas: LineaAsignada[];
  filas: FilaCalc[];
  costos: Map<string, number>;
  /** Máximo de filas (el libro muestra 300). */
  limite?: number;
}

const ord = (s: string | null | undefined): number | null =>
  s && /^\d{4}-\d{2}-\d{2}/.test(s) ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000 : null;

export function controlOcVencidas(inp: EntradaControlOc): FilaControlOc[] {
  const hoy = ord(inp.fechaExportacion)!;
  const ocPorFila = new Map(inp.ocs.map((l) => [l.fila, l]));
  const sku = new Map(inp.filas.map((f) => [f.clave, f]));
  const out: (FilaControlOc & { _v: number })[] = [];
  for (const a of inp.ocLineas) {
    if (!a.vencida || a.asignado <= 0) continue;
    const l = ocPorFila.get(a.fila);
    if (!l) continue;
    const prev = ord(l.fecha) ?? hoy;
    const dias = hoy - prev;
    const prog = ord(l.recepcionProgramada);
    const recibido = l.recibida ?? 0, pedido = l.pedida ?? 0;
    let sugerencia: SugerenciaOc;
    if (prog !== null && prog > hoy) sugerencia = 'Reprogramada en Odoo: actualizar la fecha de la OC';
    else if (dias <= 30) sugerencia = 'Confirmar fecha con el proveedor';
    else if (a.hayMasNueva || (dias > 90 && recibido > 0)) sugerencia = 'Probable saldo para cerrar';
    else sugerencia = 'Reclamar al proveedor';
    const f = sku.get(a.clave);
    const cob = f && f.w1 ? (f.disp + f.ent - a.asignado) / f.w1 : null;
    const valor = a.asignado * (inp.costos.get(a.clave) ?? 0);
    if (valor < 1) continue;   // el libro solo lista líneas con al menos $1 vencido
    out.push({
      fila: a.fila, lineaId: l.lineaId ?? null, ordenId: l.ordenId ?? null, productId: f?.productId ?? l.productId ?? null, oc: l.orden ?? '', proveedor: l.prov ?? '', insumo: a.n,
      categoria: (l.categoria ?? '').replace('Materia Prima / ', ''),
      fechaOrden: l.fechaOrden ?? null, fechaPrevista: l.fecha, diasAtraso: dias,
      pedido, recibido, pctRecibido: pedido ? recibido / pedido : 0, pendiente: l.pend, asignado: a.asignado, valor,
      ultimaRecepcion: l.ultimaRecepcion ?? null, recepcionProgramada: l.recepcionProgramada ?? null,
      remito: l.remito ?? '', hayOcMasNueva: a.hayMasNueva, coberturaSinOc: cob, sugerencia,
      _v: valor + a.fila / 1e9,   // desempata igual que el libro: mayor fila primero
    });
  }
  out.sort((x, y) => y._v - x._v);
  return out.slice(0, inp.limite ?? 300).map(({ _v, ...r }) => r);
}

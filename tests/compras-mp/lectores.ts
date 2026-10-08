// Lectores de los archivos de prueba (exportaciones de Odoo congeladas) para las pruebas de Compras MP.
import XLSX from 'xlsx';
import path from 'node:path';
import type { BaseRow, ConsumoTabla, OcLinea, PlanMensual } from '../../src/lib/compras-mp/motor.ts';

export function crearLectores(dir: string) {
  const hoja = (file: string, sheet?: string): unknown[][] => {
    const wb = XLSX.readFile(path.join(dir, file));
    const ws = wb.Sheets[sheet ?? wb.SheetNames[0]!]!;
    return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  };
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  // --- base (misma lógica que leer_base)
  function leerBase(): BaseRow[] {
    const R = hoja('entradas/IN_Base.xlsx');
    const h = (R[0] as unknown[]).map((x) => str(x));
    const ix = (n: string) => h.indexOf(n);
    const iN = ix('Nombre en pantalla'), iC = ix('Categoría del producto'), iP = ix('Proveedores');
    const iD = ix('Cantidad disponible para uso'), iE = ix('Entrante'), iK = ix('Costo');
    const out: BaseRow[] = [];
    let cur: BaseRow | null = null;
    for (const r of R.slice(1)) {
      const nm = str(r[iN]);
      if (nm && str(r[iC])) {
        cur = { sku: nm, categoria: str(r[iC]), prov: str(r[iP]), proveedores: [], disp: num(r[iD]), ent: num(r[iE]), costo: num(r[iK]) };
        out.push(cur);
      } else if (nm) cur = null;
      if (cur && str(r[iP])) cur.proveedores.push(str(r[iP]));
    }
    return out;
  }
  function leerConsumo(): ConsumoTabla {
    const R = hoja('entradas/IN_Consumo.xlsx');
    return {
      headers: (R[1] as unknown[]).map((x) => (typeof x === 'string' ? x : null)),
      filas: R.slice(4).map((r) => ({ nombre: String(r[0] ?? '').trim(), vals: r.map((v) => (typeof v === 'number' ? v : null)) })),
    };
  }
  function leerPlan(): PlanMensual {
    const R = hoja('entradas/IN_Plan.xlsx');
    const P = new Map<string, (number | null)[]>();
    for (const r of R) {
      if (typeof r[0] === 'string') P.set(r[0].trim().toLowerCase(), Array.from({ length: 12 }, (_, i) => (typeof r[1 + i] === 'number' ? (r[1 + i] as number) : null)));
    }
    const g = (k: string) => P.get(k.toLowerCase()) ?? Array(12).fill(null);
    return {
      diasHabiles: g('Días hábiles del mes'), diasTranscurridos: g('Días hábiles transcurridos'),
      prodRealSillones: g('Producción real Sillones equiv.'), prodRealColchones: g('Producción real Colchones'),
      prodConsSillones: g('Producción consensuada Sillones equiv.'), prodConsColchones: g('Producción consensuada Colchones'),
      ventasConsColchones: g('Ventas consensuadas Colchones'),
    };
  }
  function leerOc(): OcLinea[] {
    const R = hoja('entradas/oc_pendientes_mp.xlsx');
    const out: OcLinea[] = [];
    const f = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
    R.forEach((r, i) => {
      if (typeof r[0] === 'number') {
        out.push({
          fila: i + 1, n: String(r[1] ?? '').trim(), fecha: f(r[6]), pend: Math.max(0, num(r[9])),
          categoria: String(r[2] ?? ''), orden: String(r[3] ?? ''), prov: String(r[4] ?? '').trim(), fechaOrden: f(r[5]),
          pedida: num(r[7]), recibida: num(r[8]), condicion: String(r[12] ?? ''), ultimaRecepcion: f(r[15]),
          recepcionProgramada: f(r[16]), remito: String(r[17] ?? ''),
        });
      }
    });
    return out;
  }
  return { hoja, str, num, leerBase, leerConsumo, leerPlan, leerOc };
}

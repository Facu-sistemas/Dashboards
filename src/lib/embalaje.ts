import { getOdooCerradoDia, type OdooOrdenCerrada } from '@/lib/odoo/embalaje';
import { getEscaneosDia, type EscaneoRegistro } from '@/lib/supabase/embalaje-escaneos';

export interface EmbalajeFila {
  barcode: string | null;
  producto: string;
  odoo: number;
  escaneado: number;
  /** escaneado − odoo: positivo = sobran, negativo = faltan. */
  diferencia: number;
  ultimoEscaneo: string | null;
}

export interface EmbalajeResult {
  fecha: string;
  desdeHora: string;
  disponible: boolean;
  filas: EmbalajeFila[];
  totalOdoo: number;
  totalEscaneado: number;
  escaneos: EscaneoRegistro[];
  ordenesCerradas: OdooOrdenCerrada[];
}

export async function getEmbalaje(fecha: string, desdeHora = '00:00'): Promise<EmbalajeResult> {
  const [odoo, esc] = await Promise.all([getOdooCerradoDia(fecha, desdeHora), getEscaneosDia(fecha, desdeHora)]);
  const filas = new Map<string, EmbalajeFila>();
  const key = (barcode: string | null, id: number | string) => (barcode ? barcode.toUpperCase() : `odoo-${id}`);

  for (const o of odoo.porProducto) {
    filas.set(key(o.barcode, o.productoId), {
      barcode: o.barcode,
      producto: o.producto,
      odoo: o.unidades,
      escaneado: 0,
      diferencia: 0,
      ultimoEscaneo: null,
    });
  }
  for (const e of esc.porProducto) {
    const k = key(e.barcode, e.barcode);
    const fila = filas.get(k) ?? {
      barcode: e.barcode,
      producto: e.producto ?? e.barcode,
      odoo: 0,
      escaneado: 0,
      diferencia: 0,
      ultimoEscaneo: null,
    };
    fila.escaneado = e.cantidad;
    fila.ultimoEscaneo = e.ultimo;
    filas.set(k, fila);
  }
  const lista = [...filas.values()].map((f) => ({ ...f, diferencia: f.escaneado - f.odoo }));
  lista.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia) || a.producto.localeCompare(b.producto));
  return {
    fecha,
    desdeHora,
    disponible: esc.disponible,
    filas: lista,
    totalOdoo: lista.reduce((s, f) => s + f.odoo, 0),
    totalEscaneado: lista.reduce((s, f) => s + f.escaneado, 0),
    escaneos: esc.lista,
    ordenesCerradas: odoo.ordenes,
  };
}

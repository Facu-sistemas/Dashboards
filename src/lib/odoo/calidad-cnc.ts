import { searchReadAll, searchCount } from './client';
import { getCncObjetivos } from './cnc-objetivos';
import { getRegiones, parseRecargoPct } from './costo-devoluciones';
import { monthBounds } from '../date';
import type { OdooDomain } from './types';

/**
 * Costo de No Calidad (CNC): datos del mes que lee el tab Gerencia General → Calidad (CNC).
 *
 *  - Notas de crédito: `account.move` `out_refund` posteadas, con el motivo
 *    (`x_studio_motivo_1`) y la nota (`x_studio_nota`) que se cargan en Odoo
 *    desde el 18-sep-2026 (mismos campos que notas-credito-devolucion.ts).
 *  - % de flete del cliente: región del cliente ("CORDOBA - 5%"), igual que
 *    Costo de devoluciones (getRegiones / parseRecargoPct).
 *  - Facturación neta: `amount_untaxed_signed` de facturas y notas de crédito
 *    posteadas del mes (las NC restan).
 *  - Pedidos entregados: despachos de salida (`stock.picking` outgoing) hechos en el mes.
 *  - Objetivo mensual: hoja "Hoja2" del dashboard "Reunión de equipo de gestión" (cnc-objetivos.ts).
 *  - Valor hora: `lst_price` del producto "SERVICIO DE REPARACION" (product.product 24085).
 *
 * Las reglas de cálculo (qué nota cuenta, horas, flete) no viven acá: son
 * parámetros de la empresa y se aplican en el front.
 */

export interface CncNota {
  id: number;
  fecha: string;
  nc: string;
  cliente: string;
  /** Motivo tal como está en Odoo ("Calidad", "Logístico"...). Vacío si no se cargó. */
  motivo: string;
  /** Nota de N/C tal como está en Odoo ("Garantía real"...). Vacío si no se cargó. */
  nota: string;
  /** Importe sin impuestos, positivo. */
  importe: number;
  /** Recargo de flete de la región del cliente (5 = 5%), o null si el cliente no tiene región. */
  fletePct: number | null;
}

export interface CncData {
  mes: string;
  notas: CncNota[];
  facturacionNeta: number;
  pedidosEntregados: number;
  /** Precio de venta (lst_price) del producto "SERVICIO DE REPARACION" en Odoo: costo de una hora de reparación. */
  valorHora: number;
  /** Objetivo de CNC % facturación por mes del año (1–12), en puntos porcentuales (0,6 = 0,6%). */
  objetivos: Record<number, number>;
}

/** product.product "SERVICIO DE REPARACION": su precio de venta es el valor hora. */
const PRODUCTO_HORA_ID = 24085;

interface NotaRow extends Record<string, unknown> {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  invoice_date: string;
  amount_untaxed_signed: number;
  x_studio_motivo_1: [number, string] | false;
  x_studio_nota: [number, string] | false;
}

export async function getCncData(mes: string): Promise<CncData> {
  const { start, endExclusive } = monthBounds(mes);
  const enMes: OdooDomain = [
    ['invoice_date', '>=', start],
    ['invoice_date', '<', endExclusive],
  ];

  const [rows, facturado, pedidosEntregados, productoHora, objetivos] = await Promise.all([
    searchReadAll<NotaRow>({
      model: 'account.move',
      domain: [
        ['move_type', '=', 'out_refund'],
        ['state', '=', 'posted'],
        ...enMes,
        '|',
        ['x_studio_motivo_1', '!=', false],
        ['x_studio_nota', '!=', false],
      ],
      fields: ['name', 'partner_id', 'invoice_date', 'amount_untaxed_signed', 'x_studio_motivo_1', 'x_studio_nota'],
    }),
    searchReadAll<{ id: number; amount_untaxed_signed: number }>({
      model: 'account.move',
      domain: [['move_type', 'in', ['out_invoice', 'out_refund']], ['state', '=', 'posted'], ...enMes],
      fields: ['amount_untaxed_signed'],
    }),
    searchCount('stock.picking', [
      ['picking_type_code', '=', 'outgoing'],
      ['state', '=', 'done'],
      ['date_done', '>=', `${start} 00:00:00`],
      ['date_done', '<', `${endExclusive} 00:00:00`],
    ]),
    searchReadAll<{ id: number; lst_price: number }>({
      model: 'product.product',
      domain: [['id', '=', PRODUCTO_HORA_ID]],
      fields: ['lst_price'],
    }),
    getCncObjetivos(),
  ]);

  const regiones = await getRegiones(rows.flatMap((r) => (r.partner_id ? [r.partner_id[0]] : [])));

  const notas: CncNota[] = rows
    .map((r) => ({
      id: r.id,
      fecha: r.invoice_date,
      nc: r.name,
      cliente: r.partner_id ? r.partner_id[1] : '—',
      motivo: r.x_studio_motivo_1 ? r.x_studio_motivo_1[1] : '',
      nota: r.x_studio_nota ? r.x_studio_nota[1] : '',
      importe: Math.abs(r.amount_untaxed_signed),
      fletePct: r.partner_id ? parseRecargoPct(regiones.get(r.partner_id[0])) : null,
    }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.nc.localeCompare(a.nc));

  return {
    mes,
    notas,
    facturacionNeta: facturado.reduce((s, m) => s + m.amount_untaxed_signed, 0),
    pedidosEntregados,
    valorHora: productoHora[0]?.lst_price ?? 0,
    objetivos,
  };
}

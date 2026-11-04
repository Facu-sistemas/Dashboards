import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getEmbalaje } from '@/lib/embalaje';
import { buscarProductoPorBarcode } from '@/lib/odoo/embalaje';
import { getArgentinaTodayIso } from '@/lib/odoo/oee';
import { anularEscaneo, deshacerEscaneo, registrarEscaneo } from '@/lib/supabase/embalaje-escaneos';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const AREA = 'planta';
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const horaSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const bodySchema = z.discriminatedUnion('accion', [
  z.object({
    accion: z.enum(['escanear', 'deshacer']),
    codigo: z.string().trim().min(1).max(64),
    fecha: fechaSchema.optional(),
    /** Cuál de los dos scanners lo leyó (lo deduce la pantalla del prefijo ZZ1 / ZZ2). */
    scanner: z.union([z.literal(1), z.literal(2)]).optional(),
  }),
  z.object({ accion: z.literal('anular'), id: z.number().int().positive() }),
]);

// GET /api/embalaje-escaneos?fecha=YYYY-MM-DD&desde=HH:MM — cerrado en Odoo vs escaneado por embalaje
export const GET: APIRoute = async (context) => {
  if (!context.locals.usuario?.areasPermitidas.includes(AREA)) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(async () => {
    const f = context.url.searchParams.get('fecha');
    if (f && !fechaSchema.safeParse(f).success) throw new ApiValidationError('fecha inválida');
    const h = context.url.searchParams.get('desde');
    if (h && !horaSchema.safeParse(h).success) throw new ApiValidationError('hora inválida');
    return getEmbalaje(f ?? getArgentinaTodayIso(), h ?? '00:00');
  });
};

// POST /api/embalaje-escaneos — { accion: 'escanear' | 'deshacer', codigo, fecha? } o { accion: 'anular', id }
export const POST: APIRoute = async (context) => {
  if (!context.locals.usuario?.areasPermitidas.includes(AREA)) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(async () => {
    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      throw new ApiValidationError('JSON inválido');
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) throw new ApiValidationError('Código inválido');
    if (parsed.data.accion === 'anular') {
      const anulado = await anularEscaneo(parsed.data.id);
      if (!anulado) throw new ApiValidationError('Ese escaneo ya estaba borrado.');
      return { producto: anulado.producto ?? 'escaneo borrado', barcode: '', scanner: anulado.scanner };
    }
    const { accion, codigo, fecha, scanner } = parsed.data;

    // Las órdenes (WH/MO/...) no se cuentan: embalaje escanea el código de barras del producto.
    if (/^WH[/-]MO[/-]/i.test(codigo)) {
      throw new ApiValidationError('Es una etiqueta de orden (WH/MO). Escaneá el código de barras del producto.');
    }
    const producto = await buscarProductoPorBarcode(codigo);
    if (!producto) throw new ApiValidationError(`El código "${codigo}" no corresponde a ningún colchón de Odoo.`);

    if (accion === 'escanear') {
      await registrarEscaneo(producto.barcode, producto.producto, context.locals.usuario!.username, scanner);
      return { producto: producto.producto, barcode: producto.barcode, scanner: scanner ?? null };
    }
    const anulado = await deshacerEscaneo(producto.barcode, fecha ?? getArgentinaTodayIso());
    if (!anulado) throw new ApiValidationError(`No hay escaneos de "${producto.producto}" para deshacer.`);
    return { producto: producto.producto, barcode: producto.barcode, scanner: anulado.scanner };
  });
};

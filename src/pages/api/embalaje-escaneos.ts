import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getEmbalaje } from '@/lib/embalaje';
import { buscarProductoPorBarcode } from '@/lib/odoo/embalaje';
import { getArgentinaTodayIso } from '@/lib/odoo/oee';
import { deshacerEscaneo, registrarEscaneo } from '@/lib/supabase/embalaje-escaneos';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const AREA = 'logistica';
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bodySchema = z.object({
  accion: z.enum(['escanear', 'deshacer']),
  codigo: z.string().trim().min(1).max(64),
  fecha: fechaSchema.optional(),
});

// GET /api/embalaje-escaneos?fecha=YYYY-MM-DD — cerrado en Odoo vs escaneado por embalaje
export const GET: APIRoute = async (context) => {
  if (!context.locals.usuario?.areasPermitidas.includes(AREA)) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(async () => {
    const f = context.url.searchParams.get('fecha');
    if (f && !fechaSchema.safeParse(f).success) throw new ApiValidationError('fecha inválida');
    return getEmbalaje(f ?? getArgentinaTodayIso());
  });
};

// POST /api/embalaje-escaneos — { accion: 'escanear' | 'deshacer', codigo, fecha? }
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
    const { accion, codigo, fecha } = parsed.data;

    // Las órdenes (WH/MO/...) no se cuentan: embalaje escanea el código de barras del producto.
    if (/^WH[/-]MO[/-]/i.test(codigo)) {
      throw new ApiValidationError('Es una etiqueta de orden (WH/MO). Escaneá el código de barras del producto.');
    }
    const producto = await buscarProductoPorBarcode(codigo);
    if (!producto) throw new ApiValidationError(`El código "${codigo}" no corresponde a ningún producto de Odoo.`);

    if (accion === 'escanear') {
      await registrarEscaneo(producto.barcode, producto.producto, context.locals.usuario!.username);
    } else {
      const hubo = await deshacerEscaneo(producto.barcode, fecha ?? getArgentinaTodayIso());
      if (!hubo) throw new ApiValidationError(`No hay escaneos de "${producto.producto}" para deshacer.`);
    }
    return { producto: producto.producto, barcode: producto.barcode };
  });
};

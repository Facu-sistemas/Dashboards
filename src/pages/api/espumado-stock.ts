import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getEspumado } from '@/lib/odoo/espumado';
import { listarEspumadoDias, guardarEspumadoDia } from '@/lib/supabase/espumado-dia';
import { calcularFilas, calcularControl } from '@/lib/espumado-stock';
import { BLOQUES_CATALOGO, bloqueKey } from '@/lib/espumado-catalogo';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');

function hoyLocal(): string {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() - 3);
  return d.toISOString().slice(0, 10);
}

function diasDesde(fecha: string, hoy: string): number {
  return Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${fecha}T00:00:00Z`)) / 86_400_000) + 1;
}

// GET /api/espumado-stock?fecha=AAAA-MM-DD — stock por tipo y medida al cierre de ese día + control en kg contra Odoo.
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(async () => {
    const hoy = hoyLocal();
    const parsed = fechaSchema.safeParse(url.searchParams.get('fecha') ?? hoy);
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    const fecha = parsed.data;
    if (fecha > hoy) throw new ApiValidationError('No se puede cargar un día futuro');
    const dias = diasDesde(fecha, hoy);
    if (dias > 90) throw new ApiValidationError('El control contra Odoo cubre hasta 90 días hacia atrás');

    const [{ disponible, filas: guardadas }, odoo] = await Promise.all([listarEspumadoDias(fecha), getEspumado(dias)]);
    const filas = calcularFilas(guardadas, fecha);
    return { fecha, disponible, filas, control: calcularControl(filas, odoo, fecha) };
  });
};

const filaSchema = z.object({
  tipo: z.string().min(1),
  medida: z.string().min(1),
  stockInicial: z.number().int().min(0).nullable(),
  produccion: z.number().int().min(0).max(9999),
  colchones: z.number().int().min(0).max(9999),
  living: z.number().int().min(0).max(9999),
  venta: z.number().int().min(0).max(9999),
  noConforme: z.number().int().min(0).max(9999),
});

const bodySchema = z.object({ fecha: fechaSchema, filas: z.array(filaSchema).min(1).max(200) });

// POST /api/espumado-stock — guarda el día completo ({ fecha, filas }). Quien tenga acceso al módulo Herramientas de producción.
export const POST: APIRoute = async (context) => {
  if (!context.locals.usuario?.areasPermitidas.includes('produccion')) {
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
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    const { fecha, filas } = parsed.data;
    if (fecha > hoyLocal()) throw new ApiValidationError('No se puede cargar un día futuro');

    const validas = new Set(BLOQUES_CATALOGO.map((b) => bloqueKey(b.tipo, b.medida)));
    const desconocida = filas.find((f) => !validas.has(bloqueKey(f.tipo, f.medida)));
    if (desconocida) throw new ApiValidationError(`Medida desconocida: ${desconocida.tipo} ${desconocida.medida}`);

    await guardarEspumadoDia(fecha, filas, context.locals.usuario!.username);
    return { fecha, guardadas: filas.length };
  });
};

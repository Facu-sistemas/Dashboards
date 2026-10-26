import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getOrdenesSillon } from '@/lib/odoo/lineas-sillon';
import { getEmpleadosActivos } from '@/lib/odoo/employees';
import {
  PUESTOS_PERSONA,
  SLOTS,
  agregarManual,
  borrarManual,
  borrarPersona,
  fijarPlan,
  getConfigSillon,
  getPlanFijado,
  guardarPersona,
  setAlias,
  setLinea,
  setTiempo,
} from '@/lib/supabase/lineas-sillon';
import { armarPlan, catalogoDe, type PlanSillon } from '@/lib/lineas-sillon/plan';
import { NUM_LINEAS } from '@/lib/lineas-sillon/engine';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

function requireTestAccess(context: { locals: App.Locals }): Response | null {
  if (!context.locals.usuario?.areasPermitidas.includes('test')) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return null;
}

const hoyArgentina = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const horaArgentina = () =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false }).format(new Date()));

/** Si todavía no hay foto del día y es temprano (antes de las 9), la primera vez que se abre la pantalla queda fijada: es el plan de las 6. */
const HORA_LIMITE_FOTO_AUTO = 9;

// GET /api/lineas-sillon?repartir=1 — plan de hoy + configuración editable.
// `repartir=1` reparte las órdenes sin línea entre las líneas habilitadas.
export const GET: APIRoute = async (context) => {
  const denied = requireTestAccess(context);
  if (denied) return denied;
  const repartir = new URL(context.request.url).searchParams.get('repartir') === '1';
  return handleApiRoute(async () => {
    const hoy = hoyArgentina();
    const [ordenes, config, empleados, fijadoPrevio] = await Promise.all([
      getOrdenesSillon(),
      getConfigSillon(),
      getEmpleadosActivos(),
      getPlanFijado<PlanSillon>(hoy),
    ]);
    const plan = armarPlan(ordenes, config, hoy, repartir);
    let fijado = fijadoPrevio;
    if (!fijado && config.disponible && horaArgentina() < HORA_LIMITE_FOTO_AUTO) {
      await fijarPlan(hoy, plan, 'automático');
      fijado = await getPlanFijado<PlanSillon>(hoy);
    }
    return { plan, config, empleados, fijado };
  });
};

const adelantoSchema = z.object({
  carpinteria: z.number().int().min(0).max(200),
  tapiceria: z.number().int().min(0).max(200),
  ensamble: z.number().int().min(0).max(200),
});

const bodySchema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('linea'),
    linea: z.number().int().min(1).max(NUM_LINEAS),
    activa: z.boolean(),
    asignados: z.record(z.enum(SLOTS), z.string().uuid().nullable()),
    adelanto: adelantoSchema,
  }),
  z.object({
    tipo: z.literal('persona'),
    id: z.string().uuid().optional(),
    empleadoId: z.number().int().positive().nullable(),
    nombre: z.string().trim().min(1).max(80),
    puesto: z.enum(PUESTOS_PERSONA as [string, ...string[]]),
    activa: z.boolean(),
    productos: z.array(z.string().max(200)).max(300),
  }),
  z.object({ tipo: z.literal('persona-borrar'), id: z.string().uuid() }),
  z.object({ tipo: z.literal('alias'), base: z.string().trim().min(1).max(200), producto: z.string().max(200).nullable() }),
  z.object({ tipo: z.literal('tiempo'), producto: z.string().max(200), minutos: z.number().positive().max(2000).nullable() }),
  z.object({
    tipo: z.literal('manual'),
    linea: z.number().int().min(1).max(NUM_LINEAS),
    producto: z.string().max(200),
    cantidad: z.number().int().min(1).max(200),
    nota: z.string().trim().max(120),
  }),
  z.object({ tipo: z.literal('manual-borrar'), id: z.string().uuid() }),
  z.object({ tipo: z.literal('fijar-plan'), repartir: z.boolean() }),
]);

// POST /api/lineas-sillon — una escritura de configuración por llamada (ver bodySchema).
export const POST: APIRoute = async (context) => {
  const denied = requireTestAccess(context);
  if (denied) return denied;

  return handleApiRoute(async () => {
    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      throw new ApiValidationError('JSON inválido');
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }

    const usuario = context.locals.usuario!.username;
    const d = parsed.data;
    const nombres = new Set(catalogoDe(await getConfigSillon()).map((p) => p.nombre));
    const productoValido = (p: string) => {
      if (!nombres.has(p)) throw new ApiValidationError(`Producto desconocido: ${p}`);
    };

    switch (d.tipo) {
      case 'linea':
        await setLinea(d.linea, { activa: d.activa, asignados: d.asignados, adelanto: d.adelanto }, usuario);
        break;
      case 'persona':
        d.productos.forEach(productoValido);
        await guardarPersona({ ...d, puesto: d.puesto as (typeof PUESTOS_PERSONA)[number] }, usuario);
        break;
      case 'persona-borrar':
        await borrarPersona(d.id);
        break;
      case 'alias':
        if (d.producto !== null) productoValido(d.producto);
        await setAlias(d.base, d.producto, usuario);
        break;
      case 'tiempo':
        productoValido(d.producto);
        await setTiempo(d.producto, d.minutos, usuario);
        break;
      case 'manual':
        productoValido(d.producto);
        await agregarManual({ linea: d.linea, producto: d.producto, cantidad: d.cantidad, nota: d.nota }, usuario);
        break;
      case 'manual-borrar':
        await borrarManual(d.id);
        break;
      case 'fijar-plan': {
        const hoy = hoyArgentina();
        const config = await getConfigSillon();
        await fijarPlan(hoy, armarPlan(await getOrdenesSillon(), config, hoy, d.repartir), usuario);
        break;
      }
    }
    return { saved: true };
  });
};

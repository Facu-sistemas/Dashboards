import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getOrdenesSillon } from '@/lib/odoo/lineas-sillon';
import { getEmpleadosActivos } from '@/lib/odoo/employees';
import {
  PUESTOS_PERSONA,
  SLOTS,
  agregarManual,
  ajustarIgnoradas,
  borrarManual,
  borrarPersona,
  crearPersonas,
  fijarPlan,
  getConfigSillon,
  getPlanFijado,
  limpiarIgnoradas,
  guardarPersona,
  setAlias,
  setLinea,
  setTiempo,
} from '@/lib/supabase/lineas-sillon';
import { armarPlan, catalogoDe, type PlanSillon } from '@/lib/lineas-sillon/plan';
import {
  PROCESOS,
  buscarUnico,
  getMatrizPolivalencia,
  mismoNombre,
  nivelesParaDatos,
  procesoPrincipal,
  type ProcesoHoja,
} from '@/lib/lineas-sillon/polivalencia';
import { NUM_LINEAS } from '@/lib/lineas-sillon/engine';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

function requireTestAccess(context: { locals: App.Locals }): Response | null {
  if (!context.locals.usuario?.areasPermitidas.includes('produccion')) {
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
    niveles: z.record(z.enum(PROCESOS as [ProcesoHoja, ...ProcesoHoja[]]), z.record(z.string().max(200), z.union([z.literal(1), z.literal(2), z.literal(3)]))).optional(),
  }),
  z.object({ tipo: z.literal('importar-hoja') }),
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
  // delta +1 = ignorar una unidad de la orden; -1 = volver a incluirla.
  z.object({ tipo: z.literal('ignorar-limpiar'), repartir: z.boolean() }),
  z.object({ tipo: z.literal('ignorar'), orden: z.string().trim().min(1).max(80), delta: z.union([z.literal(1), z.literal(-1)]), repartir: z.boolean() }),
]);

const PUESTO_DE_PROCESO = { COS: 'costurera', CAR: 'carpintero', TAP: 'tendido', ENS: 'estampado' } as const;

/** Copia a Supabase la matriz de polivalencia de Diseño: crea a quien falta y completa los niveles de quien está vacío. Lo ya editado en la web no se pisa. */
async function importarDeLaHoja(usuario: string) {
  const matriz = await getMatrizPolivalencia();
  if (!matriz) throw new ApiValidationError('No se pudo leer la hoja de Diseño (¿sigue compartida por link?)');
  const [config, empleados] = await Promise.all([getConfigSillon(), getEmpleadosActivos()]);
  const productos = catalogoDe(config).map((p) => p.nombre);
  const nuevas: Parameters<typeof crearPersonas>[0] = [];
  const sinEmpleado: string[] = [];
  let completadas = 0;
  let yaCargadas = 0;

  for (const hoja of matriz.personas) {
    const niveles = nivelesParaDatos(matriz, hoja, productos);
    const proceso = procesoPrincipal(niveles);
    if (!proceso) continue;
    const existente = config.personas.find((p) => mismoNombre(hoja.nombre, p.nombre));
    if (existente) {
      // Se agregan los procesos que la persona todavía no tiene cargados; los que ya tienen niveles (editados acá) no se pisan.
      const faltan = PROCESOS.filter((pr) => niveles[pr] && Object.keys(existente.niveles[pr] ?? {}).length === 0);
      if (faltan.length > 0) {
        const completo = { ...existente.niveles };
        for (const pr of faltan) completo[pr] = niveles[pr];
        await guardarPersona({ ...existente, niveles: completo }, usuario);
        completadas += 1;
      } else yaCargadas += 1;
      continue;
    }
    const empleado = buscarUnico(empleados, hoja.nombre, (e) => e.nombre);
    if (!empleado) sinEmpleado.push(hoja.nombre.trim());
    nuevas.push({ empleadoId: empleado?.id ?? null, nombre: empleado?.nombre ?? hoja.nombre.trim().replace(/\s+/g, ' '), puesto: PUESTO_DE_PROCESO[proceso], niveles });
  }
  await crearPersonas(nuevas, usuario);
  return { creadas: nuevas.length, completadas, yaCargadas, sinEmpleado };
}

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
      case 'importar-hoja':
        return await importarDeLaHoja(usuario);
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
      case 'ignorar':
      case 'ignorar-limpiar': {
        if (d.tipo === 'ignorar') await ajustarIgnoradas(d.orden, d.delta, usuario);
        else await limpiarIgnoradas();
        // Si ya hay plan fijado hoy, se rearma sin lo ignorado para que la hoja impresa también se corra.
        const hoy = hoyArgentina();
        if (await getPlanFijado<PlanSillon>(hoy)) {
          await fijarPlan(hoy, armarPlan(await getOrdenesSillon(), await getConfigSillon(), hoy, d.repartir), usuario);
        }
        break;
      }
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

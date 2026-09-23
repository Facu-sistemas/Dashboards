import type { APIRoute } from 'astro';
import { z } from 'zod';
import { marcarSobrantesConsumidos, crearSobrante, borrarSobranteDelDia, upsertSesionVertical } from '../../lib/supabase/vertical-sobrantes';
import { handleApiRoute, jsonResponse, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const bloqueCargadoSchema = z.object({
  colorBlock: z.string().min(1),
  anchoBlockCm: z.number().positive(),
  largoBlockCm: z.number().positive(),
  altoBlockCm: z.number().positive(),
  densidadBlock: z.number().positive(),
  cantidad: z.number().int().positive(),
});

const colorResultSchema = z.object({
  colorBlock: z.string().min(1),
  sobrantesConsumidosIds: z.array(z.string()),
  sobranteResultanteCm: z.number().positive().nullable(),
  anchoBlockCm: z.number().positive(),
  largoBlockCm: z.number().positive(),
  bloquesCargados: z.array(bloqueCargadoSchema),
});

const bodySchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha debe ser YYYY-MM-DD'),
  colores: z.array(colorResultSchema).min(1),
});

function requireProduccionAccess(context: { locals: App.Locals }): Response | null {
  if (!context.locals.usuario?.areasPermitidas.includes('produccion')) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return null;
}

// POST /api/vertical-guardar — guarda, por color, lo que se cargó hoy para
// este día de planificación: marca consumidos los sobrantes que se usaron,
// reemplaza el sobrante que ESTE mismo día/color haya dejado antes (evita
// duplicar filas si se re-guarda el mismo color), crea el sobrante nuevo si
// quedó algo aprovechable, y deja el registro por (fecha, color) para que
// cualquiera que abra la pantalla más tarde vea lo que ya se cargó.
export const POST: APIRoute = async (context) => {
  const denied = requireProduccionAccess(context);
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
    const { fecha, colores } = parsed.data;
    const userId = context.locals.usuario!.id;

    for (const c of colores) {
      await marcarSobrantesConsumidos(c.sobrantesConsumidosIds, fecha);
      await borrarSobranteDelDia(fecha, c.colorBlock);
      if (c.sobranteResultanteCm !== null) {
        await crearSobrante({
          colorBlock: c.colorBlock,
          anchoBlockCm: c.anchoBlockCm,
          largoBlockCm: c.largoBlockCm,
          altoDisponibleCm: c.sobranteResultanteCm,
          origenFecha: fecha,
        });
      }
      await upsertSesionVertical(userId, fecha, c.colorBlock, c.bloquesCargados, c.sobranteResultanteCm);
    }

    return { saved: true };
  });
};

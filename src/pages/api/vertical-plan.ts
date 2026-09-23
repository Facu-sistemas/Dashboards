import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getVerticalDemanda, getVerticalBaseTecnica } from '../../lib/odoo/vertical';
import { getSobrantesDisponibles, getSesionesVertical } from '../../lib/supabase/vertical-sobrantes';
import { construirNecesidad } from '../../lib/vertical-calc';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe ser YYYY-MM-DD'),
});

// GET /api/vertical-plan?date=2026-09-21 — demanda del día (mrp.production,
// filtro "SILLON POLIESTER ALMOHADON") + base técnica (Bom_poliester_soft) +
// sobrantes disponibles en Supabase, sin aplicar todavía los blocks que el
// usuario vaya a cargar (eso se recalcula en el cliente con vertical-calc).
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(async () => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const { date } = parsed.data;

    const [demanda, baseTecnica] = await Promise.all([getVerticalDemanda(date), getVerticalBaseTecnica()]);
    const { piezasPorColor, sinMatch } = construirNecesidad(demanda, baseTecnica.cortes);

    const colores = [...piezasPorColor.keys()];
    const [sobrantesDisponibles, sesionesGuardadas] = await Promise.all([
      Promise.all(colores.map((c) => getSobrantesDisponibles(c))).then((r) => r.flat()),
      getSesionesVertical(date),
    ]);

    return {
      piezasPorColor: Object.fromEntries(piezasPorColor),
      sinMatch,
      sobrantesDisponibles,
      blocks: baseTecnica.blocks,
      // Lo que ya se guardó hoy para este día, por color — el cliente lo usa
      // para precargar los blocks "cargados" en vez de arrancar en blanco,
      // así una segunda persona que abre la pantalla ve lo que ya se hizo.
      bloquesCargadosGuardados: Object.fromEntries(sesionesGuardadas.map((s) => [s.colorBlock, s.bloquesCargados])),
    };
  });
};

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getMulticorteBaseTecnica } from '../../lib/odoo/multicorte';
import { procesarOptimizacion, resolverDemandaManual } from '../../lib/multicorte-calc';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const bodySchema = z.object({
  demanda: z
    .array(
      z.object({
        producto: z.string().min(1),
        cantidad: z.number().positive(),
      })
    )
    .min(1, 'Pegá al menos una fila con producto y cantidad'),
});

// POST /api/multicorte-plan-manual — mismo optimizador que /api/multicorte-plan,
// pero la demanda viene de una lista PRODUCTO/CANTIDAD pegada a mano (en
// unidades de colchón terminado, como se copia de Odoo/Excel) en vez de las
// mrp.production en vivo. La base técnica (Medidas_multicorte) sigue viniendo
// en vivo desde Odoo; acá además se usa para convertir colchón→placa
// (cant_placas) antes de correr el mismo optimizador de siempre.
export const POST: APIRoute = async ({ request }) => {
  return handleApiRoute(async () => {
    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const baseTecnica = await getMulticorteBaseTecnica();
    const { demandaPlacas, sinMatch: sinMatchProducto } = resolverDemandaManual(parsed.data.demanda, baseTecnica.productos, baseTecnica.placas);
    const { bloques, sinMatch: sinMatchPlaca } = procesarOptimizacion(demandaPlacas, baseTecnica.placas, baseTecnica.blocks);
    return { bloques, sinMatch: [...sinMatchProducto, ...sinMatchPlaca] };
  });
};

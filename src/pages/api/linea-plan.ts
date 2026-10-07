import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getLineaOrdenes } from '../../lib/odoo/linea-resorte';
import { getBusinessDayChecker } from '../../lib/odoo/business-calendar';
import { getArgentinaTodayIso } from '../../lib/odoo/oee';
import { getConfigLinea } from '../../lib/supabase/linea-config';
import { MESA_CODIGOS, mergeReglas } from '../../lib/linea-config';
import { simularLinea } from '../../lib/linea-calc';
import { addDaysIso } from '../../lib/date';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe ser YYYY-MM-DD'),
  /** Completar cada jornada hasta 488 min adelantando trabajo de días siguientes (default sí). */
  completar: z.enum(['0', '1']).default('1'),
});

/** "Sin agendar" (2100-01-01) se planifica como bolsa propia, sin simular días. */
const SIN_AGENDAR_DATE = '2100-01-01';
/** Tope de días hábiles a simular hacia adelante — más allá no tiene sentido arrastrar. */
const MAX_DIAS_SIMULADOS = 60;

/** Días hábiles desde hoy hasta el objetivo (inclusive). Si el objetivo es hoy o ya pasó, solo él. */
async function diasASimular(objetivo: string): Promise<string[]> {
  const hoy = getArgentinaTodayIso();
  if (objetivo === SIN_AGENDAR_DATE || objetivo <= hoy) return [objetivo];

  const esHabil = await getBusinessDayChecker();
  const dias: string[] = [];
  for (let d = hoy; d < objetivo && dias.length < MAX_DIAS_SIMULADOS; d = addDaysIso(d, 1)) {
    if (esHabil(d)) dias.push(d);
  }
  dias.push(objetivo);
  return dias;
}

// GET /api/linea-plan?date=2026-10-06 — órdenes del filtro "Colchón Línea
// Resorte" repartidas en las mesas activas según las reglas por familia de
// TAP, con el arrastre de lo vencido y de lo que no entra en los días
// hábiles previos (simulados desde hoy).
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(async () => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const { date } = parsed.data;
    const completar = parsed.data.completar === '1' && date !== SIN_AGENDAR_DATE;

    const [ordenes, config, dias] = await Promise.all([getLineaOrdenes(date), getConfigLinea(), diasASimular(date)]);
    const activas = new Set(MESA_CODIGOS.filter((c) => !config.mesasInactivas.includes(c)));
    return {
      ...simularLinea(ordenes, mergeReglas(config.reglas), activas, dias, completar),
      configDisponible: config.disponible,
      completar,
    };
  });
};

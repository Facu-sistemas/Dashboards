import type { APIRoute } from 'astro';
import { getRrhhPlanilla } from '@/lib/rrhh-planilla';
import { handleApiRoute, ApiValidationError } from '@/lib/api-helpers';
import { invalidateByPrefix } from '@/lib/cache';

export const prerender = false;

// GET /api/rrhh-planilla?desde=YYYY-MM-DD&hasta=YYYY-MM-DD[&refresh=1]
// refresh=1 ("Sincronizar con Odoo"): descarta el cache corto de lecturas de Odoo para traer lo último (un cambio recién hecho en
// Odoo, como una licencia aprobada o el convenio de un empleado, se ve en el momento). Solo lee: no escribe nada en Odoo.
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const desde = url.searchParams.get('desde');
    const hasta = url.searchParams.get('hasta');
    if (!desde || !hasta) throw new ApiValidationError('Faltan los parámetros desde y hasta');
    if (url.searchParams.get('refresh') === '1') {
      invalidateByPrefix('search_read::');
      invalidateByPrefix('read_group::');
      invalidateByPrefix('search_count::');
    }
    return getRrhhPlanilla(desde, hasta);
  });
};

import type { APIRoute } from 'astro';
import { getObjetivosWriteDate } from '../../lib/odoo/gerencia-objetivos';
import { invalidateByPrefix } from '../../lib/cache';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/gerencia-sync?refresh=1 — con refresh=1 descarta el cache de lecturas de Odoo antes de leer, así la tabla "Equipo de gestión" se vuelve a bajar de Odoo.
// Sin refresh, solo informa cuándo se editó por última vez.
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(async () => {
    if (url.searchParams.get('refresh') === '1') invalidateByPrefix('search_read::');
    return { writeDate: await getObjetivosWriteDate() };
  });
};

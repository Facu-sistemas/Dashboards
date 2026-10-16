import type { APIRoute } from 'astro';
import { getSeguimientoMo } from '@/lib/odoo/seguimiento-mo';
import { getUmbralesSeguimiento } from '@/lib/supabase/seguimiento-mo-umbrales';
import { handleApiRoute } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/seguimiento-mo — MO abiertas con semáforo, usando los umbrales guardados (o los default).
export const GET: APIRoute = async () =>
  handleApiRoute(async () => {
    const umbrales = await getUmbralesSeguimiento();
    const data = await getSeguimientoMo(umbrales.colchones, umbrales.living);
    return { ...data, umbralesDisponible: umbrales.disponible };
  });

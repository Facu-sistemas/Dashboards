import type { APIRoute } from 'astro';
import { getRoturas } from '@/lib/odoo/roturas';
import { handleApiRoute } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/devoluciones-roturas — ingresos por rotura (Transporte / Calidad) del tablero "Devoluciones" de Odoo
export const GET: APIRoute = async () => handleApiRoute(() => getRoturas());

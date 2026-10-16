import type { APIRoute } from 'astro';
import { getCargaLogistica } from '@/lib/odoo/logistica-carga';
import { handleApiRoute } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/logistica-carga
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getCargaLogistica());
};

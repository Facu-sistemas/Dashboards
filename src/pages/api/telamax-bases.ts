import type { APIRoute } from 'astro';
import { getTelamaxBases } from '@/lib/odoo/telamax';
import { handleApiRoute } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/telamax-bases — bases del planificador Telamax (tablero "Telamax" de Odoo, solo lectura)
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getTelamaxBases());
};

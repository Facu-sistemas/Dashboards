import type { APIRoute } from 'astro';
import { getTelamaxPedidos } from '@/lib/odoo/telamax-pedidos';
import { handleApiRoute } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/telamax-pedidos — órdenes de corte de tela con fecha de planificación (Odoo, solo lectura)
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getTelamaxPedidos());
};

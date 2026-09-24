import type { APIRoute } from 'astro';
import { getRrhhVacaciones } from '../../lib/odoo/rrhh-vacaciones';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/rrhh-vacaciones
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getRrhhVacaciones());
};

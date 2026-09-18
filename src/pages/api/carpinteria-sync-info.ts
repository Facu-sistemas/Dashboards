import type { APIRoute } from 'astro';
import { getBomListonWriteDate } from '../../lib/odoo/carpinteria';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/carpinteria-sync-info
export const GET: APIRoute = async () => {
  return handleApiRoute(async () => ({ writeDate: await getBomListonWriteDate() }));
};

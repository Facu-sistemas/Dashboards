import type { APIRoute } from 'astro';
import { getUpcomingBirthdays } from '../../lib/odoo/employees';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

export const GET: APIRoute = async () => {
  return handleApiRoute(() => getUpcomingBirthdays());
};

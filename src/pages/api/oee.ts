import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getOeeSummary } from '../../lib/odoo/oee';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('day'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});

// GET /api/oee?period=day&date=2026-08-28
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getOeeSummary(parsed.data.period, parsed.data.date);
  });
};

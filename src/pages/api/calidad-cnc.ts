import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getCncData } from '@/lib/odoo/calidad-cnc';
import { handleApiRoute, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
});

// GET /api/calidad-cnc?month=2026-10
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getCncData(parsed.data.month);
  });
};

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getClientMonthlyBilling } from '../../lib/odoo/pareto-clients';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  partner_ids: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
    )
    .refine((ids) => ids.length >= 1 && ids.length <= 2, 'partner_ids must have 1 or 2 positive integers'),
});

// GET /api/pareto-clients-monthly?partner_ids=37474,28585
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getClientMonthlyBilling(parsed.data.partner_ids);
  });
};

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getRawMaterialConsumption } from '../../lib/odoo/raw-material-consumption';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  category_id: z.coerce.number().int().positive().optional(),
  lookback_days: z.coerce.number().int().refine((v): v is 30 | 60 | 90 | 180 => [30, 60, 90, 180].includes(v), {
    message: 'lookback_days must be one of 30, 60, 90, 180',
  }).default(90),
  // z.coerce.boolean() would treat the literal string "false" as truthy
  // (non-empty string) — match explicitly instead.
  only_low: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

// GET /api/raw-material-consumption?category_id=32&lookback_days=90&only_low=true
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getRawMaterialConsumption(parsed.data.category_id ?? null, parsed.data.lookback_days, parsed.data.only_low);
  });
};

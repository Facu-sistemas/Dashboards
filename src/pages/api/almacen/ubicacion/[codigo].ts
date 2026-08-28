import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getUbicacionStock } from '../../../../lib/odoo/almacen';
import { handleApiRoute, ApiValidationError } from '../../../../lib/api-helpers';

export const prerender = false;

const codigoSchema = z
  .string()
  .regex(/^(?:[A-F]\.\d{1,2}\.[A-F]|Almacen 2)$/, 'codigo must look like RACK.COLUMN.LEVEL or be "Almacen 2"');

// GET /api/almacen/ubicacion/[codigo]
export const GET: APIRoute = async ({ params }) => {
  return handleApiRoute(() => {
    const parsed = codigoSchema.safeParse(params.codigo);
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getUbicacionStock(parsed.data);
  });
};

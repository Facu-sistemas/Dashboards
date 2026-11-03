import type { APIRoute } from 'astro';
import { z } from 'zod';
import { registrarLatido } from '@/lib/supabase/fichaje-kioscos';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const bodySchema = z.object({ camara: z.boolean(), problema: z.string().max(300).nullable() });

// POST /api/fichaje-latido — señal de vida del celular de quiosco (cada minuto). Guarda cuándo fue y en qué estado
// está la cámara, para verlo en el panel de admin y notar un celular caído o con la cámara apagada.
export const POST: APIRoute = async (context) => {
  const usuario = context.locals.usuario;
  if (!usuario?.areasPermitidas.includes('fichaje')) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(async () => {
    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      throw new ApiValidationError('JSON inválido');
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    await registrarLatido({ kiosco: usuario.username, camaraActiva: parsed.data.camara, problema: parsed.data.problema });
    return { ok: true };
  });
};

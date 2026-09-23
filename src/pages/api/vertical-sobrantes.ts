import type { APIRoute } from 'astro';
import { getSobrantesDisponibles } from '../../lib/supabase/vertical-sobrantes';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/vertical-sobrantes — inventario completo de sobrante disponible
// (todos los colores, no acotado a un día de planificación) para el panel
// "Sobrante" del Optimizador Vertical.
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getSobrantesDisponibles());
};

import type { APIRoute } from 'astro';
import { leerMarcaRecarga } from '@/lib/supabase/recarga-global';
import { handleApiRoute } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/recarga-estado — cualquier sesión iniciada. Devuelve la marca de la última recarga global pedida desde Admin.
export const GET: APIRoute = async () => handleApiRoute(async () => ({ marca: await leerMarcaRecarga() }));

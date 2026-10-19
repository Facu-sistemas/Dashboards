import type { APIRoute } from 'astro';
import { getQuizBandas } from '@/lib/quiz-bandas-sheet';
import { handleApiRoute } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/quiz-bandas — filas del Google Sheet del quiz de bandas (el cálculo se hace en el cliente)
export const GET: APIRoute = async () => handleApiRoute(() => getQuizBandas());

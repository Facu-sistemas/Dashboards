import type { APIRoute } from 'astro';
import { ApiValidationError, handleApiRoute, jsonResponse } from '@/lib/api-helpers';
import { guardarEstadoPresupuestoMp, leerEstadoPresupuestoMp } from '@/lib/supabase/presupuesto-mp-estado';
import snapshot from '@/data/presupuesto-mp.json';

export const prerender = false;

type UsuarioMin = { username: string; rol: string; areasPermitidas: string[] } | undefined;
const verCompras = (u: UsuarioMin) => !!u && u.areasPermitidas.includes('compras');
// La web no tiene permisos finos de edición: sube el libro solo el perfil de Compras (marly) y el rol dev.
const editarCompras = (u: UsuarioMin) => verCompras(u) && (u!.rol === 'dev' || u!.username.trim().toLowerCase() === 'marly');

const MAX_BYTES = 4_000_000;

// GET /api/presupuesto-mp — estado del tablero: la última versión subida desde el libro, o la foto incluida en el código.
export const GET: APIRoute = async ({ locals }) =>
  handleApiRoute(async () => {
    const g = await leerEstadoPresupuestoMp();
    return {
      estado: g ? g.datos : snapshot,
      origen: g ? 'publicado' : 'foto',
      actualizadoPor: g?.actualizadoPor ?? null,
      actualizadoEn: g?.actualizadoEn ?? null,
      puedeEditar: editarCompras(locals.usuario),
    };
  });

// POST /api/presupuesto-mp — publica una versión nueva (ya leída del libro en el navegador). Solo editores.
export const POST: APIRoute = async ({ locals, request }) => {
  if (!editarCompras(locals.usuario)) return jsonResponse({ ok: false, error: 'No tenés permiso para publicar versiones' }, { status: 403 });
  const texto = await request.text();
  if (texto.length > MAX_BYTES) return jsonResponse({ ok: false, error: 'El archivo es demasiado grande' }, { status: 413 });
  return handleApiRoute(async () => {
    let st: any;
    try {
      st = JSON.parse(texto);
    } catch {
      throw new ApiValidationError('Datos inválidos');
    }
    const ok =
      st && Array.isArray(st.cols) && Array.isArray(st.rows) && st.rows.length > 0 && st.meta && typeof st.meta === 'object' &&
      Array.isArray(st.meta.aprob) && Array.isArray(st.meta.vig) &&
      ['SKU', 'Categoría', 'Aprob $ 1', 'Real $ 1', 'Vig $ 1'].every((c) => st.cols.includes(c)) &&
      st.rows.every((r: unknown) => Array.isArray(r) && r.length === st.cols.length);
    if (!ok) throw new ApiValidationError('El libro no tiene el formato esperado');
    await guardarEstadoPresupuestoMp(st, locals.usuario!.username);
    return { guardado: true };
  });
};

import type { APIRoute } from 'astro';
import { ApiValidationError, handleApiRoute, jsonResponse } from '@/lib/api-helpers';
import { guardarEstadoAviso, leerEquivalenciasAviso, leerEstadoAviso, leerVistos } from '@/lib/supabase/aviso-quiebre';
import { getAvisoQuiebreVivo } from '@/lib/odoo/aviso-quiebre-vivo';
import snapshot from '@/data/aviso-quiebre.json';

export const prerender = false;

type UsuarioMin = { username: string; rol: string; areasPermitidas: string[] } | undefined;
const verCompras = (u: UsuarioMin) => !!u && u.areasPermitidas.includes('compras');
// Mismo criterio que Presupuesto MP: sube la versión semanal solo el perfil de Compras (marly) y el rol dev.
const editarCompras = (u: UsuarioMin) => verCompras(u) && (u!.rol === 'dev' || u!.username.trim().toLowerCase() === 'marly');

const MAX_BYTES = 2_000_000;
const NIVELES = ['rojo', 'naranja', 'amarillo'];

// GET /api/aviso-quiebre — foto semanal (la última subida o la del código) + capa en vivo de Odoo + vistos.
export const GET: APIRoute = async ({ locals }) => {
  if (!verCompras(locals.usuario)) return jsonResponse({ ok: false, error: 'Sin permiso' }, { status: 403 });
  return handleApiRoute(async () => {
    const g = await leerEstadoAviso();
    const estado = (g ? g.datos : snapshot) as typeof snapshot;
    const eq = await leerEquivalenciasAviso();
    const [vivo, vistos] = await Promise.all([
      // Si Odoo falla el aviso se muestra igual con la foto: la capa en vivo es un agregado.
      getAvisoQuiebreVivo(estado.alertas.map((a) => ({ sku: a.sku, cat: a.cat })), {
        equivalencias: eq.mapa,
        equivalenciasDisponibles: eq.disponible,
        paraEditar: editarCompras(locals.usuario),
      }).catch((e) => {
        console.error('[aviso-quiebre-vivo]', e);
        return null;
      }),
      leerVistos(estado.version),
    ]);
    return {
      estado,
      origen: g ? 'publicado' : 'foto',
      actualizadoPor: g?.actualizadoPor ?? null,
      actualizadoEn: g?.actualizadoEn ?? null,
      vivo,
      vistos: vistos.vistos,
      vistosDisponibles: vistos.disponible,
      yo: locals.usuario!.username,
      puedeEditar: editarCompras(locals.usuario),
    };
  });
};

// POST /api/aviso-quiebre — publica la versión semanal nueva (JSON { version, ventanas, alertas }). Solo editores.
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
      st && typeof st.version === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(st.version) && st.ventanas && typeof st.ventanas === 'object' &&
      Array.isArray(st.alertas) && st.alertas.length > 0 &&
      st.alertas.every(
        (a: any) =>
          a && typeof a.sku === 'string' && NIVELES.includes(a.nivel) && typeof a.quiebre === 'string' && typeof a.cat === 'string' &&
          Array.isArray(a.atrasado) && Array.isArray(a.proximas)
      );
    if (!ok) throw new ApiValidationError('El archivo no tiene el formato esperado del aviso');
    await guardarEstadoAviso(st, locals.usuario!.username);
    return { guardado: true };
  });
};

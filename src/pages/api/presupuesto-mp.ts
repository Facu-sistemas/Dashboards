import type { APIRoute } from 'astro';
import { handleApiRoute } from '@/lib/api-helpers';
import { leerEstadoPresupuestoMp } from '@/lib/supabase/presupuesto-mp-estado';
import { conInventarioVivo, type EstadoMp } from '@/lib/odoo/presupuesto-mp-vivo';
import { leerEquivalencias } from '@/lib/supabase/presupuesto-mp-equivalencias';
import { forzarSincronizacion } from '@/lib/odoo/forzar-sync';
import snapshot from '@/data/presupuesto-mp.json';

export const prerender = false;

type UsuarioMin = { username: string; rol: string; areasPermitidas: string[] } | undefined;
const verCompras = (u: UsuarioMin) => !!u && u.areasPermitidas.includes('compras');
// La web no tiene permisos finos de edición: sube el libro solo el perfil de Compras (marly) y el rol dev.
const editarCompras = (u: UsuarioMin) => verCompras(u) && (u!.rol === 'dev' || u!.username.trim().toLowerCase() === 'marly');

// GET /api/presupuesto-mp[?forzar=1] — estado del tablero: la foto del libro con el inventario en vivo de Odoo. `forzar=1` descarta la caché de lecturas.
export const GET: APIRoute = async ({ locals, url }) =>
  handleApiRoute(async () => {
    if (url.searchParams.get('forzar') === '1') forzarSincronizacion(['base-insumos']);
    const g = await leerEstadoPresupuestoMp();
    const eq = await leerEquivalencias();
    const puedeEditar = editarCompras(locals.usuario);
    return {
      estado: await conInventarioVivo((g ? g.datos : snapshot) as EstadoMp, { equivalencias: eq.mapa, equivalenciasDisponibles: eq.disponible, paraEditar: puedeEditar }),
      origen: g ? 'publicado' : 'foto',
      actualizadoPor: g?.actualizadoPor ?? null,
      actualizadoEn: g?.actualizadoEn ?? null,
      puedeEditar,
    };
  });

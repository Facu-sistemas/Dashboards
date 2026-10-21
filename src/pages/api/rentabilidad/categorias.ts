import type { APIRoute } from 'astro';
import { exigirAreaRentabilidad } from '@/lib/rentabilidad/auth';
import { handleApiRoute, ApiValidationError } from '@/lib/api-helpers';
import { getCategorias, getEvolucion, getProductos, parseFiltros } from '@/lib/odoo/rentabilidad/consultas';

export const prerender = false;

// GET /api/rentabilidad/categorias?anio=2026&mes=9&cliente=<id>
//   (sin más)                         -> categorías con sus subcategorías
//   &productos=<categoria>[&sub=<sub>] -> productos de esa categoría/subcategoría
//   &evolucion=<templateId>            -> evolución mensual de un producto en el año
export const GET: APIRoute = async ({ url, locals }) => {
  const denegado = exigirAreaRentabilidad(locals);
  if (denegado) return denegado;

  return handleApiRoute(() => {
    const filtros = parseFiltros(url.searchParams);
    const productos = url.searchParams.get('productos');
    if (productos) return getProductos(filtros, productos, url.searchParams.get('sub') || null);
    const evolucion = url.searchParams.get('evolucion');
    if (evolucion !== null) {
      const id = Number(evolucion);
      if (!Number.isInteger(id) || id < 0) throw new ApiValidationError('evolucion inválido');
      return getEvolucion(filtros, id);
    }
    return getCategorias(filtros);
  });
};

import { jsonResponse } from '@/lib/api-helpers';

/** El middleware ya exige sesión; acá además se exige el área 'finanzas' (Finanzas) (rol dev la tiene siempre). Devuelve una respuesta 403 si no, o null si puede seguir. */
export function exigirAreaRentabilidad(locals: App.Locals): Response | null {
  if (!locals.usuario?.areasPermitidas.includes('finanzas')) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return null;
}

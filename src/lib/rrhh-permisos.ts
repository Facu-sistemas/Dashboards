// Quién puede administrar RRHH (pestaña RRHH > Administración: estados del Resumen).
// La web no tiene permisos finos por pestaña: todos ven RRHH según su acceso al área, y esta pestaña la ven y usan solo
// la cuenta `rrhh` (si además tiene el área RRHH habilitada) y el rol dev, que administra la web.
// Todo endpoint que escribe estados tiene que pasar por `puedeAdministrarRrhh`.
export const AREA_RRHH = 'rrhh';
export const USUARIO_ADMIN_RRHH = 'rrhh';

type UsuarioMin = { username: string; rol: string; areasPermitidas: string[] } | undefined;

export function puedeAdministrarRrhh(u: UsuarioMin): boolean {
  if (!u) return false;
  if (u.rol === 'dev') return true;
  return u.areasPermitidas.includes(AREA_RRHH) && u.username.trim().toLowerCase() === USUARIO_ADMIN_RRHH;
}

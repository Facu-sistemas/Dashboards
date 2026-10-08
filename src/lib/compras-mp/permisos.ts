// Quién puede ver y quién puede editar el módulo Compras MP.
// La web no tiene permisos finos de edición: todos ven según su acceso al área Compras, y solo edita el perfil `marly`
// (más el rol dev, que administra la web). Todo endpoint que escribe tiene que pasar por `puedeEditarCompras`.
export const AREA_COMPRAS = 'finanzas';
export const USUARIO_EDITOR_COMPRAS = 'marly';

type UsuarioMin = { username: string; rol: string; areasPermitidas: string[] } | undefined;

export function puedeVerCompras(u: UsuarioMin): boolean {
  return !!u && u.areasPermitidas.includes(AREA_COMPRAS);
}

export function puedeEditarCompras(u: UsuarioMin): boolean {
  return puedeVerCompras(u) && (u!.rol === 'dev' || u!.username.trim().toLowerCase() === USUARIO_EDITOR_COMPRAS);
}

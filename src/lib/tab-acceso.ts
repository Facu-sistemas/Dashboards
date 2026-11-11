import type { TabConfig } from './areas.config';
import { puedeAdministrarRrhh, puedeRegistrarCaras } from './rrhh-permisos';

type UsuarioMin = { username: string; rol: string; areasPermitidas: string[] } | undefined;

/**
 * ¿Esta persona puede ver y abrir la pestaña? Las pestañas sin `acceso` las ve cualquiera que tenga el área; las
 * restringidas se filtran en la barra de pestañas (TabsNav) y se bloquean en la ruta ([area]/[tab].astro).
 */
export function tabVisible(tab: TabConfig, usuario: UsuarioMin): boolean {
  if (!tab.acceso) return true;
  if (tab.acceso === 'admin-rrhh') return puedeAdministrarRrhh(usuario);
  if (tab.acceso === 'registrar-caras') return puedeRegistrarCaras(usuario);
  return false;
}

import { searchReadAll } from './client';

export interface PermisoGrupo {
  id: number;
  /** Nombre del grupo tal cual aparece en Odoo (ej. "Administrador"). */
  nombre: string;
  /** Aplicación a la que pertenece en Odoo (ej. "Ventas"); "Sin aplicación" para los grupos técnicos. */
  categoria: string;
}

export interface UsuarioOdoo {
  id: number;
  /** Nombre y login tal cual figuran en Odoo, para buscarlos ahí con Ctrl+F. */
  nombre: string;
  login: string;
  activo: boolean;
  ultimoLogin: string | null;
  grupoIds: number[];
  /** Nivel de acceso por aplicación, como lo muestra la ficha del usuario en Odoo (solo el más alto de cada una). */
  accesos: Record<string, string[]>;
}

export interface PermisosUsuarios {
  usuarios: UsuarioOdoo[];
  /** Solo los grupos que tiene al menos un usuario listado. */
  grupos: PermisoGrupo[];
  /** Aplicaciones con alguna cuenta con acceso, ordenadas de más a menos usadas. */
  aplicaciones: string[];
}

export const SIN_APLICACION = 'Sin aplicación';

interface UserRow {
  [key: string]: unknown;
  id: number;
  name: string;
  login: string;
  active: boolean;
  login_date: string | false;
  groups_id: number[];
}

interface GroupRow {
  [key: string]: unknown;
  id: number;
  name: string;
  implied_ids: number[];
  category_id: [number, string] | false;
}

/**
 * Usuarios internos de Odoo (no portal/público) con los grupos de acceso que tiene cada uno. Solo lectura:
 * sirve para auditar quién puede qué. Incluye usuarios archivados para ver cuentas dadas de baja con permisos.
 */
export async function getPermisosUsuarios(): Promise<PermisosUsuarios> {
  const users = await searchReadAll<UserRow>({
    model: 'res.users',
    domain: [['share', '=', false], '|', ['active', '=', true], ['active', '=', false]],
    fields: ['name', 'login', 'active', 'login_date', 'groups_id'],
    order: 'name asc',
  });

  const usados = [...new Set(users.flatMap((u) => u.groups_id))];
  const groups = usados.length
    ? await searchReadAll<GroupRow>({
        model: 'res.groups',
        domain: [['id', 'in', usados]],
        fields: ['name', 'category_id', 'implied_ids'],
        order: 'name asc',
      })
    : [];

  const grupos: PermisoGrupo[] = groups.map((g) => ({
    id: g.id,
    nombre: g.name,
    categoria: g.category_id ? g.category_id[1] : SIN_APLICACION,
  }));
  const grupoPorId = new Map(grupos.map((g) => [g.id, g]));

  // Cada grupo "incluye" a otros (implied_ids, transitivo): un usuario con Administrador también tiene Usuario,
  // pero Odoo solo muestra el más alto de cada aplicación. Se descartan los que otro grupo del usuario ya incluye.
  const impliedDe = new Map(groups.map((g) => [g.id, g.implied_ids]));
  const cierre = (id: number, visto = new Set<number>()): Set<number> => {
    for (const hijo of impliedDe.get(id) ?? []) {
      if (!visto.has(hijo)) {
        visto.add(hijo);
        cierre(hijo, visto);
      }
    }
    return visto;
  };
  const cierres = new Map(groups.map((g) => [g.id, cierre(g.id)]));

  const usuarios: UsuarioOdoo[] = users.map((u) => {
    const redundantes = new Set(u.groups_id.flatMap((id) => [...(cierres.get(id) ?? [])]));
    const accesos: Record<string, string[]> = {};
    for (const id of u.groups_id) {
      const g = grupoPorId.get(id);
      if (!g || redundantes.has(id)) continue;
      (accesos[g.categoria] ??= []).push(g.nombre);
    }
    return {
      id: u.id,
      nombre: u.name,
      login: u.login,
      activo: u.active,
      ultimoLogin: u.login_date || null,
      grupoIds: u.groups_id,
      accesos,
    };
  });

  const usoPorApp = new Map<string, number>();
  for (const u of usuarios) for (const app of Object.keys(u.accesos)) usoPorApp.set(app, (usoPorApp.get(app) ?? 0) + 1);
  const aplicaciones = [...usoPorApp.keys()]
    .filter((a) => a !== SIN_APLICACION)
    .sort((a, b) => usoPorApp.get(b)! - usoPorApp.get(a)! || a.localeCompare(b));

  return { usuarios, grupos, aplicaciones };
}

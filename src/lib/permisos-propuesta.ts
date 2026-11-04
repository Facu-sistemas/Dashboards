import type { PermisoGrupo, PermisosUsuarios, UsuarioOdoo } from './odoo/permisos-usuarios';

// Misma constante que lib/odoo/permisos-usuarios.ts: no se importa el valor para no arrastrar el cliente Odoo al navegador.
const SIN_APLICACION = 'Sin aplicación';

/** Niveles altos (Administrador, Gerente, Ajustes...): los que más exponen datos y configuración. */
export function esNivelAlto(nombre: string): boolean {
  return /admin|gerente|manager|responsable|encargado|ajustes|permisos de acceso|derechos de acceso/i.test(nombre);
}

const ES_TECNICO = /caracter[ií]sticas t[eé]cnicas|technical features|modo desarrollador|developer/i;
const ES_CATEGORIA_ADMIN = /administra/i;

export type ReglaId = 'archivadas' | 'admins' | 'tecnicos' | 'inactivas';

export interface ReglaInfo {
  id: ReglaId;
  titulo: string;
  explicacion: string;
  /** Si la regla cambia permisos (true) o solo avisa para revisar (false). */
  modifica: boolean;
}

export const REGLAS: ReglaInfo[] = [
  {
    id: 'archivadas',
    titulo: 'Cuentas archivadas sin permisos',
    explicacion: 'Una cuenta dada de baja no debería conservar ningún grupo: si se reactiva por error, vuelve con todo el acceso.',
    modifica: true,
  },
  {
    id: 'admins',
    titulo: 'Pocos administradores por aplicación',
    explicacion:
      'El nivel Administrador/Gerente puede ver y cambiar todo en esa app. Se deja a los que más usan Odoo (hasta el máximo) y al resto se le baja al nivel inmediato inferior.',
    modifica: true,
  },
  {
    id: 'tecnicos',
    titulo: 'Características técnicas solo para quien administra',
    explicacion: 'Habilitan menús de depuración y de configuración interna. Se dejan solo a quienes siguen con nivel alto en Administración.',
    modifica: true,
  },
  {
    id: 'inactivas',
    titulo: 'Cuentas sin actividad',
    explicacion: 'Una cuenta activa que no ingresa hace meses es una puerta abierta sin dueño. No cambia permisos: te marca cuáles archivar.',
    modifica: false,
  },
];

export interface OpcionesPropuesta {
  reglas: Record<ReglaId, boolean>;
  /** Máximo de administradores que se conservan por cada nivel alto. */
  maxAdmins: number;
  /** Días sin ingresar a partir de los cuales una cuenta activa se marca como inactiva. */
  diasInactividad: number;
  hoy?: Date;
}

export const OPCIONES_POR_DEFECTO: OpcionesPropuesta = {
  reglas: { archivadas: true, admins: true, tecnicos: true, inactivas: true },
  maxAdmins: 2,
  diasInactividad: 90,
};

export interface Cambio {
  usuarioId: number;
  usuario: string;
  login: string;
  /** Aplicación (categoría) del grupo que se modifica. */
  app: string;
  /** Nombre del grupo que se quita, tal cual en Odoo. */
  quitar: string;
  /** Nivel al que se baja, o null si se quita el acceso por completo. */
  poner: string | null;
  regla: ReglaId;
  motivo: string;
}

export interface Aviso {
  usuarioId: number;
  regla: ReglaId;
  texto: string;
}

export interface UsuarioPropuesto extends UsuarioOdoo {
  accesosPropuestos: Record<string, string[]>;
  /** Apps cuyo acceso cambia en la propuesta. */
  appsCambiadas: string[];
  avisos: Aviso[];
}

export interface ConteoGrupo {
  grupo: PermisoGrupo;
  antes: number;
  despues: number;
}

export interface Propuesta {
  usuarios: UsuarioPropuesto[];
  cambios: Cambio[];
  avisos: Aviso[];
  conteos: ConteoGrupo[];
  porRegla: Record<ReglaId, number>;
}

function diasDesde(iso: string | null, hoy: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.replace(' ', 'T') + 'Z');
  return Number.isNaN(t) ? null : Math.floor((hoy.getTime() - t) / 86_400_000);
}

/**
 * Propuesta de mínimo privilegio calculada sobre los permisos reales. Es una sugerencia para revisar y aplicar a mano
 * en Odoo: no escribe nada. No conoce el rol real de cada persona, así que donde hay que elegir a quién dejarle el
 * nivel alto usa un criterio objetivo (quién ingresó más recientemente) y lo explica en cada cambio.
 */
export function proponer(data: PermisosUsuarios, opciones: OpcionesPropuesta): Propuesta {
  const hoy = opciones.hoy ?? new Date();
  const grupoPorId = new Map(data.grupos.map((g) => [g.id, g]));
  const finales = new Map(data.usuarios.map((u) => [u.id, new Set(u.topIds)]));
  const cambios: Cambio[] = [];
  const avisos: Aviso[] = [];

  const registrar = (u: UsuarioOdoo, g: PermisoGrupo, regla: ReglaId, motivo: string, reemplazoId?: number) => {
    const set = finales.get(u.id)!;
    set.delete(g.id);
    const reemplazo = reemplazoId !== undefined ? grupoPorId.get(reemplazoId) : undefined;
    if (reemplazo) set.add(reemplazo.id);
    cambios.push({ usuarioId: u.id, usuario: u.nombre, login: u.login, app: g.categoria, quitar: g.nombre, poner: reemplazo?.nombre ?? null, regla, motivo });
  };

  if (opciones.reglas.archivadas) {
    for (const u of data.usuarios.filter((x) => !x.activo)) {
      for (const id of u.topIds) {
        const g = grupoPorId.get(id);
        if (g) registrar(u, g, 'archivadas', 'Cuenta archivada: no debería conservar permisos.');
      }
    }
  }

  const activos = data.usuarios.filter((u) => u.activo);

  if (opciones.reglas.admins) {
    for (const g of data.grupos.filter((x) => x.categoria !== SIN_APLICACION && esNivelAlto(x.nombre))) {
      const titulares = activos.filter((u) => finales.get(u.id)!.has(g.id));
      if (titulares.length <= opciones.maxAdmins) continue;
      // Se conservan los que ingresaron más recientemente (quienes nunca ingresaron, al final).
      const orden = [...titulares].sort((a, b) => (b.ultimoLogin ?? '').localeCompare(a.ultimoLogin ?? ''));
      const inferior = g.incluye.map((id) => grupoPorId.get(id)).find((x) => x && x.categoria === g.categoria);
      for (const u of orden.slice(opciones.maxAdmins)) {
        registrar(
          u,
          g,
          'admins',
          `${titulares.length} cuentas tienen "${g.nombre}" en ${g.categoria}; se conservan ${opciones.maxAdmins} (las de ingreso más reciente).`,
          inferior?.id
        );
      }
    }
  }

  if (opciones.reglas.tecnicos) {
    for (const u of activos) {
      const set = finales.get(u.id)!;
      const administra = [...set].some((id) => {
        const g = grupoPorId.get(id);
        return g && ES_CATEGORIA_ADMIN.test(g.categoria) && esNivelAlto(g.nombre);
      });
      if (administra) continue;
      for (const id of [...set]) {
        const g = grupoPorId.get(id);
        if (g && ES_TECNICO.test(g.nombre)) {
          registrar(u, g, 'tecnicos', 'No administra Odoo: no necesita menús técnicos ni de depuración.');
        }
      }
    }
  }

  if (opciones.reglas.inactivas) {
    for (const u of activos) {
      const dias = diasDesde(u.ultimoLogin, hoy);
      if (dias === null) {
        avisos.push({ usuarioId: u.id, regla: 'inactivas', texto: 'Nunca ingresó: revisar si hace falta o archivar.' });
      } else if (dias > opciones.diasInactividad) {
        avisos.push({ usuarioId: u.id, regla: 'inactivas', texto: `Sin ingresar hace ${dias} días: revisar o archivar.` });
      }
    }
  }

  const cierre = (ids: Iterable<number>): Set<number> => {
    const visto = new Set<number>();
    const visitar = (id: number) => {
      if (visto.has(id)) return;
      visto.add(id);
      for (const hijo of grupoPorId.get(id)?.incluye ?? []) visitar(hijo);
    };
    for (const id of ids) visitar(id);
    return visto;
  };

  const usuarios: UsuarioPropuesto[] = data.usuarios.map((u) => {
    const accesosPropuestos: Record<string, string[]> = {};
    for (const id of finales.get(u.id)!) {
      const g = grupoPorId.get(id);
      if (g) (accesosPropuestos[g.categoria] ??= []).push(g.nombre);
    }
    const appsCambiadas = [...new Set(cambios.filter((c) => c.usuarioId === u.id).map((c) => c.app))];
    return { ...u, accesosPropuestos, appsCambiadas, avisos: avisos.filter((a) => a.usuarioId === u.id) };
  });

  const despuesPorGrupo = new Map<number, number>();
  for (const u of data.usuarios) {
    for (const id of cierre(finales.get(u.id)!)) despuesPorGrupo.set(id, (despuesPorGrupo.get(id) ?? 0) + 1);
  }
  const conteos: ConteoGrupo[] = data.grupos.map((grupo) => ({
    grupo,
    antes: data.usuarios.filter((u) => u.grupoIds.includes(grupo.id)).length,
    despues: despuesPorGrupo.get(grupo.id) ?? 0,
  }));

  const porRegla = { archivadas: 0, admins: 0, tecnicos: 0, inactivas: avisos.length } as Record<ReglaId, number>;
  for (const c of cambios) porRegla[c.regla]++;

  return { usuarios, cambios, avisos, conteos, porRegla };
}

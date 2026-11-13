import { searchReadAll } from './odoo/client';
import { getFronteraCompany } from './odoo/reference';
import { getArgentinaTodayIso } from './odoo/oee';
import { listJornadas } from './supabase/fichaje-marcas';
import { withTtlCache, cacheKey } from './cache';

/**
 * Productividad = lo que se produjo ÷ horas-hombre presentes.
 *
 *  - Producción: órdenes de fabricación terminadas (Odoo, solo lectura), en «unidades equivalentes»
 *    (`x_studio_unidades_eq`), que es la unidad común entre productos. Los intermedios (PI) valen 0 y no cuentan.
 *  - Horas: del fichador facial (Supabase): por persona y día, primera entrada → última salida. Son horas PRESENTES
 *    (incluyen almuerzo y descansos), no horas efectivamente trabajadas.
 *  - El cruce es por sector: el departamento del empleado en Odoo decide a qué grupo suma sus horas. Producción se
 *    cuenta por familia de producto (Sillón → Living, Colchones → Colchones).
 */

export type GrupoKey = 'living' | 'colchones' | 'espumado' | 'apoyo';
export const GRUPOS: GrupoKey[] = ['living', 'colchones', 'espumado', 'apoyo'];

export interface GrupoDia {
  /** Unidades equivalentes terminadas ese día (0 para los grupos que no terminan producto: espumado, apoyo). */
  ueq: number;
  ordenes: number;
  /** Personas con jornada completa (entrada y salida) ese día. */
  personas: number;
  /** Horas-hombre presentes (suma de las jornadas completas). */
  horas: number;
  /** Personas con entrada sin salida (o jornada fuera de rango): no suman horas. */
  incompletas: number;
  /** Detalle para ver de dónde sale el número: [nombre, horas]. */
  gente: [string, number][];
  /** Lo producido: [producto, ueq], los más grandes primero. */
  productos: [string, number][];
}

export interface DiaProductividad {
  dia: string;
  /** Hoy: la jornada todavía no terminó, no entra en los promedios. */
  enCurso: boolean;
  grupos: Record<GrupoKey, GrupoDia>;
}

export interface ProductividadResult {
  desde: string;
  hasta: string;
  dias: DiaProductividad[];
  /** Dotación activa en Odoo por grupo (para comparar con cuántos fichan). */
  dotacion: Record<GrupoKey, number>;
  /** Personas con fichadas que no figuran en un departamento de producción (no suman a ningún grupo). */
  fueraDeProduccion: number;
  /** Máquinas (Mantenimiento de Odoo) con su operador asignado y si vino. */
  maquinas: MaquinaCobertura[];
  /** Días en que la planta trabajó (fichó bastante gente): sirven de denominador para «días presente». */
  diasDeTrabajo: string[];
}

export interface MaquinaCobertura {
  codigo: string;
  nombre: string;
  operador: string;
  /** Días de trabajo del período en que el operador fichó entrada. */
  diasPresente: number;
  /** null si hoy todavía no es día de trabajo (nadie fichó). */
  hoyPresente: boolean | null;
  /** Último día en que el operador fichó, si hay. */
  ultimoDia: string | null;
}

const HORAS_MIN = 1;
const HORAS_MAX = 14;
const TTL_MS = 60_000;
const OFFSET_AR_H = 3;

function grupoDeDepartamento(nombre: string | null): GrupoKey | null {
  if (!nombre) return null;
  const n = nombre.toUpperCase();
  if (!n.includes('PRODUCCION')) return null;
  if (n.includes('LIVING')) return 'living';
  if (n.includes('COLCHONES')) return 'colchones';
  if (n.includes('ESPUMADO')) return 'espumado';
  return 'apoyo'; // PRODUCCION a secas, almacén, mantenimiento
}

function grupoDeCategoria(categ: string | null): 'living' | 'colchones' | null {
  if (!categ) return null;
  const c = categ.toLowerCase();
  if (c.startsWith('sillon') || c.startsWith('sillón')) return 'living';
  if (c.startsWith('colchones')) return 'colchones';
  return null;
}

/** Odoo guarda UTC ("YYYY-MM-DD HH:MM:SS"); el día de fábrica es el de Argentina. */
function diaArgentina(odooUtc: string): string {
  const d = new Date(`${odooUtc.replace(' ', 'T')}Z`);
  return new Date(d.getTime() - OFFSET_AR_H * 3600_000).toISOString().slice(0, 10);
}

function grupoVacio(): GrupoDia {
  return { ueq: 0, ordenes: 0, personas: 0, horas: 0, incompletas: 0, gente: [], productos: [] };
}

function diaVacio(dia: string, hoy: string): DiaProductividad {
  return { dia, enCurso: dia === hoy, grupos: { living: grupoVacio(), colchones: grupoVacio(), espumado: grupoVacio(), apoyo: grupoVacio() } };
}

type EmpleadoRow = { id: number; department_id: [number, string] | false };
type EquipoRow = { name: string; employee_id: [number, string] | false; x_studio_cdigo: string | false };
type MoRow = {
  date_finished: string;
  x_studio_unidades_eq: number;
  x_studio_categoria_producto_r: [number, string] | false;
  product_id: [number, string];
};

export async function getProductividadHoras(diasAtras: number): Promise<ProductividadResult> {
  const hoy = getArgentinaTodayIso();
  return withTtlCache(cacheKey('productividad-horas', { hoy, diasAtras }), TTL_MS, async () => {
    const desde = new Date(Date.parse(`${hoy}T00:00:00Z`) - diasAtras * 86_400_000).toISOString().slice(0, 10);
    const { companyId } = await getFronteraCompany();

    const [empleados, equipos, ordenes, jornadas] = await Promise.all([
      searchReadAll<EmpleadoRow>({ model: 'hr.employee', domain: [['active', '=', true]], fields: ['department_id'] }),
      // Herramientas neumáticas (NEU-) y equipos sin operador no interesan: son decenas de pistolas sin dueño fijo.
      searchReadAll<EquipoRow>({
        model: 'maintenance.equipment',
        domain: [['active', '=', true], ['employee_id', '!=', false]],
        fields: ['name', 'employee_id', 'x_studio_cdigo'],
        order: 'name asc',
      }),
      searchReadAll<MoRow>({
        model: 'mrp.production',
        domain: [
          ['state', '=', 'done'],
          ['company_id', '=', companyId],
          ['x_studio_unidades_eq', '>', 0],
          ['date_finished', '>=', `${desde} ${String(OFFSET_AR_H).padStart(2, '0')}:00:00`],
        ],
        fields: ['date_finished', 'x_studio_unidades_eq', 'x_studio_categoria_producto_r', 'product_id'],
      }),
      listJornadas(diasAtras + 1),
    ]);

    const grupoDe = new Map<number, GrupoKey | null>();
    const dotacion: Record<GrupoKey, number> = { living: 0, colchones: 0, espumado: 0, apoyo: 0 };
    for (const e of empleados) {
      const g = grupoDeDepartamento(e.department_id ? e.department_id[1] : null);
      grupoDe.set(e.id, g);
      if (g) dotacion[g] += 1;
    }

    const porDia = new Map<string, DiaProductividad>();
    const dia = (d: string) => {
      let v = porDia.get(d);
      if (!v) porDia.set(d, (v = diaVacio(d, hoy)));
      return v;
    };

    // Producción por día y familia.
    const productosDia = new Map<string, Map<string, number>>();
    for (const o of ordenes) {
      const g = grupoDeCategoria(o.x_studio_categoria_producto_r ? o.x_studio_categoria_producto_r[1] : null);
      if (!g) continue;
      const d = diaArgentina(o.date_finished);
      if (d < desde || d > hoy) continue;
      const celda = dia(d).grupos[g];
      celda.ueq += o.x_studio_unidades_eq;
      celda.ordenes += 1;
      const clave = `${d}|${g}`;
      const m = productosDia.get(clave) ?? new Map<string, number>();
      m.set(o.product_id[1], (m.get(o.product_id[1]) ?? 0) + o.x_studio_unidades_eq);
      productosDia.set(clave, m);
    }
    for (const [clave, m] of productosDia) {
      const [d, g] = clave.split('|') as [string, GrupoKey];
      dia(d).grupos[g].productos = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, v]) => [n, Math.round(v * 10) / 10]);
    }

    // Horas por día y sector según el departamento de cada persona.
    const sinDepto = new Set<number>();
    for (const j of jornadas) {
      if (j.dia < desde || j.dia > hoy) continue;
      const g = grupoDe.get(j.empleadoId) ?? null;
      if (!g) {
        sinDepto.add(j.empleadoId);
        continue;
      }
      const celda = dia(j.dia).grupos[g];
      const horas = j.entrada !== null && j.salida !== null ? (j.salida - j.entrada) / 60 : null;
      if (horas === null || horas < HORAS_MIN || horas > HORAS_MAX) {
        celda.incompletas += 1;
        continue;
      }
      celda.personas += 1;
      celda.horas += horas;
      celda.gente.push([j.empleadoNombre, Math.round(horas * 100) / 100]);
    }

    const dias = [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
    for (const d of dias) {
      for (const g of GRUPOS) {
        const c = d.grupos[g];
        c.ueq = Math.round(c.ueq * 100) / 100;
        c.horas = Math.round(c.horas * 100) / 100;
        c.gente.sort((a, b) => a[0].localeCompare(b[0], 'es'));
      }
    }

    // Cobertura de máquinas: ¿el operador asignado en Mantenimiento vino? Un día cuenta como «de trabajo» si fichó bastante gente.
    const presentesPorDia = new Map<string, Set<number>>();
    for (const j of jornadas) {
      if (j.dia < desde || j.dia > hoy || j.entrada === null) continue;
      const s = presentesPorDia.get(j.dia) ?? new Set<number>();
      s.add(j.empleadoId);
      presentesPorDia.set(j.dia, s);
    }
    const diasDeTrabajo = [...presentesPorDia.entries()].filter(([, s]) => s.size >= 20).map(([d]) => d).sort();
    const hoyEsDeTrabajo = diasDeTrabajo.includes(hoy);
    const maquinas: MaquinaCobertura[] = [];
    for (const e of equipos) {
      if (!e.employee_id) continue;
      // El código (COM-005, COS-021…) está en un campo propio; el nombre a veces lo repite al principio.
      const codigo = (e.x_studio_cdigo || e.name.match(/^\s*([A-Z]{3}-\d{3})/)?.[1] || '').trim();
      if (codigo.startsWith('NEU-')) continue;
      const [empId, operador] = e.employee_id;
      if (codigo && maquinas.some((x) => x.codigo === codigo && x.operador === operador)) continue; // equipo cargado dos veces en Odoo
      const presentes = diasDeTrabajo.filter((d) => presentesPorDia.get(d)?.has(empId));
      maquinas.push({
        codigo,
        nombre: e.name.replace(/^\s*[A-Z]{3}-\d{3}/, '').replace(/\s+/g, ' ').trim(),
        operador,
        diasPresente: presentes.length,
        hoyPresente: hoyEsDeTrabajo ? Boolean(presentesPorDia.get(hoy)?.has(empId)) : null,
        ultimoDia: presentes.at(-1) ?? null,
      });
    }

    return { desde, hasta: hoy, dias, dotacion, fueraDeProduccion: sinDepto.size, maquinas, diasDeTrabajo };
  });
}

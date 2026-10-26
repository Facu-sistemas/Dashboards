import { getRrhhQuincena, type QuincenaEmpleadoRow, type RrhhQuincenaResult } from './odoo/rrhh-quincena';
import { claveNombre, fetchSheetTable, legajoNumero, num, round2 } from './rrhh-sheet';

/**
 * Cruce entre la `BASE RELOJ FICHADOR` del Google Sheet de liquidación (exportación del CrossCheck, la
 * fuente que hoy se usa para liquidar) y lo que dice Odoo para el mismo período. Es la comparación del
 * "paralelo": mismo empleado, mismo tipo de incidencia, ¿mismas horas? La planilla es pública
 * ("cualquiera con el enlace") y se lee por el export CSV de Google, sin credenciales; solo lectura.
 */

const SHEET_TAB = 'BASE RELOJ FICHADOR';
// Fila 4 = encabezados (las 3 de arriba son totales). La columna "control" (AI) trae la suma que la planilla espera que cierre.
const SHEET_RANGE = 'A4:AI1000';

/** Horas de un día completo para liquidación (ver rrhh-quincena.ts). */
const HORAS_DIA = 8.8;
const TOLERANCIA_HS = 0.1;

/**
 * Columna de incidencia del reloj → tipo de ausencia de Odoo. `diaCompleto`: se carga siempre en días
 * (múltiplos de 8,80 hs según el instructivo); el resto puede venir en horas sueltas.
 */
const INCIDENCIAS: { col: string; odoo: string | null; diaCompleto: boolean }[] = [
  { col: 'Accidente', odoo: 'Accidente', diaCompleto: true },
  { col: 'Tramite', odoo: 'Tramite', diaCompleto: false },
  { col: 'Enfermedad', odoo: 'Baja por enfermedad', diaCompleto: true },
  { col: 'Vacaciones', odoo: 'Vacaciones', diaCompleto: true },
  { col: 'Matrimonio', odoo: 'Matrimonio', diaCompleto: true },
  { col: 'Exam. Prenupcial', odoo: null, diaCompleto: true },
  { col: 'Nacimiento', odoo: null, diaCompleto: true },
  { col: 'Fallecimiento', odoo: 'Fallecimiento', diaCompleto: true },
  { col: 'Mudanza', odoo: 'Mudanza', diaCompleto: true },
  { col: 'Estudio', odoo: 'Estudio', diaCompleto: false },
  { col: 'Donación Sangre', odoo: 'Donación de sangre', diaCompleto: true },
  { col: 'Bombero', odoo: 'Bombero', diaCompleto: false },
  { col: 'Permiso Gremial', odoo: 'Permiso gremial', diaCompleto: false },
  { col: 'Lactancia', odoo: 'Lactancia', diaCompleto: false },
  { col: 'Casamiento Hijo', odoo: null, diaCompleto: true },
  { col: 'Día CCT', odoo: 'Dia convenio', diaCompleto: true },
  { col: 'Banco de horas', odoo: 'Banco de horas', diaCompleto: false },
  { col: 'Lic x Maternidad', odoo: 'Licencia por maternidad', diaCompleto: true },
  { col: 'Injustificadas', odoo: null, diaCompleto: true },
];

export type CruceAlertaTipo = 'multiplo' | 'control' | 'vacaciones-injustificadas' | 'sin-match';

export interface CruceAlerta {
  tipo: CruceAlertaTipo;
  detalle: string;
}

export interface CruceTipoRow {
  /** Nombre en el reloj (o en Odoo si el tipo solo existe en Odoo). */
  tipo: string;
  relojHs: number;
  odooHs: number;
  dif: number;
}

export interface CruceEmpleadoRow {
  legajo: string | null;
  nombre: string;
  departamento: string | null;
  enReloj: boolean;
  enOdoo: boolean;
  matchPor: 'legajo' | 'nombre' | null;
  relojDias: number | null;
  relojTrabajadasHs: number | null;
  relojExtraHs: number | null;
  relojControl: number | null;
  relojIncidenciasHs: number;
  odooIncidenciasHs: number;
  difHs: number;
  coincide: boolean;
  tipos: CruceTipoRow[];
  alertas: CruceAlerta[];
}

export interface CruceTipoTotal extends CruceTipoRow {
  /** Empleados donde ese tipo no coincide entre reloj y Odoo. */
  empleadosConDif: number;
}

export interface RrhhCruceResult {
  generatedAt: string;
  desde: string;
  hasta: string;
  /** Días laborables que declara el reloj (el más repetido) y los que calcula Odoo para el rango (hábiles − feriados). */
  diasReloj: number | null;
  diasOdoo: number;
  totales: {
    enReloj: number;
    enOdoo: number;
    cruzados: number;
    soloReloj: number;
    soloOdoo: number;
    coinciden: number;
    conDiferencias: number;
    coincidenciaPct: number | null;
    relojIncidenciasHs: number;
    odooIncidenciasHs: number;
    difAbsolutaHs: number;
    conAlertas: number;
  };
  porTipo: CruceTipoTotal[];
  rows: CruceEmpleadoRow[];
}

type SheetRow = {
  legajo: string;
  nombre: string;
  departamento: string;
  dias: number;
  trabajadas: number;
  extra: number;
  control: number;
  incidencias: Map<string, number>;
};

async function leerReloj(): Promise<SheetRow[]> {
  const table = await fetchSheetTable(SHEET_TAB, SHEET_RANGE);
  const header = table[0] ?? [];
  const idx = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const col = {
    depto: idx('Departamento'),
    legajo: idx('ID de usuario'),
    nombre: idx('Nombre'),
    dias: idx('Laborales [Días]'),
    trabajadas: idx('Tiempo trabajado [Horas]'),
    extra: idx('Tiempo extra [Horas]'),
    control: header.length - 1,
  };
  if (col.legajo < 0 || col.nombre < 0) throw new Error('La pestaña "BASE RELOJ FICHADOR" no tiene las columnas esperadas (ID de usuario, Nombre).');
  const incCols = INCIDENCIAS.map((i) => ({ ...i, at: idx(i.col) }));

  const rows: SheetRow[] = [];
  for (const r of table.slice(1)) {
    const nombre = (r[col.nombre] ?? '').trim();
    const legajo = (r[col.legajo] ?? '').trim();
    if (!nombre || !legajo) continue;
    rows.push({
      legajo,
      nombre,
      departamento: (r[col.depto] ?? '').trim(),
      dias: num(r[col.dias]),
      trabajadas: num(r[col.trabajadas]),
      extra: num(r[col.extra]),
      control: num(r[col.control]),
      incidencias: new Map(incCols.map((i) => [i.col, i.at >= 0 ? num(r[i.at]) : 0])),
    });
  }
  return rows;
}

function esMultiploDeDia(hs: number): boolean {
  const resto = hs % HORAS_DIA;
  return Math.min(resto, HORAS_DIA - resto) < 0.05;
}

function moda(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) if (v > 0) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export async function getRrhhCruceReloj(desde: string, hasta: string): Promise<RrhhCruceResult> {
  const [odoo, reloj] = await Promise.all([getRrhhQuincena(desde, hasta), leerReloj()]);
  return armarCruce(odoo, reloj);
}

function armarCruce(odoo: RrhhQuincenaResult, reloj: SheetRow[]): RrhhCruceResult {
  const odooPorLegajo = new Map<number, QuincenaEmpleadoRow>();
  const odooPorNombre = new Map<string, QuincenaEmpleadoRow>();
  for (const e of odoo.rows) {
    const n = legajoNumero(e.legajo);
    if (n !== null) odooPorLegajo.set(n, e);
    odooPorNombre.set(claveNombre(e.nombre), e);
  }

  const usados = new Set<number>();
  const rows: CruceEmpleadoRow[] = [];

  for (const r of reloj) {
    let e = odooPorLegajo.get(Number(r.legajo));
    let matchPor: 'legajo' | 'nombre' | null = e ? 'legajo' : null;
    if (!e) {
      e = odooPorNombre.get(claveNombre(r.nombre));
      if (e) matchPor = 'nombre';
    }
    if (e) usados.add(e.id);

    const tipos: CruceTipoRow[] = [];
    const odooPorTipo = new Map(e?.porTipo.map((t) => [t.tipo, t.horas]) ?? []);
    const odooUsados = new Set<string>();
    for (const inc of INCIDENCIAS) {
      const relojHs = r.incidencias.get(inc.col) ?? 0;
      const odooHs = inc.odoo ? (odooPorTipo.get(inc.odoo) ?? 0) : 0;
      if (inc.odoo) odooUsados.add(inc.odoo);
      if (relojHs === 0 && odooHs === 0) continue;
      tipos.push({ tipo: inc.col, relojHs: round2(relojHs), odooHs: round2(odooHs), dif: round2(odooHs - relojHs) });
    }
    // Tipos que Odoo tiene y la planilla del reloj no tiene como columna (ej. Días compensatorios).
    for (const [tipo, horas] of odooPorTipo) {
      if (!odooUsados.has(tipo)) tipos.push({ tipo: `${tipo} (solo Odoo)`, relojHs: 0, odooHs: horas, dif: horas });
    }

    const alertas: CruceAlerta[] = [];
    if (!e) alertas.push({ tipo: 'sin-match', detalle: 'No se encontró este legajo ni este nombre entre los empleados activos de Odoo.' });
    for (const inc of INCIDENCIAS) {
      const hs = r.incidencias.get(inc.col) ?? 0;
      if (inc.diaCompleto && hs > 0 && !esMultiploDeDia(hs)) {
        alertas.push({ tipo: 'multiplo', detalle: `${inc.col}: ${round2(hs)} hs no es múltiplo de ${HORAS_DIA} hs (1 día = 8,80; 2 = 17,60; 5 = 44,00).` });
      }
    }
    const esperado = r.dias * HORAS_DIA;
    if (r.dias > 0 && Math.abs(r.control - esperado) > 0.25) {
      alertas.push({ tipo: 'control', detalle: `La columna de control del reloj suma ${round2(r.control)} hs y debería dar ${round2(esperado)} hs (${r.dias} días × 8,80).` });
    }
    const injust = r.incidencias.get('Injustificadas') ?? 0;
    const vacOdoo = odooPorTipo.get('Vacaciones') ?? 0;
    const vacReloj = r.incidencias.get('Vacaciones') ?? 0;
    if (injust > 0 && vacOdoo > vacReloj + TOLERANCIA_HS) {
      alertas.push({
        tipo: 'vacaciones-injustificadas',
        detalle: `Odoo tiene ${round2(vacOdoo)} hs de vacaciones y el reloj ${round2(vacReloj)} hs, con ${round2(injust)} hs de injustificadas: puede ser vacación cargada como falta.`,
      });
    }

    const relojInc = tipos.reduce((s, t) => s + t.relojHs, 0);
    const odooInc = tipos.reduce((s, t) => s + t.odooHs, 0);
    rows.push({
      legajo: r.legajo,
      nombre: e?.nombre ?? r.nombre,
      departamento: e?.departamento ?? (r.departamento || null),
      enReloj: true,
      enOdoo: Boolean(e),
      matchPor,
      relojDias: r.dias,
      relojTrabajadasHs: r.trabajadas,
      relojExtraHs: r.extra,
      relojControl: r.control,
      relojIncidenciasHs: round2(relojInc),
      odooIncidenciasHs: round2(odooInc),
      difHs: round2(odooInc - relojInc),
      coincide: Boolean(e) && tipos.every((t) => Math.abs(t.dif) <= TOLERANCIA_HS),
      tipos,
      alertas,
    });
  }

  // Empleados de Odoo que no están en la planilla del reloj (ej. fuera de convenio, que no ficha en el CrossCheck).
  for (const e of odoo.rows) {
    if (usados.has(e.id)) continue;
    rows.push({
      legajo: e.legajo,
      nombre: e.nombre,
      departamento: e.departamento,
      enReloj: false,
      enOdoo: true,
      matchPor: null,
      relojDias: null,
      relojTrabajadasHs: null,
      relojExtraHs: null,
      relojControl: null,
      relojIncidenciasHs: 0,
      odooIncidenciasHs: e.tiempoPersonalHs,
      difHs: e.tiempoPersonalHs,
      coincide: false,
      tipos: e.porTipo.map((t) => ({ tipo: `${t.tipo} (solo Odoo)`, relojHs: 0, odooHs: t.horas, dif: t.horas })),
      alertas: [],
    });
  }

  const cruzados = rows.filter((r) => r.enReloj && r.enOdoo);
  const coinciden = cruzados.filter((r) => r.coincide).length;
  const peso = (r: CruceEmpleadoRow) => (!r.enReloj ? 3 : !r.enOdoo ? 0 : !r.coincide ? 1 : r.alertas.length > 0 ? 2 : 4);
  rows.sort((a, b) => peso(a) - peso(b) || Math.abs(b.difHs) - Math.abs(a.difHs) || a.nombre.localeCompare(b.nombre, 'es'));

  const tipoTotales = new Map<string, CruceTipoTotal>();
  for (const r of cruzados) {
    for (const t of r.tipos) {
      const acc = tipoTotales.get(t.tipo) ?? { tipo: t.tipo, relojHs: 0, odooHs: 0, dif: 0, empleadosConDif: 0 };
      acc.relojHs += t.relojHs;
      acc.odooHs += t.odooHs;
      if (Math.abs(t.dif) > TOLERANCIA_HS) acc.empleadosConDif += 1;
      tipoTotales.set(t.tipo, acc);
    }
  }
  const porTipo = [...tipoTotales.values()]
    .map((t) => ({ ...t, relojHs: round2(t.relojHs), odooHs: round2(t.odooHs), dif: round2(t.odooHs - t.relojHs) }))
    .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif) || b.relojHs + b.odooHs - (a.relojHs + a.odooHs));

  return {
    generatedAt: odoo.generatedAt,
    desde: odoo.desde,
    hasta: odoo.hasta,
    diasReloj: moda(reloj.map((r) => r.dias)),
    diasOdoo: odoo.diasHabiles - odoo.feriados.length,
    totales: {
      enReloj: reloj.length,
      enOdoo: odoo.rows.length,
      cruzados: cruzados.length,
      soloReloj: rows.filter((r) => r.enReloj && !r.enOdoo).length,
      soloOdoo: rows.filter((r) => !r.enReloj).length,
      coinciden,
      conDiferencias: cruzados.length - coinciden,
      coincidenciaPct: cruzados.length > 0 ? coinciden / cruzados.length : null,
      relojIncidenciasHs: round2(cruzados.reduce((s, r) => s + r.relojIncidenciasHs, 0)),
      odooIncidenciasHs: round2(cruzados.reduce((s, r) => s + r.odooIncidenciasHs, 0)),
      difAbsolutaHs: round2(cruzados.reduce((s, r) => s + Math.abs(r.difHs), 0)),
      conAlertas: rows.filter((r) => r.alertas.length > 0).length,
    },
    porTipo,
    rows,
  };
}

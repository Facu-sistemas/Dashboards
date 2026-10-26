import { getRrhhQuincena, type QuincenaEmpleadoRow } from './odoo/rrhh-quincena';
import { claveNombre, fetchSheetTable, legajoNumero, num, round2 } from './rrhh-sheet';

/**
 * Planilla de cálculo quincenal (la `PLANILLA DE CALCULO 2Q` del Google Sheet de liquidación) armada con
 * "Odoo calcula, Excel audita": las horas normales, las incidencias y las vacaciones salen de las licencias
 * aprobadas en Odoo en vez de la BASE RELOJ FICHADOR. De la planilla de Google se toma lo que no está en Odoo:
 * la nómina (legajo, tipo de liquidación, convenio), las horas extras definidas por RRHH (BASE HORAS EXTRAS,
 * columna de criterio) y los anticipos y guarderías (BASE ANT + GUARDERIA). Las reglas son las del instructivo.
 */

/** Horas de un día completo para liquidación (ver rrhh-quincena.ts). */
const HORAS_DIA = 8.8;
const TOLERANCIA_HS = 0.1;

/**
 * Columnas de incidencias de la planilla (K..Y, más Vacaciones en Z), en el mismo orden. `odoo`: tipo de
 * ausencia de Odoo que alimenta la columna (null: Odoo no tiene ese tipo); `codigo`: código de INFOCOR en la
 * solapa EXPORTA (null: la solapa no lo tiene, hay que definirlo con RRHH).
 */
export const COLUMNAS_INCIDENCIA: { key: string; label: string; odoo: string | null; codigo: number | null }[] = [
  { key: 'accidente', label: 'Accidente', odoo: 'Accidente', codigo: 6 },
  { key: 'tramite', label: 'Trámite', odoo: 'Tramite', codigo: 29 },
  { key: 'enfermedad', label: 'Enfermedad', odoo: 'Baja por enfermedad', codigo: 3 },
  { key: 'matrimonio', label: 'Matrimonio', odoo: 'Matrimonio', codigo: 21 },
  { key: 'prenupcial', label: 'Exam. Prenupcial', odoo: null, codigo: 27 },
  { key: 'nacimiento', label: 'Nacimiento', odoo: null, codigo: 22 },
  { key: 'fallecimiento', label: 'Fallecimiento', odoo: 'Fallecimiento', codigo: 23 },
  { key: 'mudanza', label: 'Mudanza', odoo: 'Mudanza', codigo: 24 },
  { key: 'estudio', label: 'Estudio', odoo: 'Estudio', codigo: 25 },
  { key: 'sangre', label: 'Donación sangre', odoo: 'Donación de sangre', codigo: 26 },
  { key: 'bombero', label: 'Bombero', odoo: 'Bombero', codigo: null },
  { key: 'gremial', label: 'Permiso gremial', odoo: 'Permiso gremial', codigo: 28 },
  { key: 'lactancia', label: 'Lactancia', odoo: 'Lactancia', codigo: 30 },
  { key: 'casamientoHijo', label: 'Casamiento hijo', odoo: null, codigo: null },
  { key: 'diaCct', label: 'Día CCT', odoo: 'Dia convenio', codigo: null },
  { key: 'vacaciones', label: 'Vacaciones hábiles', odoo: 'Vacaciones', codigo: 5 },
];

/**
 * Tipos de Odoo que NO se descuentan de las horas normales: la planilla los suma a HS NORMALES (el reloj
 * suma el banco de horas a "tiempo trabajado"). Los Días compensatorios se tratan igual — a confirmar con
 * RRHH, porque el reloj no tiene columna para ellos.
 */
const TIPOS_PAGOS_COMO_NORMALES = ['Banco de horas', 'Días compensatorios', 'Tiempo personal pagado', 'Horas extra'];
const TIPO_SIN_GOCE = 'Permisos sin pagar';

const CODIGO = { normales: 1, extras50: 15, presentismo: 11, refrigerio: 40 };

export type PlanillaAlertaNivel = 'error' | 'aviso';

export interface PlanillaAlerta {
  nivel: PlanillaAlertaNivel;
  detalle: string;
}

export interface PlanillaRow {
  legajo: number;
  nombre: string;
  centroCosto: string;
  tipoLiquidacion: string;
  convenio: string;
  enOdoo: boolean;
  /** TOTAL HS QUINC. */
  totalHs: number;
  feriadosHs: number;
  extrasHs: number;
  normalesHs: number;
  incidencias: Record<string, number>;
  /** Licencias de Odoo que la planilla no tiene como columna (ej. maternidad). */
  otrasHs: number;
  /** Permisos sin pagar: lo que en la planilla aparece como diferencia de horas (injustificadas). */
  sinGoceHs: number;
  /** null: el convenio no tiene presentismo en esta planilla. */
  presentismo: number | null;
  presentismoNota: string;
  /** null: no corresponde (solo SOIVA). */
  viaticoDias: number | null;
  sabDomDias: number;
  diasVacaciones: number;
  anticipos: number;
  guarderia: number;
  alertas: PlanillaAlerta[];
}

export interface PlanillaExportaRow {
  legajo: number;
  codigo: number;
  valor: number;
}

export interface RrhhPlanillaResult {
  generatedAt: string;
  desde: string;
  hasta: string;
  diasHabiles: number;
  feriados: string[];
  columnas: { key: string; label: string; codigo: number | null }[];
  totales: {
    empleados: number;
    enOdoo: number;
    totalHs: number;
    feriadosHs: number;
    extrasHs: number;
    normalesHs: number;
    incidenciasHs: number;
    sinGoceHs: number;
    anticipos: number;
    guarderia: number;
    conErrores: number;
    conAvisos: number;
  };
  rows: PlanillaRow[];
  exporta: PlanillaExportaRow[];
}

type NominaRow = { legajo: number; nombre: string; centroCosto: string; tipoLiquidacion: string; convenio: string };

async function leerNomina(): Promise<NominaRow[]> {
  // Fila 5 = encabezados de la PLANILLA DE CALCULO 2Q; las 4 de arriba son parámetros y totales.
  const table = await fetchSheetTable('PLANILLA DE CALCULO 2Q ', 'A5:F1200');
  const out: NominaRow[] = [];
  for (const r of table.slice(1)) {
    const legajo = Number((r[0] ?? '').trim());
    const nombre = (r[1] ?? '').trim();
    if (!nombre || !Number.isFinite(legajo) || legajo <= 0) continue;
    out.push({ legajo, nombre, centroCosto: (r[2] ?? '').trim(), tipoLiquidacion: (r[4] ?? '').trim(), convenio: (r[5] ?? '').trim().toUpperCase() });
  }
  return out;
}

/** Horas extras definidas por RRHH: columna "CRITERIO A DEFINIR / RESULTADO AUDITADO" de BASE HORAS EXTRAS. */
async function leerExtras(): Promise<{ porLegajo: Map<number, number>; porNombre: Map<string, number> }> {
  const table = await fetchSheetTable('BASE HORAS EXTRAS', 'A1:AK1000');
  const header = table[0] ?? [];
  const at = header.findIndex((h) => h.trim().toUpperCase().startsWith('CRITERIO'));
  const porLegajo = new Map<number, number>();
  const porNombre = new Map<string, number>();
  if (at < 0) throw new Error('En BASE HORAS EXTRAS no encontré la columna "CRITERIO A DEFINIR".');
  for (const r of table.slice(1)) {
    const nombre = (r[1] ?? '').trim();
    if (!nombre) continue;
    const hs = num(r[at]);
    const legajo = Number((r[0] ?? '').trim());
    if (Number.isFinite(legajo) && legajo > 0) porLegajo.set(legajo, (porLegajo.get(legajo) ?? 0) + hs);
    else porNombre.set(claveNombre(nombre), (porNombre.get(claveNombre(nombre)) ?? 0) + hs);
  }
  return { porLegajo, porNombre };
}

/** Anticipos (NETO A COBRAR) y subsidio de guardería por nombre. */
async function leerAnticiposYGuarderia(): Promise<{ anticipos: Map<string, number>; guarderia: Map<string, number> }> {
  const [ant, gua] = await Promise.all([fetchSheetTable('BASE ANT + GUARDERIA', 'A3:C1000'), fetchSheetTable('BASE ANT + GUARDERIA', 'E1:F1000')]);
  const anticipos = new Map<string, number>();
  for (const r of ant.slice(1)) {
    const nombre = (r[0] ?? '').trim();
    if (nombre) anticipos.set(claveNombre(nombre), (anticipos.get(claveNombre(nombre)) ?? 0) + num(r[2]));
  }
  const guarderia = new Map<string, number>();
  for (const r of gua.slice(1)) {
    const nombre = (r[0] ?? '').trim();
    if (nombre) guarderia.set(claveNombre(nombre), (guarderia.get(claveNombre(nombre)) ?? 0) + num(r[1]));
  }
  return { anticipos, guarderia };
}

function presentismoDe(convenio: string, e: QuincenaEmpleadoRow | undefined, ausenteDias: number, diasLaborables: number): { valor: number | null; nota: string } {
  if (convenio === 'SOIVA') {
    // Las vacaciones no descuentan (instructivo). Tardanzas y salidas anticipadas necesitan fichadas reales: todavía no entran.
    const valor = ausenteDias > 0 ? Math.max(0, 20 - 3 * ausenteDias) : 25;
    const nota = ausenteDias > 0 ? `20 − 3 × ${round2(ausenteDias)} día(s) ausente(s)` : '25 sin ausencias';
    return { valor, nota: `${nota}; sin tardanzas ni salidas anticipadas (faltan fichadas)` };
  }
  if (convenio === 'MADEREROS') {
    // 10 = asistencia normal (1 en EXPORTA); solo las faltas injustificadas restan, en proporción.
    const faltas = e ? e.porTipo.find((t) => t.tipo === TIPO_SIN_GOCE)?.horas ?? 0 : 0;
    const diasFalta = faltas / HORAS_DIA;
    const valor = diasLaborables > 0 ? Math.max(0, 10 * (1 - diasFalta / diasLaborables)) : 10;
    return { valor: round2(valor), nota: diasFalta > 0 ? `10 con quita proporcional por ${round2(diasFalta)} día(s) sin goce` : '10 sin faltas injustificadas' };
  }
  return { valor: null, nota: 'Este convenio no lleva presentismo en la planilla' };
}

export async function getRrhhPlanilla(desde: string, hasta: string): Promise<RrhhPlanillaResult> {
  const [odoo, nomina, extras, ant] = await Promise.all([getRrhhQuincena(desde, hasta), leerNomina(), leerExtras(), leerAnticiposYGuarderia()]);

  const odooPorLegajo = new Map<number, QuincenaEmpleadoRow>();
  const odooPorNombre = new Map<string, QuincenaEmpleadoRow>();
  for (const e of odoo.rows) {
    const n = legajoNumero(e.legajo);
    if (n !== null) odooPorLegajo.set(n, e);
    odooPorNombre.set(claveNombre(e.nombre), e);
  }
  const diasLaborables = odoo.diasHabiles - odoo.feriados.length;

  const rows: PlanillaRow[] = nomina.map((n) => {
    const clave = claveNombre(n.nombre);
    const e = odooPorLegajo.get(n.legajo) ?? odooPorNombre.get(clave);

    const totalHs = e?.horasEsperadas ?? odoo.diasHabiles * HORAS_DIA;
    const feriadosHs = e?.feriadosHs ?? odoo.feriados.length * HORAS_DIA;
    const horasDe = (tipo: string) => e?.porTipo.find((t) => t.tipo === tipo)?.horas ?? 0;

    const incidencias: Record<string, number> = {};
    const tiposConColumna = new Set<string>();
    for (const c of COLUMNAS_INCIDENCIA) {
      incidencias[c.key] = c.odoo ? round2(horasDe(c.odoo)) : 0;
      if (c.odoo) tiposConColumna.add(c.odoo);
    }
    const sinGoceHs = horasDe(TIPO_SIN_GOCE);
    const otrasHs = (e?.porTipo ?? []).filter((t) => !tiposConColumna.has(t.tipo) && !TIPOS_PAGOS_COMO_NORMALES.includes(t.tipo) && t.tipo !== TIPO_SIN_GOCE).reduce((s, t) => s + t.horas, 0);
    const incidenciasHs = Object.values(incidencias).reduce((s, v) => s + v, 0);

    // HS NORMALES = lo que queda de la jornada sin feriados, incidencias, vacaciones ni permisos sin goce.
    const normalesHs = Math.max(0, totalHs - feriadosHs - incidenciasHs - otrasHs - sinGoceHs);

    const ausenteDias = ((incidencias.enfermedad ?? 0) + (incidencias.accidente ?? 0) + sinGoceHs) / HORAS_DIA;
    const pres = presentismoDe(n.convenio, e, ausenteDias, diasLaborables);

    const vacHs = incidencias.vacaciones ?? 0;
    // Código 40: base de la quincena; las carpetas médicas (3 y 6) SÍ pagan; solo restan vacaciones y faltas injustificadas.
    const viaticoDias = n.convenio === 'SOIVA' ? Math.max(0, round2((totalHs - vacHs - sinGoceHs) / HORAS_DIA)) : null;

    // Cada bloque de 5 días hábiles de vacaciones seguidos suma sábado y domingo (+2 días).
    const sabDomDias = (e?.licencias ?? [])
      .filter((l) => l.tipo === 'Vacaciones' && l.estado === 'validate')
      .reduce((s, l) => s + 2 * Math.floor(l.horasEnQuincena / HORAS_DIA / 5 + 1e-9), 0);

    const extrasHs = extras.porLegajo.get(n.legajo) ?? extras.porNombre.get(clave) ?? 0;

    const alertas: PlanillaAlerta[] = [];
    if (!e) alertas.push({ nivel: 'error', detalle: 'No se encontró este legajo ni este nombre entre los empleados activos de Odoo: sus incidencias no se calcularon.' });
    for (const a of e?.alertas ?? []) alertas.push({ nivel: a.nivel, detalle: a.detalle });
    if (otrasHs > TOLERANCIA_HS) alertas.push({ nivel: 'aviso', detalle: `${round2(otrasHs)} hs de licencias que la planilla no tiene como columna (ej. maternidad): se descontaron de las horas normales.` });
    for (const c of COLUMNAS_INCIDENCIA) {
      if (c.codigo === null && (incidencias[c.key] ?? 0) > 0) {
        alertas.push({ nivel: 'aviso', detalle: `${c.label}: ${incidencias[c.key]} hs sin código en la solapa EXPORTA, hay que definirlo con RRHH.` });
      }
    }
    if (sinGoceHs > TOLERANCIA_HS) alertas.push({ nivel: 'aviso', detalle: `${round2(sinGoceHs)} hs de permisos sin pagar: figuran como diferencia de horas.` });
    if (n.convenio === 'MADEREROS' || n.convenio === 'SOIVA') {
      if (extrasHs > 0 && !e) alertas.push({ nivel: 'aviso', detalle: 'Tiene horas extras en BASE HORAS EXTRAS pero no se encontró en Odoo.' });
    }

    return {
      legajo: n.legajo,
      nombre: n.nombre,
      centroCosto: n.centroCosto,
      tipoLiquidacion: n.tipoLiquidacion,
      convenio: n.convenio,
      enOdoo: Boolean(e),
      totalHs: round2(totalHs),
      feriadosHs: round2(feriadosHs),
      extrasHs: round2(extrasHs),
      normalesHs: round2(normalesHs),
      incidencias,
      otrasHs: round2(otrasHs),
      sinGoceHs: round2(sinGoceHs),
      presentismo: pres.valor,
      presentismoNota: pres.nota,
      viaticoDias,
      sabDomDias,
      diasVacaciones: round2(vacHs / HORAS_DIA),
      anticipos: ant.anticipos.get(clave) ?? 0,
      guarderia: ant.guarderia.get(clave) ?? 0,
      alertas,
    };
  });

  // Solapa EXPORTA: legajo · código · valor (sin filas en cero).
  const exporta: PlanillaExportaRow[] = [];
  for (const r of rows) {
    const push = (codigo: number, valor: number) => {
      if (valor > 0) exporta.push({ legajo: r.legajo, codigo, valor: round2(valor) });
    };
    push(CODIGO.normales, r.normalesHs);
    for (const c of COLUMNAS_INCIDENCIA) {
      if (c.codigo === null) continue;
      // Vacaciones se informan en días; el resto en horas.
      push(c.codigo, c.key === 'vacaciones' ? r.diasVacaciones : (r.incidencias[c.key] ?? 0));
    }
    push(CODIGO.extras50, r.extrasHs);
    if (r.presentismo !== null) push(CODIGO.presentismo, r.convenio === 'MADEREROS' ? r.presentismo / 10 : r.presentismo);
    if (r.viaticoDias !== null) push(CODIGO.refrigerio, r.viaticoDias);
  }

  const suma = (pick: (r: PlanillaRow) => number) => round2(rows.reduce((s, r) => s + pick(r), 0));
  rows.sort(
    (a, b) =>
      Number(b.alertas.some((x) => x.nivel === 'error')) - Number(a.alertas.some((x) => x.nivel === 'error')) ||
      Number(b.alertas.length > 0) - Number(a.alertas.length > 0) ||
      a.nombre.localeCompare(b.nombre, 'es')
  );

  return {
    generatedAt: odoo.generatedAt,
    desde: odoo.desde,
    hasta: odoo.hasta,
    diasHabiles: odoo.diasHabiles,
    feriados: odoo.feriados,
    columnas: COLUMNAS_INCIDENCIA.map((c) => ({ key: c.key, label: c.label, codigo: c.codigo })),
    totales: {
      empleados: rows.length,
      enOdoo: rows.filter((r) => r.enOdoo).length,
      totalHs: suma((r) => r.totalHs),
      feriadosHs: suma((r) => r.feriadosHs),
      extrasHs: suma((r) => r.extrasHs),
      normalesHs: suma((r) => r.normalesHs),
      incidenciasHs: suma((r) => Object.values(r.incidencias).reduce((s, v) => s + v, 0)),
      sinGoceHs: suma((r) => r.sinGoceHs),
      anticipos: suma((r) => r.anticipos),
      guarderia: suma((r) => r.guarderia),
      conErrores: rows.filter((r) => r.alertas.some((a) => a.nivel === 'error')).length,
      conAvisos: rows.filter((r) => r.alertas.length > 0 && !r.alertas.some((a) => a.nivel === 'error')).length,
    },
    rows,
    exporta,
  };
}

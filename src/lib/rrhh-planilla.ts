import { getRrhhQuincena, TIPO_HORAS_EXTRA, type QuincenaEmpleadoRow } from './odoo/rrhh-quincena';
import { leerNominaOdoo, normalizarConvenio, normalizarTipoLiquidacion } from './odoo/rrhh-nomina';
import { getEstadosResumen } from './supabase/rrhh-resumen-estado';
import { leerParametrosQuincena, type CampoParametro, type ValorParametro } from './supabase/rrhh-planilla-parametros';
import { claveNombre, fetchSheetTable, legajoNumero, round2 } from './rrhh-sheet';

/**
 * Planilla de cálculo quincenal (la `PLANILLA DE CALCULO 2Q` del Google Sheet de liquidación) armada desde Odoo:
 *  - La lista de empleados, el legajo y el centro de costo: los empleados activos de Odoo.
 *  - Horas normales, incidencias y vacaciones: las licencias aprobadas en Odoo.
 *  - Horas extras: base = fichadas de Odoo; a pagar = ausencias tipo "Horas extra" aprobadas en Odoo.
 *  - Tipo de liquidación y convenio: campos de la ficha del empleado en Odoo (ver odoo/rrhh-nomina.ts). Mientras no estén
 *    cargados, se toman de la hoja de nómina de Google como respaldo y se avisa.
 * Anticipos y guardería no entran (quedan fuera del tablero). Las reglas son las del instructivo.
 */

/** Horas de un día completo para liquidación (ver rrhh-quincena.ts). */
const HORAS_DIA = 8.8;
const TOLERANCIA_HS = 0.1;

/**
 * Columnas de incidencias de la planilla (K..Y, más Vacaciones en Z), en el mismo orden. `odoo`: tipo de
 * ausencia de Odoo que alimenta la columna (null: Odoo no tiene ese tipo); `codigo`: código de INFOCOR en la
 * solapa EXPORTA (null: la solapa no lo tiene, hay que definirlo con RRHH).
 */
export const COLUMNAS_INCIDENCIA: { key: string; label: string; odoo: string | null; codigo: number | null; noExporta?: string }[] = [
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
  // Las vacaciones NO van a la EXPORTA: INFOCOR las carga por fechas (el código 5 es feriado y también lo pone INFOCOR).
  { key: 'vacaciones', label: 'Vacaciones hábiles', odoo: 'Vacaciones', codigo: null, noExporta: 'INFOCOR las carga por fechas' },
];

/**
 * Tipos de Odoo que NO se descuentan de las horas normales: la planilla los suma a HS NORMALES (el reloj
 * suma el banco de horas a "tiempo trabajado"). Los Días compensatorios se tratan igual — a confirmar con
 * RRHH, porque el reloj no tiene columna para ellos.
 */
const TIPOS_PAGOS_COMO_NORMALES = ['Banco de horas', 'Días compensatorios', 'Tiempo personal pagado', TIPO_HORAS_EXTRA];
const TIPO_SIN_GOCE = 'Permisos sin pagar';

const CODIGO = { normales: 1, extras50: 15, presentismo: 11, refrigerio: 40 };

/** Presentismo SOIVA que se exporta: tope 20; los 5 restantes los agrega INFOCOR con el código 14. */
const PRESENTISMO_SOIVA_MAX = 20;

/** Solo los quincenales de estos convenios van a la EXPORTA (los mensualizados se liquidan aparte). */
const CONVENIOS_EXPORTA = ['SOIVA', 'MADEREROS'];

const esEntero = (v: number) => Math.abs(v - Math.round(v)) < 0.01;

export type PlanillaAlertaNivel = 'error' | 'aviso';

export interface PlanillaAlerta {
  nivel: PlanillaAlertaNivel;
  detalle: string;
}

/** De dónde sale el valor de Total hs, Feriados o Viático de una fila. */
export interface OrigenParametro {
  /** 'odoo': calculado desde Odoo; 'quincena': el valor del encabezado (toda la columna); 'persona': ajustado en la celda. */
  fuente: 'odoo' | 'quincena' | 'persona';
  /** Lo que calcula Odoo para esta persona (para comparar). null: no corresponde (viático fuera de SOIVA). */
  odoo: number | null;
  por?: string;
  en?: string;
}

export interface PlanillaRow {
  /** Identificador único de la fila: el legajo se puede repetir entre personas distintas. */
  clave: string;
  /** hr.employee.id: para guardar los ajustes por persona. */
  empleadoId: number;
  legajo: number;
  nombre: string;
  centroCosto: string;
  tipoLiquidacion: string;
  convenio: string;
  /** TOTAL HS QUINC. */
  totalHs: number;
  feriadosHs: number;
  /** Horas extra según las fichadas de Odoo (informativo: lo que habría que revisar). */
  extrasBaseHs: number;
  /** Horas extra a pagar: aprobadas en Odoo como ausencia tipo "Horas extra". Código 15 en EXPORTA. */
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
  /** Días hábiles de vacaciones aprobadas en Odoo que caen en la quincena (enteros). Vacaciones hábiles = días × 8,80. */
  diasVacaciones: number;
  /** Informativo (no se paga ni se suma): banco de horas usado en la quincena (licencias de Banco de horas aprobadas). */
  bancoConsumidoHs: number;
  /** Informativo: horas acreditadas al banco en la quincena (asignaciones aprobadas en Odoo con fecha en el período). */
  bancoAcreditadoHs: number;
  /** Si entra a la solapa EXPORTA (solo quincenales de SOIVA y Madereros); si no, por qué. */
  enExporta: boolean;
  motivoNoExporta: string | null;
  alertas: PlanillaAlerta[];
  /** Origen de los tres valores editables (encabezado o celda) de la fila. */
  origen: Record<CampoParametro, OrigenParametro>;
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
  columnas: { key: string; label: string; codigo: number | null; noExporta?: string }[];
  totales: {
    empleados: number;
    totalHs: number;
    feriadosHs: number;
    extrasBaseHs: number;
    extrasHs: number;
    normalesHs: number;
    incidenciasHs: number;
    sinGoceHs: number;
    conErrores: number;
    conAvisos: number;
  };
  /** Parámetros de la quincena (encabezado): lo cargado por RRHH y lo que calcula Odoo como referencia. */
  parametros: {
    /** `false` si falta crear la tabla en Supabase: no se pueden guardar valores (la Planilla usa los de Odoo). */
    disponible: boolean;
    cargados: Partial<Record<CampoParametro, ValorParametro>>;
    odoo: Record<CampoParametro, number>;
  };
  /** De dónde salieron el tipo de liquidación y el convenio. */
  fuenteNomina: {
    /** Si ya existen en Odoo los campos "Tipo de liquidación" y "Convenio" en la ficha del empleado. */
    campoTipoEnOdoo: boolean;
    campoConvenioEnOdoo: boolean;
    /** Empleados para los que se usó la hoja de Google como respaldo. */
    desdeGoogle: number;
    googleDisponible: boolean;
  };
  rows: PlanillaRow[];
  exporta: PlanillaExportaRow[];
  /** Personas que siguen en la hoja de nómina de Google pero ya no están activas en Odoo (bajas). */
  sinOdoo: { legajo: number; nombre: string }[];
  /** Activos en Odoo sin legajo (credencial): no se pueden liquidar hasta cargarlo. */
  sinLegajo: string[];
  /** Marcados como "Ignorar" en RRHH > Administración: no se liquidan. */
  ignorados: { legajo: number; nombre: string }[];
}

type NominaRow = { legajo: number; nombre: string; centroCosto: string; tipoLiquidacion: string; convenio: string };

/**
 * Hoja de nómina de Google (PLANILLA DE CALCULO 2Q): solo como RESPALDO del tipo de liquidación y el convenio mientras Odoo no
 * los tenga cargados. Si la hoja no se puede leer, la Planilla sigue igual (sin respaldo).
 */
async function leerNominaGoogle(): Promise<NominaRow[] | null> {
  try {
    // Fila 5 = encabezados; las 4 de arriba son parámetros y totales.
    const table = await fetchSheetTable('PLANILLA DE CALCULO 2Q ', 'A5:F1200');
    const out: NominaRow[] = [];
    for (const r of table.slice(1)) {
      const legajo = Number((r[0] ?? '').trim());
      const nombre = (r[1] ?? '').trim();
      if (!nombre || !Number.isFinite(legajo) || legajo <= 0) continue;
      out.push({
        legajo,
        nombre,
        centroCosto: (r[2] ?? '').trim(),
        tipoLiquidacion: normalizarTipoLiquidacion(r[4] ?? ''),
        convenio: normalizarConvenio(r[5] ?? ''),
      });
    }
    return out;
  } catch (err) {
    console.warn('[rrhh-planilla] no se pudo leer la hoja de nómina de Google (respaldo):', err instanceof Error ? err.message : err);
    return null;
  }
}

function presentismoDe(convenio: string, e: QuincenaEmpleadoRow, ausenteDias: number, diasLaborables: number): { valor: number | null; nota: string } {
  if (convenio === 'SOIVA') {
    // Se exporta como máximo 20 y siempre entero (los 5 restantes los suma INFOCOR con el código 14). Las vacaciones no
    // descuentan. Tardanzas y salidas anticipadas todavía no entran: la fórmula completa se define con RRHH (spec §5.5–5.7).
    const valor = ausenteDias > 0 ? Math.max(0, Math.round(PRESENTISMO_SOIVA_MAX - 3 * ausenteDias)) : PRESENTISMO_SOIVA_MAX;
    const nota = ausenteDias > 0 ? `20 − 3 × ${round2(ausenteDias)} día(s) ausente(s), redondeado` : '20 sin ausencias (INFOCOR suma 5 con el código 14)';
    return { valor, nota: `${nota}; sin tardanzas ni salidas anticipadas todavía` };
  }
  if (convenio === 'MADEREROS') {
    // 10 = asistencia normal (1 en EXPORTA); solo las faltas injustificadas restan, en proporción.
    const faltas = e.porTipo.find((t) => t.tipo === TIPO_SIN_GOCE)?.horas ?? 0;
    const diasFalta = faltas / HORAS_DIA;
    const valor = diasLaborables > 0 ? Math.max(0, 10 * (1 - diasFalta / diasLaborables)) : 10;
    return { valor: round2(valor), nota: diasFalta > 0 ? `10 con quita proporcional por ${round2(diasFalta)} día(s) sin goce` : '10 sin faltas injustificadas' };
  }
  return { valor: null, nota: 'Este convenio no lleva presentismo en la planilla' };
}

export async function getRrhhPlanilla(desde: string, hasta: string): Promise<RrhhPlanillaResult> {
  const [odoo, nominaOdoo, google, estados, params] = await Promise.all([
    getRrhhQuincena(desde, hasta),
    leerNominaOdoo(),
    leerNominaGoogle(),
    getEstadosResumen(),
    leerParametrosQuincena(desde, hasta),
  ]);
  // Valores "de la quincena" según Odoo (sin ingresos a mitad de quincena): referencia del encabezado.
  const odooGeneral: Record<CampoParametro, number> = {
    totalHs: round2(odoo.diasHabiles * HORAS_DIA),
    feriadosHs: round2(odoo.feriados.length * HORAS_DIA),
    viaticoDias: odoo.diasHabiles,
  };
  // Los que RRHH marcó como "Ignorar" en Administración no se liquidan (mismo criterio que el Resumen).
  const ignoradoPorId = (id: number) => estados.get(id) === 'ignorar';
  const diasLaborables = odoo.diasHabiles - odoo.feriados.length;

  // Respaldo de Google, por nombre y por legajo (el legajo solo si es de una única fila: se repite entre agrupamientos).
  const googlePorNombre = new Map<string, NominaRow>();
  const googlePorLegajo = new Map<number, NominaRow[]>();
  for (const n of google ?? []) {
    googlePorNombre.set(claveNombre(n.nombre), n);
    googlePorLegajo.set(n.legajo, [...(googlePorLegajo.get(n.legajo) ?? []), n]);
  }
  const enGoogle = (e: QuincenaEmpleadoRow): NominaRow | undefined => {
    const porNombre = googlePorNombre.get(claveNombre(e.nombre));
    if (porNombre) return porNombre;
    // El número de legajo se repite entre agrupamientos (03/0004 de un director y 01/0004 de un operario dan 4): por legajo solo
    // si además coincide el apellido.
    const n = legajoNumero(e.legajo);
    const porLegajo = n !== null ? googlePorLegajo.get(n) : undefined;
    const apellido = (s: string) => claveNombre(s).split(' ')[0];
    return porLegajo?.length === 1 && apellido(porLegajo[0]!.nombre) === apellido(e.nombre) ? porLegajo[0] : undefined;
  };

  // La lista sale de Odoo: los empleados activos con legajo (sin los ignorados).
  const ignorados = odoo.rows.filter((e) => ignoradoPorId(e.id)).map((e) => ({ legajo: legajoNumero(e.legajo) ?? 0, nombre: e.nombre }));
  const sinLegajo = odoo.rows.filter((e) => !ignoradoPorId(e.id) && legajoNumero(e.legajo) === null).map((e) => e.nombre);
  const vigentes = odoo.rows.filter((e) => !ignoradoPorId(e.id) && legajoNumero(e.legajo) !== null);
  let desdeGoogle = 0;

  const rows: PlanillaRow[] = vigentes.map((e) => {
    const legajo = legajoNumero(e.legajo)!;
    const g = enGoogle(e);
    const deOdoo = nominaOdoo.porEmpleado.get(e.id);
    const alertas: PlanillaAlerta[] = [];

    // Tipo de liquidación y convenio: de Odoo; si el campo no existe o está vacío, de la hoja de Google (y se avisa).
    let tipoLiquidacion = deOdoo?.tipoLiquidacion ?? '';
    let convenio = deOdoo?.convenio ?? '';
    const faltan: string[] = [];
    if (!tipoLiquidacion && g?.tipoLiquidacion) {
      tipoLiquidacion = g.tipoLiquidacion;
      faltan.push('tipo de liquidación');
    }
    if (!convenio && g?.convenio) {
      convenio = g.convenio;
      faltan.push('convenio');
    }
    if (faltan.length > 0) {
      desdeGoogle += 1;
      // Si los campos todavía no existen en Odoo se avisa una sola vez arriba de la tabla, no fila por fila.
      const campoExiste = faltan.some((f) => (f === 'convenio' ? nominaOdoo.campoConvenio : nominaOdoo.campoTipo));
      if (campoExiste) alertas.push({ nivel: 'aviso', detalle: `Falta cargar en Odoo el ${faltan.join(' y el ')}: se tomó de la hoja de Google.` });
    }
    const centroCosto = e.centroCosto ?? g?.centroCosto ?? '';

    // Total hs y Feriados: el ajuste de la celda gana; si no, el valor del encabezado; si no, lo que calcula Odoo para la persona.
    const ajuste = params.porEmpleado.get(e.id) ?? {};
    const elegir = (campo: 'totalHs' | 'feriadosHs', odooValor: number): { valor: number; origen: OrigenParametro } => {
      const p = ajuste[campo] ?? params.generales[campo];
      if (!p) return { valor: odooValor, origen: { fuente: 'odoo', odoo: round2(odooValor) } };
      return { valor: p.valor, origen: { fuente: ajuste[campo] ? 'persona' : 'quincena', odoo: round2(odooValor), por: p.por, en: p.en } };
    };
    const total = elegir('totalHs', e.horasEsperadas);
    const feriados = elegir('feriadosHs', e.feriadosHs);
    const totalHs = total.valor;
    const feriadosHs = feriados.valor;
    const horasDe = (tipo: string) => e.porTipo.find((t) => t.tipo === tipo)?.horas ?? 0;

    const incidencias: Record<string, number> = {};
    const tiposConColumna = new Set<string>();
    for (const c of COLUMNAS_INCIDENCIA) {
      incidencias[c.key] = c.odoo ? round2(horasDe(c.odoo)) : 0;
      if (c.odoo) tiposConColumna.add(c.odoo);
    }
    const sinGoceHs = horasDe(TIPO_SIN_GOCE);
    const otrasHs = e.porTipo.filter((t) => !tiposConColumna.has(t.tipo) && !TIPOS_PAGOS_COMO_NORMALES.includes(t.tipo) && t.tipo !== TIPO_SIN_GOCE).reduce((s, t) => s + t.horas, 0);
    const incidenciasHs = Object.values(incidencias).reduce((s, v) => s + v, 0);

    // HS NORMALES = lo que queda de la jornada sin feriados, incidencias, vacaciones ni permisos sin goce.
    const normalesHs = Math.max(0, totalHs - feriadosHs - incidenciasHs - otrasHs - sinGoceHs);

    const ausenteDias = ((incidencias.enfermedad ?? 0) + (incidencias.accidente ?? 0) + sinGoceHs) / HORAS_DIA;
    const pres = presentismoDe(convenio, e, ausenteDias, diasLaborables);

    const vacHs = incidencias.vacaciones ?? 0;
    // Días hábiles de vacaciones gozados en la quincena y cargados en Odoo. Los sábados y domingos los controla RRHH a mano en Odoo.
    const diasVacaciones = round2(vacHs / HORAS_DIA);
    // Código 40: base de la quincena; las carpetas médicas (3 y 6) SÍ pagan; solo restan vacaciones y faltas injustificadas.
    // Ajuste de la celda: es el valor final. Encabezado: son los días de viático de la quincena, y a cada uno se le restan sus
    // vacaciones y faltas sin goce. Sin nada cargado: el cálculo de Odoo sobre el total de horas de la persona.
    const viaticoOdoo = convenio === 'SOIVA' ? Math.max(0, round2((e.horasEsperadas - vacHs - sinGoceHs) / HORAS_DIA)) : null;
    let viaticoDias: number | null = null;
    let origenViatico: OrigenParametro = { fuente: 'odoo', odoo: viaticoOdoo };
    if (convenio === 'SOIVA') {
      const pv = ajuste.viaticoDias;
      const gv = params.generales.viaticoDias;
      if (pv) {
        viaticoDias = pv.valor;
        origenViatico = { fuente: 'persona', odoo: viaticoOdoo, por: pv.por, en: pv.en };
      } else if (gv) {
        viaticoDias = Math.max(0, round2(gv.valor - (vacHs + sinGoceHs) / HORAS_DIA));
        origenViatico = { fuente: 'quincena', odoo: viaticoOdoo, por: gv.por, en: gv.en };
      } else {
        viaticoDias = Math.max(0, round2((totalHs - vacHs - sinGoceHs) / HORAS_DIA));
      }
    }
    const viaticoConDecimales = viaticoDias !== null && !esEntero(viaticoDias);

    const motivoNoExporta = !tipoLiquidacion
      ? 'Sin tipo de liquidación (ni en Odoo ni en la hoja de Google): no entra a EXPORTA hasta cargarlo.'
      : tipoLiquidacion !== 'QUINCENAL'
        ? `${tipoLiquidacion.charAt(0) + tipoLiquidacion.slice(1).toLowerCase()}: no entra a EXPORTA (solo quincenales).`
        : !CONVENIOS_EXPORTA.includes(convenio)
          ? `Convenio ${convenio || 'vacío'}: no entra a EXPORTA (solo SOIVA y Madereros).`
          : null;

    // Horas extras: base = lo que dicen las fichadas; a pagar = lo que RRHH aprobó en Odoo (tipo "Horas extra"). Se exporta lo aprobado.
    const extrasBaseHs = e.extrasBaseHs;
    const extrasHs = e.extrasAprobadasHs;

    for (const a of e.alertas) alertas.push({ nivel: a.nivel, detalle: a.detalle });
    if (otrasHs > TOLERANCIA_HS) alertas.push({ nivel: 'aviso', detalle: `${round2(otrasHs)} hs de licencias que la planilla no tiene como columna (ej. maternidad): se descontaron de las horas normales.` });
    for (const c of COLUMNAS_INCIDENCIA) {
      if (c.codigo === null && !c.noExporta && (incidencias[c.key] ?? 0) > 0) {
        alertas.push({ nivel: 'aviso', detalle: `${c.label}: ${incidencias[c.key]} hs sin código en la solapa EXPORTA, hay que definirlo con RRHH.` });
      }
    }
    if (!esEntero(diasVacaciones)) {
      alertas.push({ nivel: 'error', detalle: `Vacaciones con decimales (${diasVacaciones} días = ${round2(vacHs)} hs): tienen que ser días completos × 8,80. Revisar la licencia en Odoo (¿cargada por horas o de medio día?).` });
    }
    if (viaticoConDecimales) {
      alertas.push({ nivel: 'error', detalle: `Viático con decimales (${viaticoDias} días): hay horas mal clasificadas (licencia por horas o sin goce parcial). No se exporta el código 40 hasta corregirlo.` });
    }
    if (motivoNoExporta && !tipoLiquidacion) alertas.push({ nivel: 'aviso', detalle: motivoNoExporta });
    if (sinGoceHs > TOLERANCIA_HS) alertas.push({ nivel: 'aviso', detalle: `${round2(sinGoceHs)} hs de permisos sin pagar: figuran como diferencia de horas.` });
    // Cuadratura: feriados + incidencias + otras licencias + sin goce no pueden pasar el total de la quincena (las normales completan el resto).
    const cubiertasHs = feriadosHs + incidenciasHs + otrasHs + sinGoceHs;
    if (cubiertasHs > totalHs + TOLERANCIA_HS) {
      alertas.push({
        nivel: 'error',
        detalle: `No cuadra: feriados, licencias y sin goce suman ${round2(cubiertasHs)} hs y el total de la quincena es ${round2(totalHs)} hs (sobran ${round2(cubiertasHs - totalHs)} hs). Revisar las licencias en Odoo o ajustar el total de la persona.`,
      });
    }
    // Encabezado aplicado a alguien para quien Odoo calcula otra cosa (ej. ingresó a mitad de quincena): conviene ajustar la celda.
    for (const [campo, o, label] of [['totalHs', total.origen, 'Total hs'], ['feriadosHs', feriados.origen, 'Feriados']] as const) {
      if (o.fuente === 'quincena' && o.odoo !== null && Math.abs(o.odoo - odooGeneral[campo]) > TOLERANCIA_HS) {
        alertas.push({ nivel: 'aviso', detalle: `${label}: se usó el valor de la quincena (${round2(campo === 'totalHs' ? totalHs : feriadosHs)} hs), pero Odoo calcula ${o.odoo} hs para esta persona (¿ingresó a mitad de quincena?). Si corresponde, ajustá la celda.` });
      }
    }
    if (extrasBaseHs - extrasHs > TOLERANCIA_HS) {
      alertas.push({
        nivel: 'aviso',
        detalle: `Las fichadas dan ${round2(extrasBaseHs)} hs extra y hay ${round2(extrasHs)} hs aprobadas en Odoo: se pagan solo las aprobadas (tipo «${TIPO_HORAS_EXTRA}»). Lo que no se paga, se acredita al banco o se descarta en Horas.`,
      });
    }

    return {
      clave: `o${e.id}`,
      empleadoId: e.id,
      origen: { totalHs: total.origen, feriadosHs: feriados.origen, viaticoDias: origenViatico },
      legajo,
      nombre: e.nombre,
      centroCosto,
      tipoLiquidacion,
      convenio,
      totalHs: round2(totalHs),
      feriadosHs: round2(feriadosHs),
      extrasBaseHs: round2(extrasBaseHs),
      extrasHs: round2(extrasHs),
      normalesHs: round2(normalesHs),
      incidencias,
      otrasHs: round2(otrasHs),
      sinGoceHs: round2(sinGoceHs),
      presentismo: pres.valor,
      presentismoNota: pres.nota,
      viaticoDias,
      diasVacaciones,
      bancoConsumidoHs: round2(e.bancoUsado),
      bancoAcreditadoHs: round2(e.bancoAcreditado),
      enExporta: motivoNoExporta === null,
      motivoNoExporta,
      alertas,
    };
  });

  // Solapa EXPORTA: legajo · código · valor (sin filas en cero). Solo quincenales de SOIVA y Madereros.
  const exporta: PlanillaExportaRow[] = [];
  for (const r of rows) {
    if (!r.enExporta) continue;
    const push = (codigo: number, valor: number) => {
      if (valor > 0) exporta.push({ legajo: r.legajo, codigo, valor: round2(valor) });
    };
    push(CODIGO.normales, r.normalesHs);
    for (const c of COLUMNAS_INCIDENCIA) {
      if (c.codigo === null) continue;
      push(c.codigo, r.incidencias[c.key] ?? 0);
    }
    push(CODIGO.extras50, r.extrasHs);
    if (r.presentismo !== null) push(CODIGO.presentismo, r.convenio === 'MADEREROS' ? r.presentismo / 10 : r.presentismo);
    // Un viático con decimales es un error de clasificación: no se exporta hasta corregirlo (queda marcado en la fila).
    if (r.viaticoDias !== null && esEntero(r.viaticoDias)) push(CODIGO.refrigerio, r.viaticoDias);
  }

  // Quien sigue en la hoja de Google pero ya no está activo en Odoo: para que RRHH lo saque de la hoja.
  const activos = new Set(odoo.rows.map((e) => claveNombre(e.nombre)));
  const legajosActivos = new Set(odoo.rows.map((e) => legajoNumero(e.legajo)).filter((n): n is number => n !== null));
  const sinOdoo = (google ?? []).filter((n) => !activos.has(claveNombre(n.nombre)) && !legajosActivos.has(n.legajo)).map((n) => ({ legajo: n.legajo, nombre: n.nombre }));

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
    columnas: COLUMNAS_INCIDENCIA.map((c) => ({ key: c.key, label: c.label, codigo: c.codigo, noExporta: c.noExporta })),
    totales: {
      empleados: rows.length,
      totalHs: suma((r) => r.totalHs),
      feriadosHs: suma((r) => r.feriadosHs),
      extrasBaseHs: suma((r) => r.extrasBaseHs),
      extrasHs: suma((r) => r.extrasHs),
      normalesHs: suma((r) => r.normalesHs),
      incidenciasHs: suma((r) => Object.values(r.incidencias).reduce((s, v) => s + v, 0)),
      sinGoceHs: suma((r) => r.sinGoceHs),
      conErrores: rows.filter((r) => r.alertas.some((a) => a.nivel === 'error')).length,
      conAvisos: rows.filter((r) => r.alertas.length > 0 && !r.alertas.some((a) => a.nivel === 'error')).length,
    },
    parametros: { disponible: params.disponible, cargados: params.generales, odoo: odooGeneral },
    fuenteNomina: {
      campoTipoEnOdoo: nominaOdoo.campoTipo !== null,
      campoConvenioEnOdoo: nominaOdoo.campoConvenio !== null,
      desdeGoogle,
      googleDisponible: google !== null,
    },
    rows,
    exporta,
    sinOdoo,
    sinLegajo,
    ignorados,
  };
}

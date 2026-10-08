import {
  JORNADA,
  MESAS,
  PAUSA_EN_TRABAJO_MIN,
  claveRegla,
  familiaDeProducto,
  formatHora,
  medidaDeProducto,
  relojDesdeTrabajo,
  resolverRegla,
  type ModoTap,
  type ReglaTap,
} from './linea-config';

/**
 * De dónde sale el trabajo de un día:
 * - atrasado: pendiente de días anteriores (vencido o que no entró) — va primero.
 * - dia: planificado en Odoo para ese día.
 * - adelantado: de días siguientes, para completar las 488 min — va último y solo lo que entra.
 */
export type OrigenLinea = 'atrasado' | 'dia' | 'adelantado';

const ORDEN_ORIGEN: Record<OrigenLinea, number> = { atrasado: 0, dia: 1, adelantado: 2 };

export interface OrdenLinea {
  name: string;
  producto: string;
  cantidad: number;
  /** `estimated_time` de mrp.production, en horas (de la orden completa). */
  horas: number;
  /** `state` de mrp.production. */
  estado: string;
  /** `planning_date` (YYYY-MM-DD). */
  fecha: string;
  origen: OrigenLinea;
  /** Parte de la orden que se planifica acá (1 = completa). Menor a 1 cuando otro día hizo o hará el resto. */
  fraccion: number;
}

export interface ItemLinea {
  familia: string;
  /** Medida (ej. "140X190"), '' si no se pudo leer del nombre. Cada medida de una familia es un item propio. */
  medida: string;
  /** Unidades de este item (suma de cantidad × fracción de sus órdenes). */
  unidades: number;
  origen: OrigenLinea;
  modo: ModoTap | null;
  prioridad: number;
  /** Mesas de la regla que están activas (las que realmente se usan). */
  mesas: string[];
  totalMin: number;
  /** paralelo: totalMin / mesas; serie: totalMin (cada mesa del circuito lo hace completo). */
  porMesaMin: number;
  /** Minutos de este item que no entran en la jornada. */
  excedeMin: number;
  ordenes: OrdenLinea[];
}

export interface TramoMesa {
  familia: string;
  medida: string;
  /** Unidades que esta mesa hace en este tramo (en paralelo es su parte; en serie, todas pasan por cada mesa). */
  unidades: number;
  modo: ModoTap;
  origen: OrigenLinea;
  desde: string;
  hasta: string;
  /** En minutos de trabajo (0 = 06:00, sin contar el desayuno) — para dibujar la barra. */
  inicioMin: number;
  finMin: number;
  minutos: number;
  /** Cae fuera de los 488 minutos del día. */
  excede: boolean;
}

export interface MesaPlan {
  codigo: string;
  nombre: string;
  activa: boolean;
  ocupadoMin: number;
  libreMin: number;
  tramos: TramoMesa[];
}

export interface PlanLinea {
  jornada: { inicio: string; fin: string; capacidadMin: number; pausaDesde: string; pausaHasta: string; pausaEnTrabajoMin: number };
  mesas: MesaPlan[];
  planificados: ItemLinea[];
  excluidos: ItemLinea[];
  sinRegla: ItemLinea[];
  /** Tienen regla pero ninguna de sus mesas está activa. */
  sinMesa: ItemLinea[];
  excedenteMin: number;
  /** Minutos arrastrados de días anteriores que entran en este plan. */
  atrasadoMin: number;
  /** Minutos adelantados de días siguientes para completar la jornada. */
  adelantadoMin: number;
}

const redondear = (n: number) => Math.round(n * 10) / 10;

/** Corta un tramo en el desayuno (09:00) y en el fin de la jornada (488 min), para que cada pedazo tenga una hora de reloj continua. */
function partirTramo(base: Pick<TramoMesa, 'familia' | 'medida' | 'modo' | 'origen'>, inicio: number, fin: number, unidades: number): TramoMesa[] {
  const cortes = [PAUSA_EN_TRABAJO_MIN, JORNADA.capacidadMin].filter((c) => c > inicio && c < fin);
  const puntos = [inicio, ...cortes, fin];
  const out: TramoMesa[] = [];
  for (let i = 0; i < puntos.length - 1; i++) {
    const a = puntos[i]!;
    const b = puntos[i + 1]!;
    // Pedacitos de menos de medio minuto (ej. 08:59:45–09:00 antes del desayuno) solo ensucian la vista.
    if (b - a < 0.5) continue;
    out.push({
      ...base,
      unidades: fin > inicio ? (unidades * (b - a)) / (fin - inicio) : 0,
      inicioMin: a,
      finMin: b,
      minutos: redondear(b - a),
      excede: a >= JORNADA.capacidadMin,
      desde: formatHora(relojDesdeTrabajo(a, false)),
      hasta: formatHora(relojDesdeTrabajo(b, true)),
    });
  }
  return out;
}

/**
 * Arma el día de la línea:
 * 1. Agrupa las órdenes por familia de TAP (separando por origen) y les aplica su regla.
 * 2. Ordena: atrasado → del día → adelantado, y dentro de cada uno por prioridad
 *    (Bases antes: comprometer 2 mesas es más fácil que el circuito de 4).
 * 3. paralelo → reparte el total en partes iguales entre sus mesas activas, cada una desde donde quedó libre.
 *    serie → arranca cuando TODAS las mesas del circuito están libres y las ocupa juntas el tiempo total.
 * Lo que pasa de los 488 minutos se marca como excedente (`excedeMin` por item).
 */
export function planificarLinea(ordenes: OrdenLinea[], reglas: ReglaTap[], mesasActivas: Set<string>): PlanLinea {
  const grupos = new Map<string, { familia: string; medida: string; origen: OrigenLinea; ordenes: OrdenLinea[] }>();
  for (const o of ordenes) {
    const familia = familiaDeProducto(o.producto);
    const medida = medidaDeProducto(o.producto);
    // Lo adelantado se separa además por fecha, para terminar primero lo del día más cercano
    // (si no, al recortar lo que no entra se recortaría parejo entre fechas distintas).
    const key = o.origen === 'adelantado' ? `${o.origen}|${familia}|${medida}|${o.fecha}` : `${o.origen}|${familia}|${medida}`;
    const g = grupos.get(key) ?? { familia, medida, origen: o.origen, ordenes: [] };
    g.ordenes.push(o);
    grupos.set(key, g);
  }

  const planificables: ItemLinea[] = [];
  const excluidos: ItemLinea[] = [];
  const sinRegla: ItemLinea[] = [];
  const sinMesa: ItemLinea[] = [];

  for (const { familia, medida, origen, ordenes: ords } of grupos.values()) {
    const regla = resolverRegla(claveRegla(familia, medida), reglas);
    const totalMin = redondear(ords.reduce((s, o) => s + o.horas * 60 * o.fraccion, 0));
    const unidades = ords.reduce((s, o) => s + o.cantidad * o.fraccion, 0);
    const mesas = (regla?.mesas ?? []).filter((m) => mesasActivas.has(m));
    const item: ItemLinea = {
      familia,
      medida,
      unidades,
      origen,
      modo: regla?.modo ?? null,
      prioridad: regla?.prioridad ?? 99,
      mesas,
      totalMin,
      porMesaMin: 0,
      excedeMin: 0,
      ordenes: ords.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.producto.localeCompare(b.producto)),
    };
    if (!regla) sinRegla.push(item);
    else if (regla.modo === 'excluido') excluidos.push(item);
    else if (mesas.length === 0) sinMesa.push(item);
    else {
      item.porMesaMin = regla.modo === 'paralelo' ? redondear(totalMin / mesas.length) : totalMin;
      planificables.push(item);
    }
  }

  // Adelantado: primero el día más cercano, y dentro de cada día por prioridad.
  const fechaAdelantado = (i: ItemLinea) => (i.origen === 'adelantado' ? (i.ordenes[0]?.fecha ?? '') : '');
  planificables.sort(
    (a, b) =>
      ORDEN_ORIGEN[a.origen] - ORDEN_ORIGEN[b.origen] ||
      fechaAdelantado(a).localeCompare(fechaAdelantado(b)) ||
      a.prioridad - b.prioridad ||
      a.familia.localeCompare(b.familia) ||
      a.medida.localeCompare(b.medida, 'es', { numeric: true })
  );

  const cursor = new Map<string, number>();
  const tramos = new Map<string, TramoMesa[]>();
  for (const m of MESAS) {
    cursor.set(m.codigo, 0);
    tramos.set(m.codigo, []);
  }

  const fueraDeJornada = (inicio: number, fin: number) => Math.max(0, fin - Math.max(inicio, JORNADA.capacidadMin));

  for (const item of planificables) {
    const modo = item.modo as Exclude<ModoTap, 'excluido'>;
    const base = { familia: item.familia, medida: item.medida, modo, origen: item.origen };
    let excede = 0;
    if (modo === 'paralelo') {
      const porMesa = item.totalMin / item.mesas.length;
      const unidadesPorMesa = item.unidades / item.mesas.length;
      for (const m of item.mesas) {
        const inicio = cursor.get(m)!;
        tramos.get(m)!.push(...partirTramo(base, inicio, inicio + porMesa, unidadesPorMesa));
        cursor.set(m, inicio + porMesa);
        excede += fueraDeJornada(inicio, inicio + porMesa);
      }
    } else {
      const inicio = Math.max(...item.mesas.map((m) => cursor.get(m)!));
      for (const m of item.mesas) {
        tramos.get(m)!.push(...partirTramo(base, inicio, inicio + item.totalMin, item.unidades));
        cursor.set(m, inicio + item.totalMin);
      }
      // En serie el circuito avanza junto: lo que no entra es el mismo tramo en todas las mesas, se cuenta una vez.
      excede = fueraDeJornada(inicio, inicio + item.totalMin);
    }
    // Menos de medio minuto es residuo de redondeo al recortar lo adelantado, no un excedente real.
    item.excedeMin = excede < 0.5 ? 0 : redondear(excede);
  }

  // En la grilla: siempre las mesas de la línea resorte (aunque estén
  // inactivas, para que se vea que no se usan) y cualquier otra que alguna
  // regla haya usado.
  const mesas: MesaPlan[] = MESAS.filter((m) => m.sector === 'resorte' || tramos.get(m.codigo)!.length > 0).map((m) => {
    const ts = tramos.get(m.codigo)!;
    const ocupado = ts.filter((t) => !t.excede).reduce((s, t) => s + t.finMin - t.inicioMin, 0);
    return {
      codigo: m.codigo,
      nombre: m.nombre,
      activa: mesasActivas.has(m.codigo),
      ocupadoMin: redondear(ocupado),
      libreMin: redondear(Math.max(0, JORNADA.capacidadMin - ocupado)),
      tramos: ts,
    };
  });

  const sumaOrigen = (origen: OrigenLinea) => redondear(planificables.filter((i) => i.origen === origen).reduce((s, i) => s + i.totalMin, 0));
  const pausaHastaMin = JORNADA.pausaDesdeMin + JORNADA.pausaDuracionMin;

  return {
    jornada: {
      inicio: formatHora(JORNADA.inicioMin),
      fin: formatHora(relojDesdeTrabajo(JORNADA.capacidadMin, true)),
      capacidadMin: JORNADA.capacidadMin,
      pausaDesde: formatHora(JORNADA.pausaDesdeMin),
      pausaHasta: formatHora(pausaHastaMin),
      pausaEnTrabajoMin: PAUSA_EN_TRABAJO_MIN,
    },
    mesas,
    planificados: planificables,
    excluidos,
    sinRegla,
    sinMesa,
    excedenteMin: redondear(planificables.reduce((s, i) => s + i.excedeMin, 0)),
    atrasadoMin: sumaOrigen('atrasado'),
    adelantadoMin: sumaOrigen('adelantado'),
  };
}

export interface DiaSimulado {
  fecha: string;
  planificadoMin: number;
  /** Lo que no entró ese día y pasó al siguiente. */
  pasaMin: number;
  /** Lo que se adelantó de días siguientes para completar la jornada. */
  adelantadoMin: number;
}

/** Parte de cada orden que el plan efectivamente hace dentro de la jornada (por nombre de orden). */
function fraccionHecha(plan: PlanLinea): Map<string, number> {
  const hecha = new Map<string, number>();
  for (const item of plan.planificados) {
    const ratio = item.totalMin > 0 ? Math.max(0, 1 - item.excedeMin / item.totalMin) : 1;
    for (const o of item.ordenes) hecha.set(o.name, (hecha.get(o.name) ?? 0) + o.fraccion * ratio);
  }
  return hecha;
}

/**
 * Arma un día con lo que hay en la cola de pendientes. Con `completar`, si
 * después de lo atrasado y lo del día sobra jornada, suma trabajo de días
 * siguientes (por fecha) y se queda solo con la parte que entra — se
 * re-planifica con eso recortado para que el día no muestre "no entra" de
 * algo que en realidad no se adelantó.
 */
function armarDia(cola: OrdenLinea[], dia: string, reglas: ReglaTap[], mesasActivas: Set<string>, completar: boolean): PlanLinea {
  const base = cola
    .filter((o) => o.fecha <= dia)
    .map((o) => ({ ...o, origen: (o.fecha < dia ? 'atrasado' : 'dia') as OrigenLinea }));
  const plan = planificarLinea(base, reglas, mesasActivas);
  if (!completar) return plan;

  // Solo se adelanta lo que se planifica en la línea (no excluidos ni sin regla/mesa).
  const futuras = cola
    .filter((o) => o.fecha > dia)
    .filter((o) => {
      const regla = resolverRegla(claveRegla(familiaDeProducto(o.producto), medidaDeProducto(o.producto)), reglas);
      return regla && regla.modo !== 'excluido' && regla.mesas.some((m) => mesasActivas.has(m));
    })
    .map((o) => ({ ...o, origen: 'adelantado' as OrigenLinea }));
  if (futuras.length === 0 || plan.excedenteMin > 0) return plan;

  // Se adelanta día por día (lo más cercano primero) mientras quede lugar.
  let elegidas: OrdenLinea[] = [];
  const fechas = [...new Set(futuras.map((o) => o.fecha))].sort();
  for (const f of fechas) {
    const prueba = planificarLinea([...base, ...elegidas, ...futuras.filter((o) => o.fecha === f)], reglas, mesasActivas);
    const hecha = fraccionHecha(prueba);
    elegidas = [...elegidas, ...futuras.filter((o) => o.fecha === f)]
      .map((o) => ({ ...o, fraccion: Math.min(o.fraccion, hecha.get(o.name) ?? 0) }))
      .filter((o) => o.fraccion > 0.001);
    if (prueba.excedenteMin > 0) break;
  }
  if (elegidas.length === 0) return plan;
  return planificarLinea([...base, ...elegidas], reglas, mesasActivas);
}

/**
 * Plan del día objetivo simulando desde hoy (`dias[0]`): cada día hábil
 * toma lo vencido + lo suyo, y (con `completar`) adelanta de los días
 * siguientes hasta llenar la jornada. Lo que un día hace se descuenta de la
 * cola (en proporción, por orden); lo que no entra queda pendiente y al día
 * siguiente aparece como atrasado. Lo "excluido" no se hace en la línea:
 * deja de arrastrarse una vez pasado su día.
 *
 * `ordenes` = toda la cola pendiente (también la de después del objetivo, para poder adelantar).
 * `dias` = días hábiles a simular, el último es el día objetivo.
 */
export function simularLinea(
  ordenes: OrdenLinea[],
  reglas: ReglaTap[],
  mesasActivas: Set<string>,
  dias: string[],
  completar: boolean
): PlanLinea & { diasSimulados: DiaSimulado[] } {
  const objetivo = dias[dias.length - 1]!;
  let cola = ordenes.map((o) => ({ ...o }));
  const diasSimulados: DiaSimulado[] = [];

  for (const dia of dias) {
    const plan = armarDia(cola, dia, reglas, mesasActivas, completar);
    if (dia === objetivo) return { ...plan, diasSimulados };

    const hecha = fraccionHecha(plan);
    const excluidas = new Set(plan.excluidos.flatMap((i) => i.ordenes.map((o) => o.name)));
    cola = cola
      .map((o) => ({ ...o, fraccion: o.fraccion - (hecha.get(o.name) ?? 0) }))
      .filter((o) => o.fraccion > 0.001 && !(o.fecha <= dia && excluidas.has(o.name)));

    diasSimulados.push({
      fecha: dia,
      planificadoMin: redondear(plan.planificados.reduce((s, i) => s + i.totalMin - i.excedeMin, 0)),
      pasaMin: plan.excedenteMin,
      adelantadoMin: plan.adelantadoMin,
    });
  }
  // `dias` siempre termina en el objetivo, así que no se llega acá.
  throw new Error('simularLinea: el día objetivo no está en la lista de días');
}

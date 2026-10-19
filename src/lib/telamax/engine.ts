import type {
  ArmadoRow,
  BasesTelamax,
  CncRow,
  ConsInsumoRow,
  ConsTelaRow,
  FilaPlanilla,
  MesaOcupacion,
  Planillas,
  Procedencia,
  Registro,
  ResultadoTelamax,
  RestInsumoRow,
} from './types';

/**
 * Port fiel del motor de `telamax_v01_ejecutable.py` (clase TelaMaxEngine).
 * Se mantienen la lógica, el orden de las operaciones y los textos del log tal
 * cual el Python — se valida contra él con las mismas planillas. Diferencias
 * deliberadas (marcadas con "DIFERENCIA"):
 *  - Alias SUMA 80/97: el Python elegía un producto cualquiera de un `set`
 *    (cambia en cada ejecución). Acá, si el nombre ya existe en la base se
 *    respeta, y si no se usa el primero de la base (determinístico).
 *  - Las alertas de productos inválidos (que el Python descartaba porque
 *    `procesar` reinicia la bitácora) se devuelven aparte en `alertasPlanillas`.
 *  - Un lote más largo que una jornada hacía que el Python quedara en un bucle
 *    infinito; acá se programa cruzando días y se avisa en el log.
 */

export const MINUTOS_TURNO = 488;
const DESAYUNO_INI = 180;
const DESAYUNO_FIN = 195;
const MESA_LARGO_MAX = 12.001;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export function safeFloat(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return Number.isNaN(val) ? 0 : val;
  if (typeof val === 'boolean') return val ? 1 : 0;
  const n = Number(String(val).replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
}

/** Equivale a `.str.upper().str.strip()` de pandas sobre `astype(str)` (celda vacía → "NAN"). */
function strUp(val: unknown): string {
  if (val === null || val === undefined || val === '') return 'NAN';
  if (typeof val === 'number' && Number.isNaN(val)) return 'NAN';
  return String(val).toUpperCase().trim();
}

/** `f"{x:.{d}f}"` de Python: igual que toFixed salvo en empates exactos, donde Python redondea al par. */
export function pyFixed(x: number, d: number): string {
  const s = x.toFixed(d);
  // toFixed(80) devuelve la expansión decimal EXACTA del double: es un empate solo si
  // lo que sigue al último decimal pedido es un 5 seguido de ceros.
  const full = x.toFixed(80);
  const dot = full.indexOf('.');
  if (d > 0 && /^50*$/.test(full.slice(dot + 1 + d))) {
    const truncado = full.slice(0, dot + 1 + d);
    if (Number(truncado.slice(-1)) % 2 === 0) return truncado; // Python redondea el empate al par
  }
  return s;
}

/** Segundos → minutos con la misma aritmética que `calcular_t_cnc_val` (h*60 + m + s/60). */
export function segAMin(seg: number): number {
  const s = Math.round(seg);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h * 60 + m + (s % 60) / 60.0;
}

function esCero(seg: number): boolean {
  return !seg || seg === 0;
}

function sumBy<T>(arr: T[], f: (x: T) => number): number {
  let t = 0;
  for (const x of arr) t += f(x);
  return t;
}

function uniqueInOrder<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface Pedido {
  productoOrigen: string;
  tela: string;
  cant: number;
  clave: string;
  procedencia: Procedencia;
}

interface PedidoAgrupado extends Pedido {
  cant: number;
}

interface FilaLote {
  tela: string;
  capas: number;
  cant: number;
}

interface Lote {
  modelo: string;
  parte: string;
  material: 'Tela' | 'Guata' | 'Lienzo';
  dfLote?: FilaLote[];
  insumo?: string;
  sillones?: number;
  L: number;
  durT: number;
  durC: number;
  m: number;
  n: number;
  procedencia: Procedencia;
}

interface LoteMesa {
  startT: number;
  endT: number;
  startC: number;
  endC: number;
  L: number;
}

const FALLBACK_GUATA: [string, number][] = [
  ['GUATA 100G 150M', 8],
  ['GUATA 200G 150M', 4],
];
const FALLBACK_LIENZO: [string, number][] = [
  ['TNT 120G - 1,5M - NEGRO', 15],
  ['TNT 30G - 1,5M - BLANCO', 45],
  ['TNT 60G - 1,5M - NEGRO', 30],
  ['TNT 60G - 2M - NEGRO', 30],
  ['TNT 80G - 2M - ANTIDESLIZANTE', 30],
  ['TNT 80G - 2M - NEGRO', 30],
  ['LIENZO TNT 110 ANCHO (ALPILL)', 30],
];

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

export function planificar(bases: BasesTelamax, planillas: Planillas, numOperarios: number): ResultadoTelamax {
  const ctx = new Motor(bases);
  return ctx.ejecutar(planillas, numOperarios);
}

class Motor {
  private bitacora: string[] = [];
  private alertasPlanillas: string[] = [];
  private plan: Registro[] = [];
  private mesaOcupacion: MesaOcupacion[] = [];
  private tArmadores: number[] = [];

  private readonly cncPorNombre = new Map<string, CncRow>();
  private readonly armadoPorNombre = new Map<string, ArmadoRow>();
  private readonly consTelaPorProd = new Map<string, ConsTelaRow[]>();
  private readonly consGuataPorProd = new Map<string, ConsInsumoRow[]>();
  private readonly consLienzoPorProd = new Map<string, ConsInsumoRow[]>();
  private readonly mapeoLineas = new Map<string, string>();
  private readonly validos: string[];
  private readonly validosSet: Set<string>;
  private readonly aliasSuma97: string;
  private readonly aliasSuma80: string;

  constructor(private readonly b: BasesTelamax) {
    for (const r of b.cnc) {
      if (!this.cncPorNombre.has(r.nombre)) this.cncPorNombre.set(r.nombre, r);
      const cat = r.categoria.toUpperCase().trim();
      this.mapeoLineas.set(r.nombre, cat.includes('LEAN') ? 'LEAN' : cat.includes('COLCHON') ? 'COLCHONES' : 'TRADICIONAL');
    }
    for (const r of b.armado) if (!this.armadoPorNombre.has(r.nombre)) this.armadoPorNombre.set(r.nombre, r);
    const agrupar = <T extends { producto: string }>(rows: T[], mapa: Map<string, T[]>) => {
      for (const r of rows) {
        const l = mapa.get(r.producto);
        if (l) l.push(r);
        else mapa.set(r.producto, [r]);
      }
    };
    agrupar(b.consTela, this.consTelaPorProd);
    agrupar(b.consGuata, this.consGuataPorProd);
    agrupar(b.consLienzo, this.consLienzoPorProd);

    this.validos = uniqueInOrder(b.cnc.map((r) => r.nombre).filter((n) => n && n !== 'NAN'));
    this.validosSet = new Set(this.validos);
    this.aliasSuma97 = this.validos.find((p) => p.includes('SUMA') && p.includes('97')) ?? 'SUMA CONJUNTO 97';
    this.aliasSuma80 = this.validos.find((p) => p.includes('SUMA') && p.includes('80')) ?? 'SUMA CONJUNTO 80';
  }

  // -- tiempos de tendido ----------------------------------------------------

  private tiempoT(operacion: string): number {
    const seg = this.b.tendido[operacion];
    return seg === undefined ? 0.0 : seg / 60.0;
  }

  private tTela(m: number, n: number, L: number): number {
    if (L <= 0) return 0;
    const ts = this.tiempoT('t_SET_UP_carro');
    const v = this.tiempoT('t_TENDIDA_carro');
    const tc = this.tiempoT('t_CORTE_tijera');
    return (m + 1) * ts + n * (2 * L * v + tc);
  }

  private tGuata(m: number, n: number, L: number): number {
    if (L <= 0) return 0;
    const ts = this.tiempoT('t_SET_UP_mesa');
    const v = this.tiempoT('t_TENDIDA_mesa');
    const tc = this.tiempoT('t_CORTE_tijera');
    return (m + 1) * ts + n * (L * v + tc);
  }

  private tLienzo(m: number, n: number, L: number): number {
    if (L <= 0) return 0;
    const tc = this.tiempoT('t_CORTE_tijera');
    // El Python busca 't_SET _UP_mesa' (con un espacio de más): esa operación no
    // existe en la base, así que el set-up del lienzo vale 0. Se mantiene igual
    // para que los resultados coincidan con Telamax; corregirlo es cambiar esta línea.
    const ts = this.tiempoT('t_SET _UP_mesa');
    const v = this.tiempoT('t_TENDIDA_mesa');
    return (m + 1) * ts + n * (2 * L * v + tc);
  }

  // -- planillas ---------------------------------------------------------------

  private limpiarClave(nombre: unknown): string {
    const nUp = strUp(nombre);
    // DIFERENCIA: el Python probaba primero el alias SUMA (un producto cualquiera de un `set`), por lo
    // que "SUMA ASIENTO 97 - CAFE" caía en cualquier SUMA…97. Acá el orden es: nombre exacto → parte
    // anterior a " - " → alias SUMA (primer producto de la base) → producto contenido en el nombre.
    if (this.validosSet.has(nUp)) return nUp;
    const conGuion = nUp.includes(' - ');
    if (conGuion) {
      const nc = nUp.split(' - ')[0]!.trim();
      if (this.validosSet.has(nc)) return nc;
    }
    if (nUp.includes('SUMA') && nUp.includes('97')) return this.aliasSuma97;
    if (nUp.includes('SUMA') && nUp.includes('80')) return this.aliasSuma80;
    if (conGuion) for (const p of this.validos) if (nUp.includes(p)) return p;
    return nUp;
  }

  private preProcesar(filas: FilaPlanilla[], procedencia: Procedencia): Pedido[] {
    if (filas.length === 0) return [];
    const cols = new Set<string>();
    for (const f of filas) for (const k of Object.keys(f)) cols.add(k);
    if (!cols.has('Producto Origen')) throw new Error(`La planilla ${procedencia} no tiene la columna "Producto Origen".`);
    if (!cols.has('Tela')) throw new Error(`La planilla ${procedencia} no tiene la columna "Tela".`);
    const colCant = cols.has('Cantidad a producir') ? 'Cantidad a producir' : cols.has('Cant. ordenada') ? 'Cant. ordenada' : null;
    return filas.map((f) => ({
      productoOrigen: strUp(f['Producto Origen']),
      tela: strUp(f['Tela']),
      cant: colCant ? safeFloat(f[colCant]) : 1,
      clave: this.limpiarClave(f['Producto Origen']),
      procedencia,
    }));
  }

  /** `verificar_y_filtrar_productos`: deja solo los pedidos con producto en la base y receta completa. */
  private verificar(pedidos: Pedido[]): Pedido[] {
    const validas: Pedido[] = [];
    const errores = new Set<string>();
    for (const p of pedidos) {
      const cnc = this.cncPorNombre.get(p.clave);
      if (!cnc) {
        if (!errores.has(p.productoOrigen)) {
          errores.add(p.productoOrigen);
          this.alertasPlanillas.push(`[ALERTA] El producto '${p.productoOrigen}' no se encuentra en la base de datos.`);
        }
        continue;
      }
      let valido = true;
      const chequeos: [number, Map<string, unknown>, string][] = [
        [segAMin(cnc.segTela), this.consTelaPorProd, 'Tela'],
        [segAMin(cnc.segGuata), this.consGuataPorProd, 'Guata'],
        [segAMin(cnc.segLienzo), this.consLienzoPorProd, 'Lienzo'],
      ];
      for (const [t, mapa, nombre] of chequeos) {
        if (t > 0 && !mapa.has(p.clave)) {
          this.alertasPlanillas.push(`[ALERTA BD] El producto '${p.productoOrigen}' tiene tiempo de CNC asignado para ${nombre}, pero no tiene receta de consumo.`);
          valido = false;
        }
      }
      if (valido) validas.push(p);
      else errores.add(p.productoOrigen);
    }
    return validas;
  }

  /** `fusionar_pedidos_multisource`: junta las 3 planillas y suma por (producto, tela, procedencia). */
  private fusionar(planillas: Planillas): PedidoAgrupado[] {
    const todos: Pedido[] = [
      ...this.preProcesar(planillas.atrasados, 'ATRASADOS'),
      ...this.preProcesar(planillas.dia, 'DIA'),
      ...this.preProcesar(planillas.siguiente, 'SIGUIENTE'),
    ];
    if (todos.length === 0) return [];
    const limpios = this.verificar(todos);
    const grupos = new Map<string, PedidoAgrupado>();
    for (const p of limpios) {
      const k = `${p.clave}\u0000${p.tela}\u0000${p.procedencia}`;
      const g = grupos.get(k);
      if (g) g.cant += p.cant;
      else grupos.set(k, { ...p });
    }
    // pandas.groupby ordena por clave, tela, procedencia
    return [...grupos.values()].sort((a, b) => cmpStr(a.clave, b.clave) || cmpStr(a.tela, b.tela) || cmpStr(a.procedencia, b.procedencia));
  }

  // -- calendario ---------------------------------------------------------------

  private finConDesayuno(tStart: number, dur: number): number {
    if (dur <= 0) return tStart;
    let curr = tStart;
    let remaining = dur;
    while (remaining > 0) {
      const d = Math.floor(curr / MINUTOS_TURNO) + 1;
      const bStart = (d - 1) * MINUTOS_TURNO + DESAYUNO_INI;
      const bEnd = (d - 1) * MINUTOS_TURNO + DESAYUNO_FIN;
      if (bStart <= curr && curr < bEnd) {
        curr = bEnd;
        continue;
      }
      if (curr < bStart) {
        const timeToB = bStart - curr;
        if (remaining <= timeToB) {
          curr += remaining;
          remaining = 0;
        } else {
          remaining -= timeToB;
          curr = bEnd;
        }
      } else {
        const dayEnd = d * MINUTOS_TURNO;
        const timeToDayEnd = dayEnd - curr;
        if (remaining <= timeToDayEnd) {
          curr += remaining;
          remaining = 0;
        } else {
          remaining -= timeToDayEnd;
          curr = dayEnd;
        }
      }
    }
    return curr;
  }

  /** Si `t` cae dentro del desayuno de su jornada, lo corre al final del desayuno. */
  private saltarDesayuno(t: number): number {
    const d = Math.floor(t / MINUTOS_TURNO) + 1;
    const bStart = (d - 1) * MINUTOS_TURNO + DESAYUNO_INI;
    const bEnd = (d - 1) * MINUTOS_TURNO + DESAYUNO_FIN;
    return bStart <= t && t < bEnd ? bEnd : t;
  }

  // -- restricciones de capas ------------------------------------------------------

  private maxCapasInsumo(
    producto: string,
    cons: Map<string, ConsInsumoRow[]>,
    rest: RestInsumoRow[],
    fallback: [string, number][],
    porDefecto: number,
  ): number {
    const prodUp = producto.toUpperCase().trim();
    const match = cons.get(prodUp);
    if (match && match.length > 0) {
      const nombre = match[0]!.nombre;
      const r = rest.find((x) => x.nombre === nombre);
      if (r) {
        const val = Math.trunc(safeFloat(r.maxCapas));
        if (val > 0) return val;
      }
      const fb = fallback.find(([k]) => k === nombre);
      if (fb) return fb[1];
    }
    for (const [k, v] of fallback) if (prodUp.includes(k)) return v;
    return porDefecto;
  }

  // -- ejecución -----------------------------------------------------------------------

  ejecutar(planillas: Planillas, numOperarios: number): ResultadoTelamax {
    const pedidos = this.fusionar(planillas);
    return this.procesar(pedidos, planillas, numOperarios);
  }

  private avisosPrevios(planillas: Planillas): void {
    const activos = new Set<string>();
    const nombres = ['Producto Origen', 'PRODUCTO ORIGEN', 'Producto', 'PRODUCTO', 'Clave_Producto', 'Modelo', 'MODELO'];
    for (const filas of [planillas.atrasados, planillas.dia, planillas.siguiente]) {
      if (filas.length === 0) continue;
      const cols = uniqueInOrder(filas.flatMap((f) => Object.keys(f)));
      let col = nombres.find((n) => cols.includes(n));
      if (!col) col = cols.find((c) => ['producto', 'sillon', 'modelo', 'origen'].some((t) => c.toLowerCase().includes(t)));
      if (!col) continue;
      for (const f of filas) {
        const v = f[col];
        if (v === null || v === undefined || v === '') continue;
        const limpio = this.limpiarClave(v);
        if (limpio && limpio.toUpperCase() !== 'NAN') activos.add(limpio);
      }
    }
    // El Python itera un `set` (orden cambia por corrida); acá va ordenado.
    for (const nombre of [...activos].sort(cmpStr)) {
      const cnc = this.cncPorNombre.get(nombre);
      if (!cnc) {
        this.bitacora.push(`[ALERTA] El producto '${nombre}' no se encuentra en la base de datos.`);
        continue;
      }
      if (!esCero(cnc.segTela) && !this.consTelaPorProd.has(nombre))
        this.bitacora.push(`[ALERTA BD] El producto '${nombre}' está planificado pero no se encontró su receta de consumo en la hoja de tela.`);
      if (!esCero(cnc.segGuata) && !this.consGuataPorProd.has(nombre))
        this.bitacora.push(`[ALERTA BD] El producto '${nombre}' está planificado pero no se encontró su receta de consumo en la hoja de guata.`);
      if (!esCero(cnc.segLienzo) && !this.consLienzoPorProd.has(nombre))
        this.bitacora.push(`[ALERTA BD] El producto '${nombre}' está planificado pero no se encontró su receta de consumo en la hoja de lienzo.`);
    }
  }

  private procesar(dfP: PedidoAgrupado[], planillas: Planillas, numOperarios: number): ResultadoTelamax {
    this.plan = [];
    this.bitacora = [];
    this.mesaOcupacion = [];
    this.tArmadores = new Array<number>(numOperarios).fill(0);
    const excedentes = new Map<string, { modelo: string; material: string; cant: number }>();
    const adelantosDia1 = new Map<string, { modelo: string; material: string; cant: number }>();
    const sumar = (m: Map<string, { modelo: string; material: string; cant: number }>, modelo: string, material: string, cant: number) => {
      const k = `${modelo}\u0000${material}`;
      const e = m.get(k);
      if (e) e.cant += cant;
      else m.set(k, { modelo, material, cant });
    };

    this.avisosPrevios(planillas);

    const vacio = (): ResultadoTelamax => ({
      plan: this.plan,
      bitacora: this.bitacora,
      alertasPlanillas: this.alertasPlanillas,
      tTendido: 0,
      tCnc: 0,
      tArmadores: this.tArmadores,
      mesa: this.mesaOcupacion,
    });
    if (dfP.length === 0) return vacio();

    const lotes: Lote[] = [];

    for (const modelo of uniqueInOrder(dfP.map((p) => p.clave))) {
      if (!this.mapeoLineas.has(modelo)) {
        this.mapeoLineas.set(modelo, 'TRADICIONAL');
        this.bitacora.push(`⚠️ ADVERTENCIA: El modelo '${modelo}' no figura en la columna 'categoria_del_producto' de la BD. Tratado como TRADICIONAL.`);
      }
    }

    // grupos (modelo, procedencia) en el orden de groupby; dentro de cada uno, el orden de dfP
    const grupos = new Map<string, PedidoAgrupado[]>();
    for (const p of dfP) {
      const k = `${p.clave}\u0000${p.procedencia}`;
      const g = grupos.get(k);
      if (g) g.push(p);
      else grupos.set(k, [p]);
    }
    const clavesGrupo = [...grupos.keys()].sort((a, b) => {
      const [ma, pa] = a.split('\u0000') as [string, string];
      const [mb, pb] = b.split('\u0000') as [string, string];
      return cmpStr(ma, mb) || cmpStr(pa, pb);
    });

    for (const kg of clavesGrupo) {
      const dfOrders = grupos.get(kg)!;
      const modelo = dfOrders[0]!.clave;
      const procedencia = dfOrders[0]!.procedencia;
      const totalSillones = sumBy(dfOrders, (p) => p.cant);
      if (totalSillones <= 0) continue;

      const telaData = this.consTelaPorProd.get(modelo) ?? [];
      const guataData = this.consGuataPorProd.get(modelo) ?? [];
      const lienzoData = this.consLienzoPorProd.get(modelo) ?? [];
      const cnc = this.cncPorNombre.get(modelo);
      if (!cnc) {
        this.bitacora.push(`ℹ️ [INFO] El lote del modelo '${modelo}' se salta por no existir en la base de tiempos CNC.`);
        continue;
      }
      if (esCero(cnc.segTela) && esCero(cnc.segGuata) && esCero(cnc.segLienzo)) {
        this.bitacora.push(`ℹ️ [INFO] Se salta la simulación completa para '${modelo}' (${procedencia}) ya que su tiempo de corte CNC es 0 o equivalente a vacío.`);
        continue;
      }
      const tCncTelaTot = esCero(cnc.segTela) ? 0.0 : segAMin(cnc.segTela);
      const tCncGuataTot = esCero(cnc.segGuata) ? 0.0 : segAMin(cnc.segGuata);
      const tCncLienzoTot = esCero(cnc.segLienzo) ? 0.0 : segAMin(cnc.segLienzo);

      // ---- TELA ----------------------------------------------------------------
      if (tCncTelaTot > 0.0 && telaData.length > 0) {
        let partes = uniqueInOrder(telaData.map((r) => r.forma).filter((f) => f !== ''));
        if (partes.length === 0) partes = ['TODO'];
        const tCncTelaParte = tCncTelaTot / partes.length;

        for (const parte of partes) {
          const dParte = telaData.filter((r) => r.forma === parte);
          const L = dParte.length > 0 ? safeFloat(dParte[0]!.metros) : 0.0;
          if (L <= 0.0) continue;

          const m = /[Xx](\d+)/.exec(parte.trim().toUpperCase());
          let rendimiento = m ? Number(m[1]) : 1.0;
          if (rendimiento <= 0) rendimiento = 1.0;

          let lote: FilaLote[] = [];
          let capasAcum = 0;
          const flush = () => {
            const nC = sumBy(lote, (r) => r.capas);
            const mC = Math.max(0, uniqueInOrder(lote.map((r) => r.tela)).length - 1);
            lotes.push({
              modelo,
              parte,
              material: 'Tela',
              dfLote: lote,
              L,
              durT: this.tTela(mC, nC, L),
              durC: tCncTelaParte,
              m: mC,
              n: nC,
              procedencia,
            });
            lote = [];
            capasAcum = 0;
          };

          for (const row of dfOrders) {
            const unidades = row.cant;
            let capasPedido = Math.ceil(unidades / rendimiento);
            const excedente = capasPedido * rendimiento - unidades;
            if (excedente > 0) sumar(excedentes, modelo, `Tela - ${parte}`, excedente);

            const isVelvet = row.tela.includes('VELVET TWIST NEGRO');
            let maxCapas = 15;
            const fam = this.b.famTelas.find((f) => f.nombre === row.tela);
            if (fam) maxCapas = Math.trunc(safeFloat(fam.maxCapas));
            if (maxCapas <= 0) maxCapas = 15;

            if (lote.length > 0) {
              const currentIsVelvet = lote.some((r) => r.tela.includes('VELVET TWIST NEGRO'));
              if (currentIsVelvet !== isVelvet) flush();
            }

            while (capasPedido > 0) {
              let capasDisp = maxCapas - capasAcum;
              if (capasDisp <= 0) {
                flush();
                capasDisp = maxCapas;
              }
              const agregar = Math.min(capasPedido, capasDisp);
              lote.push({ tela: row.tela, capas: agregar, cant: agregar * rendimiento });
              capasAcum += agregar;
              capasPedido -= agregar;
            }
          }
          if (lote.length > 0) flush();
        }
      }

      // ---- GUATA y LIENZO ---------------------------------------------------------
      const insumo = (
        tot: number,
        data: ConsInsumoRow[],
        material: 'Guata' | 'Lienzo',
        cons: Map<string, ConsInsumoRow[]>,
        rest: RestInsumoRow[],
        fallback: [string, number][],
        porDefecto: number,
        tiempo: (m: number, n: number, L: number) => number,
      ) => {
        if (!(tot > 0.0 && data.length > 0)) return;
        const tParte = tot / data.length;
        for (const row of data) {
          const L = safeFloat(row.metros);
          if (!(L > 0.001)) continue;
          const maxCapas = this.maxCapasInsumo(modelo, cons, rest, fallback, porDefecto);
          let factor = safeFloat(row.salidas);
          if (factor <= 0.0) factor = 1.0;
          let capasRest = Math.ceil(totalSillones / factor);
          const excedente = capasRest * factor - totalSillones;
          if (excedente > 0) sumar(excedentes, modelo, material, excedente);
          while (capasRest > 0) {
            const nb = Math.min(capasRest, maxCapas);
            lotes.push({
              modelo,
              parte: material,
              material,
              insumo: row.nombre,
              sillones: nb * factor,
              L,
              durT: tiempo(0, nb, L),
              durC: tParte,
              m: 0,
              n: nb,
              procedencia,
            });
            capasRest -= nb;
          }
        }
      };
      insumo(tCncGuataTot, guataData, 'Guata', this.consGuataPorProd, this.b.restGuata, FALLBACK_GUATA, 10, (m, n, L) => this.tGuata(m, n, L));
      insumo(tCncLienzoTot, lienzoData, 'Lienzo', this.consLienzoPorProd, this.b.restLienzo, FALLBACK_LIENZO, 30, (m, n, L) => this.tLienzo(m, n, L));
    }

    // ---- consolidación de registros idénticos ---------------------------------------
    const consolidados: Lote[] = [];
    const gruposCons = new Map<string, Lote[]>();
    for (const lote of lotes) {
      const insumoKey =
        lote.material === 'Tela' ? [...new Set(lote.dfLote!.map((r) => r.tela))].sort(cmpStr).join('|') : (lote.insumo ?? '').toUpperCase().trim();
      const key = [lote.modelo.toUpperCase().trim(), lote.parte.toUpperCase().trim(), lote.material, insumoKey, String(round4(lote.L)), lote.procedencia].join('\u0001');
      const g = gruposCons.get(key);
      if (g) g.push(lote);
      else gruposCons.set(key, [lote]);
    }
    for (const grupo of gruposCons.values()) {
      const repr: Lote = { ...grupo[0]! };
      if (grupo.length === 1) {
        consolidados.push(repr);
        continue;
      }
      if (repr.material === 'Tela') {
        const porTela = new Map<string, FilaLote>();
        for (const g of grupo) {
          for (const r of g.dfLote!) {
            const e = porTela.get(r.tela);
            if (e) {
              e.capas += r.capas;
              e.cant += r.cant;
            } else porTela.set(r.tela, { ...r });
          }
        }
        const filas = [...porTela.values()].sort((a, b) => cmpStr(a.tela, b.tela));
        repr.dfLote = filas;
        repr.n = sumBy(filas, (r) => r.capas);
        repr.m = Math.max(0, filas.length - 1);
        repr.durT = this.tTela(repr.m, repr.n, repr.L);
      } else {
        const totalN = sumBy(grupo, (g) => g.n);
        repr.n = totalN;
        if (repr.sillones !== undefined) repr.sillones = sumBy(grupo, (g) => g.sillones ?? 0);
        repr.durT = repr.material === 'Guata' ? this.tGuata(0, totalN, repr.L) : this.tLienzo(0, totalN, repr.L);
      }
      consolidados.push(repr);
    }

    // ---- cola única por procedencia ---------------------------------------------------------
    const cola: Lote[] = [
      ...this.secuenciarHibrido(consolidados.filter((l) => l.procedencia === 'ATRASADOS')),
      ...this.secuenciarHibrido(consolidados.filter((l) => l.procedencia === 'DIA')),
      ...this.secuenciarHibrido(consolidados.filter((l) => l.procedencia === 'SIGUIENTE')),
    ];

    let tiempoTendido = 0.0;
    let tiempoCnc = 0.0;
    let activos: LoteMesa[] = [];

    const tiempoDisponibleMesa = (L: number, durT: number, startSearch: number): number => {
      const eventos = new Set<number>([startSearch]);
      for (const lot of activos) if (lot.endC >= startSearch) eventos.add(lot.endC);
      for (let tCand of [...eventos].sort((a, b) => a - b)) {
        tCand = this.saltarDesayuno(tCand);
        const tCandEnd = this.finConDesayuno(tCand, durT);

        let colision = false;
        const puntosSet = new Set<number>([tCand, tCandEnd]);
        for (const lot of activos) {
          if (tCand < lot.startT && lot.startT < tCandEnd) puntosSet.add(lot.startT);
          if (tCand < lot.endC && lot.endC < tCandEnd) puntosSet.add(lot.endC);
        }
        const puntos = [...puntosSet].sort((a, b) => a - b);
        for (let i = 0; i < puntos.length - 1; i++) {
          const midT = puntos[i]! + 0.001;
          const midD = Math.floor(midT / MINUTOS_TURNO) + 1;
          const mbStart = (midD - 1) * MINUTOS_TURNO + DESAYUNO_INI;
          const mbEnd = (midD - 1) * MINUTOS_TURNO + DESAYUNO_FIN;
          if (mbStart <= midT && midT < mbEnd) continue;
          let ocupacion = 0.0;
          for (const lot of activos) if (lot.startT <= midT && midT < lot.endC) ocupacion += lot.L;
          if (ocupacion + L > MESA_LARGO_MAX) {
            colision = true;
            break;
          }
        }
        if (!colision) return tCand;
      }
      return this.saltarDesayuno(startSearch);
    };

    const programar = (e: Lote, startT: number, endT: number, startC: number, endC: number) => {
      if (startC > tiempoCnc && tiempoCnc > 0) {
        let ocio = startC - tiempoCnc;
        for (let dChk = Math.floor(tiempoCnc / MINUTOS_TURNO) + 1; dChk < Math.floor(startC / MINUTOS_TURNO) + 2; dChk++) {
          const bStart = (dChk - 1) * MINUTOS_TURNO + DESAYUNO_INI;
          const bEnd = (dChk - 1) * MINUTOS_TURNO + DESAYUNO_FIN;
          const ovStart = Math.max(bStart, tiempoCnc);
          const ovEnd = Math.min(bEnd, startC);
          if (ovStart < ovEnd) ocio -= ovEnd - ovStart;
        }
        if (ocio > 0.001) {
          this.bitacora.push(`⏱️ TIEMPO DE OCIO CNC: ${pyFixed(ocio, 1)} min de espera en corte antes de '${e.modelo}' (${e.material}) por retardo en Tendido.`);
        }
      }
      tiempoTendido = endT;
      tiempoCnc = endC;
      activos.push({ startT, endT, startC, endC, L: e.L });
      this.mesaOcupacion.push({ L: e.L, iniT: startT, iniC: startC, finC: endC });

      if (e.material === 'Tela') {
        const df = e.dfLote!;
        for (const tela of uniqueInOrder(df.map((r) => r.tela))) {
          const dT = df.filter((r) => r.tela === tela);
          const cCapas = Math.trunc(sumBy(dT, (r) => r.capas));
          const cS = Math.trunc(sumBy(dT, (r) => r.cant));
          this.plan.push({ proceso: 'T', inicio: startT, fin: endT, modelo: e.modelo, parte: e.parte, insumo: tela, sillones: cS, capas: cCapas, metros: e.L, tipoMaterial: 'Tela', m: e.m, procedencia: e.procedencia });
          this.plan.push({ proceso: 'C', inicio: startC, fin: endC, modelo: e.modelo, parte: e.parte, insumo: `Corte ${tela}`, sillones: cS, capas: cCapas, metros: e.L, tipoMaterial: 'Tela', m: e.m, procedencia: e.procedencia });

          let tArmadoU = 0.0;
          const armado = this.armadoPorNombre.get(e.modelo);
          if (armado) for (const seg of armado.segEst.slice(0, 9)) tArmadoU += segAMin(seg);

          if (tArmadoU > 0) {
            const minimo = Math.min(...this.tArmadores);
            const op = this.tArmadores.indexOf(minimo);
            const iniA = this.saltarDesayuno(Math.max(endC, this.tArmadores[op]!));
            const durA = cS * tArmadoU;
            const endA = this.finConDesayuno(iniA, durA);
            this.tArmadores[op] = endA;
            this.plan.push({ proceso: 'A', inicio: iniA, fin: endA, modelo: e.modelo, parte: `OP ${op + 1}`, insumo: 'Kit Costura', sillones: cS, capas: '-', metros: '-', tipoMaterial: 'Armado', m: 0, procedencia: e.procedencia });
          }
        }
      } else {
        this.plan.push({ proceso: 'T', inicio: startT, fin: endT, modelo: e.modelo, parte: e.parte, insumo: e.insumo ?? '', sillones: e.sillones ?? 0, capas: e.n, metros: e.L, tipoMaterial: e.material, m: 0, procedencia: e.procedencia });
        this.plan.push({ proceso: 'C', inicio: startC, fin: endC, modelo: e.modelo, parte: e.parte, insumo: `Corte ${e.insumo ?? ''}`, sillones: e.sillones ?? 0, capas: e.n, metros: e.L, tipoMaterial: e.material, m: 0, procedencia: e.procedencia });
      }
    };

    let diaActual = 1;
    let diasSinProgreso = 0;

    while (cola.length > 0) {
      const shiftStart = (diaActual - 1) * MINUTOS_TURNO;
      const shiftEnd = diaActual * MINUTOS_TURNO;
      if (tiempoTendido < shiftStart) tiempoTendido = shiftStart;
      if (tiempoCnc < shiftStart) tiempoCnc = shiftStart;

      const esPrimeraHora = Math.max(tiempoTendido, tiempoCnc) < shiftStart + 60;

      let elegido: Lote | null = null;
      let elegidoIdx = -1;

      let excepcionGuataSiguiente = false;
      if (diaActual === 1 && esPrimeraHora) {
        const sumGuataHoy = sumBy(
          cola.filter((l) => l.material === 'Guata' && (l.procedencia === 'ATRASADOS' || l.procedencia === 'DIA')),
          (l) => l.durT,
        );
        if (sumGuataHoy < 60.0) excepcionGuataSiguiente = true;
      }

      if (esPrimeraHora) {
        elegidoIdx = cola.findIndex((l) => l.material === 'Guata' && (l.procedencia === 'ATRASADOS' || l.procedencia === 'DIA'));
        if (elegidoIdx < 0 && excepcionGuataSiguiente) {
          elegidoIdx = cola.findIndex((l) => l.material === 'Guata' && l.procedencia === 'SIGUIENTE');
        }
        if (elegidoIdx >= 0) elegido = cola[elegidoIdx]!;
      }

      if (elegido === null) {
        elegidoIdx = cola.findIndex((l) => !(diaActual === 1 && l.material === 'Guata' && l.procedencia === 'SIGUIENTE'));
        if (elegidoIdx >= 0) elegido = cola[elegidoIdx]!;
      }

      if (elegido === null) {
        this.bitacora.push(`⏱️ CIERRE DE JORNADA ${diaActual} PARCIAL: No quedan lotes viables para procesar hoy. Se transfiere el remanente al Día ${diaActual + 1}.`);
        diaActual += 1;
        activos = [];
        continue;
      }

      const pStartT = this.saltarDesayuno(Math.max(tiempoTendido, tiempoDisponibleMesa(elegido.L, elegido.durT, tiempoTendido)));
      const pEndT = this.finConDesayuno(pStartT, elegido.durT);
      const pStartC = this.saltarDesayuno(Math.max(pEndT, tiempoCnc));
      const pEndC = this.finConDesayuno(pStartC, elegido.durC);

      if (pEndC > shiftEnd) {
        // DIFERENCIA: el Python repetía esto para siempre con un lote más largo que una jornada.
        if (diasSinProgreso >= 2) {
          this.bitacora.push(`⚠️ El lote de '${elegido.modelo}' (${elegido.material}) dura más que una jornada completa; se programa cruzando días.`);
        } else {
          this.bitacora.push(`⏱️ CIERRE DE JORNADA ${diaActual}: CNC cerrado por límite de turno. El lote de '${elegido.modelo}' (${elegido.material}) se transfiere al Día ${diaActual + 1}.`);
          diaActual += 1;
          diasSinProgreso += 1;
          activos = [];
          continue;
        }
      }

      diasSinProgreso = 0;
      cola.splice(elegidoIdx, 1);

      if (diaActual === 1 && elegido.procedencia === 'SIGUIENTE') {
        const cant = elegido.material === 'Tela' ? sumBy(elegido.dfLote!, (r) => r.cant) : (elegido.sillones ?? 0.0);
        sumar(adelantosDia1, elegido.modelo, elegido.material, cant);
      }

      programar(elegido, pStartT, pEndT, pStartC, pEndC);
    }

    if (excedentes.size > 0) {
      this.bitacora.push('📦 EXCEDENTES DE STOCK GENERADOS POR PLANIFICACIÓN JIT (Redondeo de Tendidas):');
      for (const { modelo, material, cant } of excedentes.values()) {
        if (cant > 0.001) this.bitacora.push(`   - ${modelo} [${material}]: +${pyFixed(cant, 2)} unidades en stock (excedente de tendida).`);
      }
    }
    if (adelantosDia1.size > 0) {
      this.bitacora.push('Adelantos para optimizar cortes en el CNC');
      for (const { modelo, material, cant } of adelantosDia1.values()) {
        this.bitacora.push(`    - ${modelo} [${material}]: ${pyFixed(cant, 2)} unidades (optimizar corte).`);
      }
    }

    return {
      plan: this.plan,
      bitacora: this.bitacora,
      alertasPlanillas: this.alertasPlanillas,
      tTendido: tiempoTendido,
      tCnc: tiempoCnc,
      tArmadores: this.tArmadores,
      mesa: this.mesaOcupacion,
    };
  }

  /** `secuenciar_hibrido`: ordena los lotes alternando livianos y pesados para no frenar el CNC, y agrupa BASE/ALM de un mismo juego. */
  private secuenciarHibrido(lotes: Lote[]): Lote[] {
    const prioridad = new Map<number, Lote[]>();
    for (const l of lotes) {
      const p = l.material === 'Guata' ? 1 : l.material === 'Tela' || l.material === 'Lienzo' ? 2 : 3;
      const g = prioridad.get(p);
      if (g) g.push(l);
      else prioridad.set(p, [l]);
    }

    let secuencia: Lote[] = [];
    for (const prio of [...prioridad.keys()].sort((a, b) => a - b)) {
      const grupo = prioridad.get(prio)!;
      const fast = grupo.filter((l) => l.durT < l.durC).sort((a, b) => a.durT - b.durT);
      const heavy = grupo.filter((l) => l.durT >= l.durC).sort((a, b) => b.durT - a.durT);

      let simCnc = 0.0;
      let simTendido = 0.0;
      while (fast.length > 0 || heavy.length > 0) {
        let l: Lote;
        if (heavy.length > 0) {
          const buffer = simCnc - simTendido;
          if (buffer >= heavy[0]!.durT || fast.length === 0) l = heavy.shift()!;
          else l = fast.shift()!;
        } else {
          l = fast.shift()!;
        }
        secuencia.push(l);
        simTendido += l.durT;
        simCnc = Math.max(simTendido, simCnc) + l.durC;
      }
    }

    // Adyacencia atómica de juegos [BASE, ALM, ALM2]
    const esJuego = (parte: string) => ['BASE', 'ALM', 'ALM2'].some((x) => parte.includes(x));
    const agrupada: Lote[] = [];
    const visitado = new Set<number>();
    secuencia.forEach((lot, i) => {
      if (visitado.has(i)) return;
      agrupada.push(lot);
      visitado.add(i);
      const modeloActual = lot.modelo.toUpperCase().trim();
      if (lot.material === 'Tela' && esJuego(lot.parte.toUpperCase().trim())) {
        for (let j = i + 1; j < secuencia.length; j++) {
          if (visitado.has(j)) continue;
          const s = secuencia[j]!;
          if (s.material === 'Tela' && s.modelo.toUpperCase().trim() === modeloActual && esJuego(s.parte.toUpperCase().trim())) {
            agrupada.push(s);
            visitado.add(j);
          }
        }
      }
    });
    secuencia = agrupada;
    return secuencia;
  }
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

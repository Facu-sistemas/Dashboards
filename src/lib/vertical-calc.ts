import type { CorteSpec, BlockSpec, DemandaRow } from './odoo/vertical';
import { COLOR_DE_RETAZO } from './odoo/vertical';

/** Debajo de esto un remanente no es sobrante aprovechable — es scrap y se descarta (indicación del usuario: la cortadora no corta finos menores a 3cm). */
export const ESPESOR_MINIMO_CM = 3;

export interface PiezaNecesaria {
  producto: string;
  colorBlock: string;
  corteAnchoCm: number;
  corteLargoCm: number;
  corteAltoCm: number;
  ubicacion: string;
}

/**
 * El nombre del producto terminado en `mrp.production` casi nunca coincide
 * letra por letra con `nombre_producto` de COMPLETO — confirmado en vivo
 * (2026-09): Odoo agrega el prefijo "PIP2", la palabra "SOFA"/"SOFA CAMA",
 * sufijos de variante entre paréntesis (color/tela, ej. "(-29)", "(STD)") y
 * a veces "CPO" donde COMPLETO no lo lleva. Se normaliza sacando todo eso
 * antes de comparar. Esto NO resuelve todos los casos — hay familias de
 * sillón que directamente no están en COMPLETO (quedan en `sinMatch`, que
 * la UI muestra para revisar a mano) y variantes con sufijos propios (ej.
 * "INV" invertido, "CONJ" vs "CONJUNTO") que pueden necesitar agregarse acá
 * a medida que se detecten.
 */
const NOISE_TOKENS = new Set(['SOFA', 'STD', 'CAMA', 'CPO', 'CPOS']);

export function normalizeProductoKey(raw: string): string {
  const sinRuido = raw.replace(/PIP2/gi, '').replace(/\([^)]*\)/g, '');
  const norm = sinRuido
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/(\d)([A-Z])/g, '$1 $2')
    .replace(/([A-Z])(\d)/g, '$1 $2')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return norm
    .split(' ')
    .filter((t) => !NOISE_TOKENS.has(t))
    .join(' ');
}

export interface NecesidadResult {
  /** Piezas por color, en el orden en que aparecen en COMPLETO (una entrada por unidad a cortar). */
  piezasPorColor: Map<string, PiezaNecesaria[]>;
  /** Productos demandados que no matchean ningún nombre_producto de COMPLETO. */
  sinMatch: string[];
}

/** Junta la demanda del día con COMPLETO: por cada producto demandado, multiplica cant_placas x cantidad y arma la lista de piezas a cortar por color (ignorando "DE RETAZO"). */
export function construirNecesidad(demanda: DemandaRow[], cortes: CorteSpec[]): NecesidadResult {
  const cortesPorProducto = new Map<string, CorteSpec[]>();
  for (const c of cortes) {
    const key = normalizeProductoKey(c.nombreProducto);
    const arr = cortesPorProducto.get(key) ?? [];
    arr.push(c);
    cortesPorProducto.set(key, arr);
  }

  const piezasPorColor = new Map<string, PiezaNecesaria[]>();
  const sinMatch: string[] = [];

  for (const d of demanda) {
    const filas = cortesPorProducto.get(normalizeProductoKey(d.producto));
    if (!filas || filas.length === 0) {
      sinMatch.push(d.producto);
      continue;
    }
    for (const fila of filas) {
      if (fila.colorBlock === COLOR_DE_RETAZO) continue;
      const cantidadPiezas = Math.round(fila.cantPlacas * d.cantidad);
      const arr = piezasPorColor.get(fila.colorBlock) ?? [];
      for (let i = 0; i < cantidadPiezas; i++) {
        arr.push({
          producto: d.producto,
          colorBlock: fila.colorBlock,
          corteAnchoCm: fila.corteAnchoCm,
          corteLargoCm: fila.corteLargoCm,
          corteAltoCm: fila.corteAltoCm,
          ubicacion: fila.ubicacion,
        });
      }
      piezasPorColor.set(fila.colorBlock, arr);
    }
  }

  return { piezasPorColor, sinMatch };
}

export interface SobranteDisponible {
  id: string;
  colorBlock: string;
  anchoBlockCm: number;
  largoBlockCm: number;
  altoDisponibleCm: number;
  origenFecha: string;
}

export interface BlockCargado {
  colorBlock: string;
  anchoBlockCm: number;
  largoBlockCm: number;
  altoBlockCm: number;
  densidadBlock: number;
  cantidad: number;
}

export interface PiezaEstado extends PiezaNecesaria {
  cubierta: boolean;
  /** true si corte_largo_cm/corte_alto_cm no entran en la cara del block elegido — advertencia, no bloquea el cálculo. */
  advertenciaNoEntra: boolean;
}

export interface CoberturaColor {
  colorBlock: string;
  piezas: PiezaEstado[];
  espesorNecesarioCm: number;
  espesorDisponibleCm: number;
  faltanteCm: number;
  /** Sobrante final, ya descontado el mínimo de corte — null si no queda nada aprovechable. */
  sobranteResultanteCm: number | null;
  sobrantesConsumidosIds: string[];
  /** Cara del block que produjo el sobrante resultante (del block recién cargado, o del sobrante previo si no se cargó ninguno) — null si no hay ninguna referencia. */
  caraReferencia: { anchoBlockCm: number; largoBlockCm: number } | null;
}

/**
 * Para un color: apila el espesor disponible (sobrantes existentes, FIFO por
 * fecha, primero) + los blocks recién cargados, lo compara contra el
 * espesor total necesario (suma de corte_ancho_cm de cada pieza) y marca
 * qué piezas quedan cubiertas (en orden) y cuáles faltan.
 */
export function calcularCobertura(
  colorBlock: string,
  piezas: PiezaNecesaria[],
  sobrantesDisponibles: SobranteDisponible[],
  bloquesCargados: BlockCargado[]
): CoberturaColor {
  const sobrantesDelColor = sobrantesDisponibles
    .filter((s) => s.colorBlock === colorBlock)
    .sort((a, b) => a.origenFecha.localeCompare(b.origenFecha));

  const espesorNecesarioCm = piezas.reduce((sum, p) => sum + p.corteAnchoCm, 0);

  let espesorDisponibleCm = 0;
  const sobrantesConsumidosIds: string[] = [];
  for (const s of sobrantesDelColor) {
    espesorDisponibleCm += s.altoDisponibleCm;
    sobrantesConsumidosIds.push(s.id);
  }
  for (const b of bloquesCargados) {
    if (b.colorBlock !== colorBlock) continue;
    espesorDisponibleCm += b.altoBlockCm * b.cantidad;
  }

  // Cara de referencia para el check de "entra en el block": la variante cargada más grande (si hay varias mezcladas), o la del sobrante más reciente si no se cargó ningún block nuevo.
  const caraReferencia =
    bloquesCargados.find((b) => b.colorBlock === colorBlock) ??
    (sobrantesDelColor.length > 0
      ? { anchoBlockCm: sobrantesDelColor[0]!.anchoBlockCm, largoBlockCm: sobrantesDelColor[0]!.largoBlockCm }
      : undefined);

  let acumulado = 0;
  const piezasEstado: PiezaEstado[] = piezas.map((p) => {
    acumulado += p.corteAnchoCm;
    const cubierta = acumulado <= espesorDisponibleCm;
    const advertenciaNoEntra = caraReferencia ? p.corteLargoCm > caraReferencia.anchoBlockCm || p.corteAltoCm > caraReferencia.largoBlockCm : false;
    return { ...p, cubierta, advertenciaNoEntra };
  });

  const faltanteCm = Math.max(0, espesorNecesarioCm - espesorDisponibleCm);
  const sobranteBrutoCm = Math.max(0, espesorDisponibleCm - espesorNecesarioCm);
  const sobranteResultanteCm = sobranteBrutoCm >= ESPESOR_MINIMO_CM ? sobranteBrutoCm : null;

  return {
    colorBlock,
    piezas: piezasEstado,
    espesorNecesarioCm,
    espesorDisponibleCm,
    faltanteCm,
    sobranteResultanteCm,
    sobrantesConsumidosIds,
    caraReferencia: caraReferencia ?? null,
  };
}

/** Variantes de block disponibles para un color (para poblar el selector de "qué block cargué"). */
export function variantesPorColor(blocks: BlockSpec[], colorBlock: string): BlockSpec[] {
  return blocks.filter((b) => b.colorBlock === colorBlock);
}

export interface CapaBarra {
  pieza: PiezaNecesaria;
  advertenciaNoEntra: boolean;
}

export interface BarraCorte {
  id: string;
  origen: 'sobrante' | 'block';
  alturaCm: number;
  anchoBlockCm: number;
  largoBlockCm: number;
  capas: CapaBarra[];
  /** Espacio sin usar en ESTA barra puntual (al final de sus capas) — solo el de la última barra tocada es lo que termina siendo el sobrante real del día. */
  sobranteCm: number;
}

export interface DistribucionBarras {
  barras: BarraCorte[];
  /** Piezas que no entraron en ninguna barra disponible — mismo total que `faltanteCm` de calcularCobertura, pero acá vienen individualizadas. */
  piezasSinAsignar: PiezaNecesaria[];
}

/**
 * Reparte la secuencia de piezas de un color, en orden, sobre las barras
 * físicas disponibles (primero los sobrantes de días anteriores —FIFO por
 * fecha—, después los blocks recién cargados en el orden en que se
 * agregaron). Cada barra representa un block real parado, así que una pieza
 * nunca se reparte entre dos barras: si no entra en la barra actual, esa
 * barra queda cerrada (su resto sin usar es scrap de esa barra puntual) y
 * se pasa a la siguiente. Pensado para alimentar la visualización tipo
 * Multicorte (una columna apilada por barra), no para el cálculo agregado
 * de sobrante/falta (eso lo sigue resolviendo calcularCobertura).
 */
export function distribuirEnBarras(colorBlock: string, piezas: PiezaNecesaria[], sobrantesDisponibles: SobranteDisponible[], bloquesCargados: BlockCargado[]): DistribucionBarras {
  const sobrantesDelColor = sobrantesDisponibles.filter((s) => s.colorBlock === colorBlock).sort((a, b) => a.origenFecha.localeCompare(b.origenFecha));

  const barras: BarraCorte[] = [
    ...sobrantesDelColor.map((s) => ({
      id: s.id,
      origen: 'sobrante' as const,
      alturaCm: s.altoDisponibleCm,
      anchoBlockCm: s.anchoBlockCm,
      largoBlockCm: s.largoBlockCm,
      capas: [],
      sobranteCm: s.altoDisponibleCm,
    })),
    ...bloquesCargados
      .filter((b) => b.colorBlock === colorBlock)
      .flatMap((b, bi) =>
        Array.from({ length: b.cantidad }, (_, i) => ({
          id: `block-${bi}-${i}`,
          origen: 'block' as const,
          alturaCm: b.altoBlockCm,
          anchoBlockCm: b.anchoBlockCm,
          largoBlockCm: b.largoBlockCm,
          capas: [] as CapaBarra[],
          sobranteCm: b.altoBlockCm,
        }))
      ),
  ];

  let barraIdx = 0;
  const piezasSinAsignar: PiezaNecesaria[] = [];

  for (const pieza of piezas) {
    while (barraIdx < barras.length && barras[barraIdx]!.sobranteCm < pieza.corteAnchoCm) {
      barraIdx++;
    }
    if (barraIdx >= barras.length) {
      piezasSinAsignar.push(pieza);
      continue;
    }
    const barra = barras[barraIdx]!;
    const advertenciaNoEntra = pieza.corteLargoCm > barra.anchoBlockCm || pieza.corteAltoCm > barra.largoBlockCm;
    barra.capas.push({ pieza, advertenciaNoEntra });
    barra.sobranteCm -= pieza.corteAnchoCm;
  }

  return { barras, piezasSinAsignar };
}

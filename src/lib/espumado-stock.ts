import { BLOQUES_CATALOGO, bloqueKey } from './espumado-catalogo';
import type { EspumadoDiaRow } from './supabase/espumado-dia';
import type { EspumadoResult } from './odoo/espumado';

export interface EspumadoStockFila {
  tipo: string;
  medida: string;
  kgUnidad: number;
  /** Stock inicial efectivo del día: el conteo manual si hay, si no el final del día anterior. */
  inicial: number;
  /** Final del día anterior (lo que arrastra si no hay conteo manual). */
  inicialAuto: number;
  inicialManual: boolean;
  produccion: number;
  colchones: number;
  living: number;
  venta: number;
  noConforme: number;
  final: number;
}

export interface EspumadoControlTipo {
  tipo: string;
  odoo: string | null;
  finalUnidades: number;
  /** Unidades × kg/unidad de la tabla de medidas. */
  finalKg: number;
  odooStockKg: number | null;
  produccionKg: number;
  odooProduccionKg: number | null;
  consumoKg: number;
  odooConsumoKg: number | null;
  ventaKg: number;
  odooVentaKg: number | null;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Saldo por tipo y medida al cierre de `fecha`: cada conteo manual (stock_inicial) reinicia el arrastre; los movimientos de días anteriores lo van moviendo. */
export function calcularFilas(rows: EspumadoDiaRow[], fecha: string): EspumadoStockFila[] {
  const porKey = new Map<string, EspumadoDiaRow[]>();
  for (const r of rows) {
    if (r.fecha > fecha) continue;
    const k = bloqueKey(r.tipo, r.medida);
    const lista = porKey.get(k);
    if (lista) lista.push(r);
    else porKey.set(k, [r]);
  }

  return BLOQUES_CATALOGO.map((b) => {
    const lista = (porKey.get(bloqueKey(b.tipo, b.medida)) ?? []).sort((x, y) => x.fecha.localeCompare(y.fecha));
    let corriendo = 0;
    for (const r of lista) {
      if (r.fecha >= fecha) continue;
      if (r.stockInicial !== null) corriendo = r.stockInicial;
      corriendo += r.produccion - r.colchones - r.living - r.venta - r.noConforme;
    }
    const hoy = lista.find((r) => r.fecha === fecha);
    const manual = hoy?.stockInicial != null;
    const inicial = manual ? hoy!.stockInicial! : corriendo;
    const mov = {
      produccion: hoy?.produccion ?? 0,
      colchones: hoy?.colchones ?? 0,
      living: hoy?.living ?? 0,
      venta: hoy?.venta ?? 0,
      noConforme: hoy?.noConforme ?? 0,
    };
    return {
      tipo: b.tipo,
      medida: b.medida,
      kgUnidad: b.kgUnidad,
      inicial,
      inicialAuto: corriendo,
      inicialManual: manual,
      ...mov,
      final: inicial + mov.produccion - mov.colchones - mov.living - mov.venta - mov.noConforme,
    };
  });
}

/** Cruza lo cargado a mano en `fecha` (en kg) con lo que Odoo registró ese día y con su stock al cierre de ese día. */
export function calcularControl(filas: EspumadoStockFila[], odoo: EspumadoResult, fecha: string): EspumadoControlTipo[] {
  const tipos = [...new Set(BLOQUES_CATALOGO.map((b) => b.tipo))];
  return tipos.map((tipo) => {
    const propias = filas.filter((f) => f.tipo === tipo);
    const nombreOdoo = BLOQUES_CATALOGO.find((b) => b.tipo === tipo)?.odoo ?? null;
    const prod = nombreOdoo ? odoo.tipos.find((x) => x.nombre === nombreOdoo) : undefined;

    const kg = (sel: (f: EspumadoStockFila) => number) => r2(propias.reduce((a, f) => a + sel(f) * f.kgUnidad, 0));

    let odooStock: number | null = null;
    let dia: { produccion: number; consumo: number; venta: number } | null = null;
    if (prod) {
      const serie = odoo.serieTipos[prod.id] ?? [];
      // Stock de Odoo al cierre de `fecha` = stock actual − neto de los días posteriores.
      const posterior = serie
        .filter((d) => d.fecha > fecha)
        .reduce((a, d) => a + d.produccion - d.consumo - d.venta + d.ajuste, 0);
      odooStock = r2(prod.stockKg - posterior);
      const d = serie.find((x) => x.fecha === fecha);
      dia = { produccion: d?.produccion ?? 0, consumo: d?.consumo ?? 0, venta: d?.venta ?? 0 };
    }

    return {
      tipo,
      odoo: nombreOdoo,
      finalUnidades: propias.reduce((a, f) => a + f.final, 0),
      finalKg: kg((f) => f.final),
      odooStockKg: odooStock,
      produccionKg: kg((f) => f.produccion),
      odooProduccionKg: dia ? r2(dia.produccion) : null,
      consumoKg: kg((f) => f.colchones + f.living),
      odooConsumoKg: dia ? r2(dia.consumo) : null,
      ventaKg: kg((f) => f.venta),
      odooVentaKg: dia ? r2(dia.venta) : null,
    };
  });
}

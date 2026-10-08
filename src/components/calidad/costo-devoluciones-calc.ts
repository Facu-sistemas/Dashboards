import type { Causa, CostoDevolucionesData, DevolucionRegistro, SectorDevolucion } from '../../lib/odoo/costo-devoluciones';
import type { TarifasGuardadas, TarifasMes } from '../../lib/supabase/costo-devoluciones-tarifas';

/** Cálculo compartido entre la pantalla y el PDF — sin dependencias de servidor. */

export interface Filtros {
  mes: string;
  sector: 'todos' | SectorDevolucion;
  /** 0 = todas las empresas. */
  empresa: number;
}

export const CAUSAS: Causa[] = ['calidad', 'logistica', 'transporte', 'postventa', 'sinmotivo'];

export const CAUSA_LABEL: Record<Causa, string> = {
  calidad: 'Calidad',
  logistica: 'Error propio (carga / pedido)',
  transporte: 'Transporte',
  postventa: 'Post-venta',
  sinmotivo: 'Sin motivo cargado',
};

export const CAUSA_AYUDA: Record<Causa, string> = {
  calidad: 'Falla de producto: el producto vuelve y no se recupera.',
  logistica: 'Error de carga, de pedido o de facturación: lo pagamos nosotros.',
  transporte: 'Se rompió en el viaje: se le factura al transportista.',
  postventa: 'Servicio al cliente (retapizar, etc.): se le factura al cliente.',
  sinmotivo: 'En Odoo no se eligió el motivo, no se puede clasificar.',
};

export type FuenteFlete = 'tarifa' | 'recargo' | 'sin-dato' | 'no-aplica';

/** Un caso ya costeado con las tarifas del mes. */
export interface CasoCalculado extends DevolucionRegistro {
  flete: number;
  fuenteFlete: FuenteFlete;
  manoObra: number;
  /** flete + mano de obra + material */
  bruto: number;
  /** bruto − lo facturado a otro */
  neto: number;
}

export interface Montos {
  casos: number;
  horas: number;
  flete: number;
  manoObra: number;
  material: number;
  bruto: number;
  facturado: number;
  neto: number;
}

export interface FilaProvincia extends Montos {
  provincia: string;
  living: number;
  colchon: number;
  dev: number;
  notaCredito: number;
  /** Recargo promedio (%) de los clientes del caso, o null si ninguno tiene región. */
  recargoPct: number | null;
}

export interface Indice {
  devoluciones: number;
  unidades: number;
  porMil: number | null;
}

export interface CalidadDatos {
  sinMotivo: number;
  /** Reparaciones terminadas sin horas cargadas. */
  sinHoras: number;
  /** Transporte / post-venta sin venta vinculada: no se sabe cuánto se recuperó. */
  sinVincular: number;
  /** Casos que cuentan pero sin tarifa de la provincia ni región del cliente: el flete queda en 0. */
  sinFlete: number;
}

export interface Resultado {
  casos: CasoCalculado[];
  filas: FilaProvincia[];
  porCausa: Record<Causa, Montos>;
  totales: Montos & { living: number; colchon: number; dev: number; notaCredito: number };
  living: Indice;
  colchon: Indice;
  unidades: number;
  /** Costo neto por unidad fabricada ($), o null si no hay producción. */
  netoPorUnidad: number | null;
  datos: CalidadDatos;
}

const indice = (devoluciones: number, unidades: number): Indice => ({
  devoluciones,
  unidades,
  porMil: unidades > 0 ? (devoluciones / unidades) * 1000 : null,
});

export const positivo = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

const montosVacios = (): Montos => ({ casos: 0, horas: 0, flete: 0, manoObra: 0, material: 0, bruto: 0, facturado: 0, neto: 0 });

function sumar(m: Montos, c: CasoCalculado) {
  m.casos++;
  m.horas += c.horas;
  m.flete += c.flete;
  m.manoObra += c.manoObra;
  m.material += c.material;
  m.bruto += c.bruto;
  m.facturado += c.facturado;
  m.neto += c.neto;
}

export function costearCaso(r: DevolucionRegistro, t: TarifasMes): CasoCalculado {
  const viajes = positivo(t.viajes);
  let flete = 0;
  let fuenteFlete: FuenteFlete = 'no-aplica';
  // Las reparaciones de Colchón cuelgan de una nota de crédito que ya lleva su flete.
  if (r.cuenta) {
    const tarifa = positivo(t.fletes[r.provincia]);
    if (tarifa > 0) {
      flete = viajes * tarifa;
      fuenteFlete = 'tarifa';
    } else if (r.recargoPct !== null && r.baseFlete > 0) {
      flete = viajes * (r.recargoPct / 100) * r.baseFlete;
      fuenteFlete = 'recargo';
    } else {
      fuenteFlete = 'sin-dato';
    }
  }
  const manoObra = r.horas * positivo(t.costoHora);
  const bruto = flete + manoObra + r.material;
  return { ...r, flete, fuenteFlete, manoObra, bruto, neto: bruto - r.facturado };
}

export function calcular(data: CostoDevolucionesData, f: Filtros, t: TarifasMes): Resultado {
  const sectorOk = (s: SectorDevolucion) => f.sector === 'todos' || f.sector === s;
  const empresaOk = (e: number) => f.empresa === 0 || f.empresa === e;

  const casos: CasoCalculado[] = [];
  for (const r of data.registros) {
    if (r.mes === f.mes && sectorOk(r.sector) && empresaOk(r.empresa)) casos.push(costearCaso(r, t));
  }
  casos.sort((a, b) => b.neto - a.neto);

  const porCausa = Object.fromEntries(CAUSAS.map((c) => [c, montosVacios()])) as Record<Causa, Montos>;
  const porProvincia = new Map<string, FilaProvincia & { _recSum: number; _recN: number }>();
  const devSector = { living: 0, colchon: 0 };
  const total = montosVacios();
  const extra = { living: 0, colchon: 0, dev: 0, notaCredito: 0 };
  const datos: CalidadDatos = { sinMotivo: 0, sinHoras: 0, sinVincular: 0, sinFlete: 0 };

  for (const c of casos) {
    const fila =
      porProvincia.get(c.provincia) ??
      { ...montosVacios(), provincia: c.provincia, living: 0, colchon: 0, dev: 0, notaCredito: 0, recargoPct: null, _recSum: 0, _recN: 0 };
    sumar(fila, c);
    sumar(porCausa[c.causa], c);
    sumar(total, c);
    fila.notaCredito += c.notaCredito;
    extra.notaCredito += c.notaCredito;
    if (c.cuenta) {
      fila[c.sector]++;
      fila.dev++;
      devSector[c.sector]++;
      extra[c.sector]++;
      extra.dev++;
    }
    if (c.recargoPct !== null) {
      fila._recSum += c.recargoPct;
      fila._recN++;
    }
    porProvincia.set(c.provincia, fila);

    if (c.causa === 'sinmotivo') datos.sinMotivo++;
    if (c.origen === 'reparacion' && c.horas <= 0) datos.sinHoras++;
    if (c.origen === 'reparacion' && (c.causa === 'transporte' || c.causa === 'postventa') && !c.vinculado) datos.sinVincular++;
    if (c.fuenteFlete === 'sin-dato') datos.sinFlete++;
  }

  const filas: FilaProvincia[] = [...porProvincia.values()]
    .map(({ _recSum, _recN, ...fila }) => ({ ...fila, recargoPct: _recN > 0 ? _recSum / _recN : null }))
    .sort((a, b) => b.neto - a.neto || b.dev - a.dev);

  const unidades = { living: 0, colchon: 0 };
  for (const p of data.produccion) {
    if (p.mes === f.mes && empresaOk(p.empresa)) unidades[p.sector] += p.unidades;
  }
  const unidadesTotal = (f.sector !== 'colchon' ? unidades.living : 0) + (f.sector !== 'living' ? unidades.colchon : 0);

  return {
    casos,
    filas,
    porCausa,
    totales: { ...total, ...extra },
    living: indice(devSector.living, unidades.living),
    colchon: indice(devSector.colchon, unidades.colchon),
    unidades: unidadesTotal,
    netoPorUnidad: unidadesTotal > 0 ? total.neto / unidadesTotal : null,
    datos,
  };
}

/** Tarifas que rigen un mes: las guardadas de ese mes o, si no hay, las del último mes anterior guardado. */
export function tarifasDeMes(guardadas: TarifasGuardadas['porMes'], mes: string): { tarifas: TarifasMes; propio: boolean; heredadoDe: string | null } {
  const propio = guardadas[mes];
  const anterior = Object.keys(guardadas)
    .filter((m) => m < mes)
    .sort()
    .pop();
  const fuente = propio ?? (anterior ? guardadas[anterior] : undefined);
  return {
    tarifas: fuente ? { costoHora: fuente.costoHora, viajes: fuente.viajes, fletes: { ...fuente.fletes } } : { costoHora: 0, viajes: 2, fletes: {} },
    propio: Boolean(propio),
    heredadoDe: propio ? null : (anterior ?? null),
  };
}

export interface PuntoMensual {
  mes: string;
  casos: number;
  bruto: number;
  neto: number;
  netoPorUnidad: number | null;
}

/** Costo neto mes a mes (con las tarifas de cada mes) para comparar. Más antiguo primero. */
export function serieMensual(
  data: CostoDevolucionesData,
  f: Omit<Filtros, 'mes'>,
  tarifasPara: (mes: string) => TarifasMes
): PuntoMensual[] {
  return [...data.meses].reverse().map((mes) => {
    const r = calcular(data, { ...f, mes }, tarifasPara(mes));
    return { mes, casos: r.totales.casos, bruto: r.totales.bruto, neto: r.totales.neto, netoPorUnidad: r.netoPorUnidad };
  });
}

export const fmt = (n: number) => n.toLocaleString('es-AR');
export const fmtMonto = (n: number) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
export const fmtMil = (v: number | null) => (v === null ? '—' : v.toLocaleString('es-AR', { maximumFractionDigits: 1 }));
export const fmtHoras = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });
export const fmtPct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`);

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const mesLabel = (mes: string) => `${MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`;
export const mesCorto = (mes: string) => `${MESES[Number(mes.slice(5)) - 1]!.slice(0, 3)} ${mes.slice(2, 4)}`;

export const SECTOR_LABEL: Record<Filtros['sector'], string> = { todos: 'Living y Colchón', living: 'Living', colchon: 'Colchón' };

/** Párrafo-resumen del mes; lo usan la pantalla y el PDF para que digan exactamente lo mismo. */
export function armarResumen(r: Resultado, f: Filtros): string {
  const partes: string[] = [];
  const tot = r.totales;

  if (tot.casos === 0) return `En ${mesLabel(f.mes)} no hubo casos de no calidad con estos filtros.`;

  const indices: string[] = [];
  if (f.sector !== 'colchon') indices.push(`${fmtMil(r.living.porMil)} de Living`);
  if (f.sector !== 'living') indices.push(`${fmtMil(r.colchon.porMil)} de Colchón`);
  partes.push(`En ${mesLabel(f.mes)}, cada 1.000 unidades fabricadas nos volvieron ${indices.join(' y ')}.`);

  if (tot.bruto > 0) {
    const porUnidad = r.netoPorUnidad !== null ? ` (${fmtMonto(r.netoPorUnidad)} por unidad fabricada)` : '';
    partes.push(
      `La no calidad nos costó ${fmtMonto(tot.neto)} netos${porUnidad}: ${fmtMonto(tot.flete)} de flete, ${fmtMonto(tot.manoObra)} de mano de obra (${fmt(Math.round(tot.horas))} horas) y ${fmtMonto(tot.material)} de material y producto perdido` +
        (tot.facturado > 0 ? `, menos ${fmtMonto(tot.facturado)} que se facturaron a transportistas y clientes.` : '.')
    );
    const causas = CAUSAS.filter((c) => r.porCausa[c].casos > 0)
      .sort((a, b) => r.porCausa[b].neto - r.porCausa[a].neto)
      .map((c) => `${CAUSA_LABEL[c].toLowerCase()} ${fmtMonto(r.porCausa[c].neto)} (${fmt(r.porCausa[c].casos)})`);
    partes.push(`Por motivo: ${causas.join(', ')}.`);
  } else {
    partes.push(`Fueron ${fmt(tot.casos)} casos pero todavía no hay tarifas cargadas para costearlos: se dedicaron ${fmt(Math.round(tot.horas))} horas a reparar.`);
  }

  const top = r.filas
    .filter((x) => x.dev > 0)
    .sort((a, b) => b.dev - a.dev)
    .slice(0, 3)
    .map((x) => `${x.provincia} (${fmt(x.dev)})`)
    .join(', ');
  if (top) partes.push(`Las devoluciones vinieron sobre todo de ${top}.`);

  const faltan: string[] = [];
  if (r.datos.sinMotivo > 0) faltan.push(`${fmt(r.datos.sinMotivo)} sin motivo`);
  if (r.datos.sinVincular > 0) faltan.push(`${fmt(r.datos.sinVincular)} de transporte o post-venta sin venta vinculada`);
  if (r.datos.sinHoras > 0) faltan.push(`${fmt(r.datos.sinHoras)} reparaciones sin horas`);
  if (faltan.length > 0) partes.push(`Ojo: ${faltan.join(', ')}; el costo real puede ser distinto.`);
  return partes.join(' ');
}

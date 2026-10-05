import type { CostoDevolucionesData, SectorDevolucion } from '../../lib/odoo/costo-devoluciones';
import type { TarifasMes } from '../../lib/supabase/costo-devoluciones-tarifas';

/** Cálculo compartido entre la pantalla y el PDF — sin dependencias de servidor. */

export interface Filtros {
  mes: string;
  sector: 'todos' | SectorDevolucion;
  /** 0 = todas las empresas. */
  empresa: number;
}

export interface FilaProvincia {
  provincia: string;
  living: number;
  colchon: number;
  dev: number;
  horas: number;
  flete: number;
  reparacion: number;
  costo: number;
  notaCredito: number;
}

export interface Indice {
  devoluciones: number;
  unidades: number;
  porMil: number | null;
}

export interface Resultado {
  filas: FilaProvincia[];
  totales: Omit<FilaProvincia, 'provincia'>;
  living: Indice;
  colchon: Indice;
}

const indice = (devoluciones: number, unidades: number): Indice => ({
  devoluciones,
  unidades,
  porMil: unidades > 0 ? (devoluciones / unidades) * 1000 : null,
});

export const positivo = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

export function calcular(data: CostoDevolucionesData, f: Filtros, t: TarifasMes): Resultado {
  const sectorOk = (s: SectorDevolucion) => f.sector === 'todos' || f.sector === s;
  const empresaOk = (e: number) => f.empresa === 0 || f.empresa === e;

  const porProvincia = new Map<string, FilaProvincia>();
  const devSector = { living: 0, colchon: 0 };

  for (const r of data.registros) {
    if (r.mes !== f.mes || !sectorOk(r.sector) || !empresaOk(r.empresa)) continue;
    const fila =
      porProvincia.get(r.provincia) ??
      { provincia: r.provincia, living: 0, colchon: 0, dev: 0, horas: 0, flete: 0, reparacion: 0, costo: 0, notaCredito: 0 };
    if (r.cuenta) {
      fila[r.sector]++;
      fila.dev++;
      devSector[r.sector]++;
    }
    fila.horas += r.horas;
    fila.notaCredito += r.notaCredito;
    porProvincia.set(r.provincia, fila);
  }

  const unidades = { living: 0, colchon: 0 };
  for (const p of data.produccion) {
    if (p.mes === f.mes && empresaOk(p.empresa)) unidades[p.sector] += p.unidades;
  }

  const totales = { living: 0, colchon: 0, dev: 0, horas: 0, flete: 0, reparacion: 0, costo: 0, notaCredito: 0 };
  const filas = [...porProvincia.values()]
    .map((fila) => {
      fila.flete = fila.dev * positivo(t.viajes) * positivo(t.fletes[fila.provincia]);
      fila.reparacion = fila.horas * positivo(t.costoHora);
      fila.costo = fila.flete + fila.reparacion;
      for (const k of Object.keys(totales) as (keyof typeof totales)[]) totales[k] += fila[k];
      return fila;
    })
    .sort((a, b) => b.dev - a.dev || b.horas - a.horas);

  return {
    filas,
    totales,
    living: indice(devSector.living, unidades.living),
    colchon: indice(devSector.colchon, unidades.colchon),
  };
}

export const fmt = (n: number) => n.toLocaleString('es-AR');
export const fmtMonto = (n: number) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
export const fmtMil = (v: number | null) => (v === null ? '—' : v.toLocaleString('es-AR', { maximumFractionDigits: 1 }));
export const fmtHoras = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const mesLabel = (mes: string) => `${MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`;

export const SECTOR_LABEL: Record<Filtros['sector'], string> = { todos: 'Living y Colchón', living: 'Living', colchon: 'Colchón' };

/** Párrafo-resumen del mes; lo usan la pantalla y el PDF para que digan exactamente lo mismo. */
export function armarResumen(r: Resultado, f: Filtros, t: TarifasMes): string {
  const partes: string[] = [];

  const indices: string[] = [];
  if (f.sector !== 'colchon') indices.push(`${fmtMil(r.living.porMil)} de Living`);
  if (f.sector !== 'living') indices.push(`${fmtMil(r.colchon.porMil)} de Colchón`);
  partes.push(`En ${mesLabel(f.mes)}, cada 1.000 unidades fabricadas nos volvieron ${indices.join(' y ')}.`);

  const top = r.filas
    .filter((x) => x.dev > 0)
    .slice(0, 3)
    .map((x) => `${x.provincia} (${fmt(x.dev)})`)
    .join(', ');
  partes.push(`Fueron ${fmt(r.totales.dev)} devoluciones${top ? `, sobre todo de ${top}` : ''}.`);

  const costo = r.totales.costo;
  const viajes = positivo(t.viajes);
  if (costo > 0) {
    partes.push(
      `Costearlas (${fmt(viajes)} ${viajes === 1 ? 'viaje' : 'viajes'} de flete cada una y ${fmt(Math.round(r.totales.horas))} horas de reparación) suma ${fmtMonto(costo)}: ${fmtMonto(r.totales.flete)} de flete y ${fmtMonto(r.totales.reparacion)} de reparación.`
    );
  } else {
    partes.push(`Todavía no hay tarifas cargadas para costearlas: se dedicaron ${fmt(Math.round(r.totales.horas))} horas a reparar.`);
  }
  if (r.totales.notaCredito > 0 && f.sector !== 'living') {
    partes.push(`Además se emitieron ${fmtMonto(r.totales.notaCredito)} en notas de crédito a clientes de Colchón.`);
  }
  return partes.join(' ');
}

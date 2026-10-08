// Piezas compartidas de las pantallas de Compras MP: formatos, tarjetas de indicador, secciones y tablas.
import type { ReactNode } from 'react';

const M = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const I = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const D2 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

/** Millones de pesos: "$ 1.234,5 M". */
export const mm = (v: number | null | undefined): string => (v === null || v === undefined || Math.abs(v) < 5e3 ? '—' : `$ ${M.format(v / 1e6)} M`);
/** Pesos enteros: "$ 1.234.567". */
export const pesos = (v: number | null | undefined): string => (v === null || v === undefined || Math.abs(v) < 0.5 ? '—' : `$ ${I.format(v)}`);
export const pct = (v: number | null | undefined, dec = 1): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: dec }).format(v * 100)} %`;
export const num = (v: number | null | undefined, dec = 0): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('es-AR', { maximumFractionDigits: dec }).format(v);
/** Cantidades: enteras si son grandes, con 2 decimales si son chicas. */
export const unidades = (v: number | null | undefined): string => (v === null || v === undefined || Math.abs(v) < 0.005 ? '—' : Math.abs(v) >= 100 ? I.format(v) : D2.format(v));
export const veces = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${D2.format(v)} veces`);

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
/** "2026-10" → "Oct 26". */
export function mesCorto(clave: string): string {
  if (clave === 'posterior') return 'Después';
  const [y, m] = clave.split('-');
  return `${MESES_CORTO[Number(m) - 1] ?? clave} ${String(y).slice(2)}`;
}

/** "2026-10-08" / ISO → "08/10/2026" (sin pasar por zonas horarias). */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const fmtHora = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fechaHora = (iso: string): string => fmtHora.format(new Date(iso));

export const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 whitespace-nowrap';
export const thR = `${th} text-right`;
export const td = 'px-3 py-2 text-slate-300';
export const tdR = `${td} text-right tabular-nums whitespace-nowrap`;
export const tdMuted = 'px-3 py-2 text-right tabular-nums text-slate-500';

export function Seccion({ titulo, nota, acciones, children }: { titulo: string; nota?: string; acciones?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-100">{titulo}</h3>
          {nota && <p className="mt-0.5 text-sm text-slate-400">{nota}</p>}
        </div>
        {acciones}
      </div>
      {children}
    </section>
  );
}

export function Tarjeta({ codigo, titulo, valor, detalle, tono = 'normal' }: { codigo: string; titulo: string; valor: ReactNode; detalle?: ReactNode; tono?: 'normal' | 'apagada' | 'aviso' | 'alerta' }) {
  const color = tono === 'apagada' ? 'text-slate-500' : tono === 'alerta' ? 'text-status-red' : tono === 'aviso' ? 'text-status-yellow' : 'text-slate-100';
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center gap-2">
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-400">{codigo}</span>
        <span className="truncate text-xs uppercase tracking-wide text-slate-500" title={titulo}>{titulo}</span>
      </div>
      <div className={`text-xl font-semibold tabular-nums ${color}`}>{valor}</div>
      {detalle && <div className="text-xs text-slate-400">{detalle}</div>}
    </div>
  );
}

export function Grilla({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export function Tabla({ children, maxAlto }: { children: ReactNode; maxAlto?: string }) {
  return (
    <div className={`overflow-auto rounded-lg border border-slate-800 ${maxAlto ?? ''}`}>
      <table className="w-full min-w-max text-sm">{children}</table>
    </div>
  );
}

export const Cabeza = ({ children }: { children: ReactNode }) => <thead className="sticky top-0 border-b border-slate-800 bg-slate-900">{children}</thead>;
export const Cuerpo = ({ children }: { children: ReactNode }) => <tbody className="divide-y divide-slate-800/70">{children}</tbody>;

export function Vacio({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400">{children}</div>;
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400">{texto}</div>;
}

export function ErrorCaja({ mensaje }: { mensaje: string }) {
  return <div className="rounded-lg border border-status-red/40 bg-status-red/10 p-4 text-sm text-status-red">{mensaje}</div>;
}

const ESTADO_CLASE: Record<string, string> = {
  'Debajo del stock de seguridad': 'bg-status-red/15 text-status-red',
  'Debajo del objetivo': 'bg-status-yellow/15 text-status-yellow',
  'En rango': 'bg-status-green/15 text-status-green',
  Exceso: 'bg-brand-500/15 text-brand-400',
  OK: 'bg-status-green/15 text-status-green',
  AVISO: 'bg-status-yellow/15 text-status-yellow',
  REVISAR: 'bg-status-red/15 text-status-red',
  PENDIENTE: 'bg-slate-700/50 text-slate-300',
};
export function Etiqueta({ texto }: { texto: string }) {
  return <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${ESTADO_CLASE[texto] ?? 'bg-slate-800 text-slate-300'}`}>{texto}</span>;
}

export function Selector<T extends string>({ valor, opciones, onChange, etiqueta }: { valor: T; opciones: { valor: T; texto: string }[]; onChange: (v: T) => void; etiqueta?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-400">
      {etiqueta}
      <select value={valor} onChange={(e) => onChange(e.target.value as T)} className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200">
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>{o.texto}</option>
        ))}
      </select>
    </label>
  );
}

export function Segmentos<T extends string>({ valor, opciones, onChange }: { valor: T; opciones: { valor: T; texto: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1" role="group">
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => onChange(o.valor)}
          className={`rounded-md px-3 py-1.5 text-sm transition-colors ${valor === o.valor ? 'bg-brand-500 font-medium text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

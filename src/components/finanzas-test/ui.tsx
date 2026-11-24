import type { ReactNode } from 'react';
import Tip from '@/components/shared/Tip';
import { GLOSARIO_TEST, type ClaveGlosarioTest } from './glosario';

/** Piezas comunes de los tabs "(test)" de Finanzas (réplicas de la planilla de rentabilidad armadas desde Odoo). */

const money2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

const vacio = (n: number | null | undefined): n is null | undefined => n == null || Number.isNaN(Number(n));

export const fmtPesos = (n: number | null | undefined): string => (vacio(n) ? '—' : money2.format(Number(n)));
export const fmtDec = (n: number | null | undefined): string => (vacio(n) ? '—' : num2.format(Number(n)));
export const fmtEntero = (n: number | null | undefined): string => (vacio(n) ? '—' : num0.format(Number(n)));
export const fmtProc = (n: number | null | undefined, dec = 1): string =>
  vacio(n) ? '—' : `${new Intl.NumberFormat('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(n) * 100)}%`;

/** Texto con subrayado punteado que explica, al pasar el mouse, de dónde sale el dato (textos en glosario.ts). */
export function Etq({ clave, children }: { clave: ClaveGlosarioTest; children: ReactNode }) {
  return (
    <Tip text={GLOSARIO_TEST[clave]} className="cursor-help border-b border-dotted border-slate-500">
      {children}
    </Tip>
  );
}

export function Kpi({ label, value, hint, tono, tip }: { label: string; value: string; hint?: string; tono?: 'ok' | 'warn' | 'info'; tip?: ClaveGlosarioTest }) {
  const color = tono === 'ok' ? 'text-emerald-300' : tono === 'warn' ? 'text-amber-300' : tono === 'info' ? 'text-sky-300' : 'text-slate-100';
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{tip ? <Etq clave={tip}>{label}</Etq> : label}</p>
      <p className={`mt-1 text-xl font-semibold ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Panel({ titulo, acciones, children }: { titulo?: string; acciones?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      {(titulo || acciones) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          {titulo && <h3 className="text-sm font-medium text-slate-300">{titulo}</h3>}
          {acciones}
        </div>
      )}
      {children}
    </div>
  );
}

export const CLASE_INPUT = 'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none';

export function Pildora({ tono, children }: { tono: 'ok' | 'warn' | 'info' | 'mute'; children: ReactNode }) {
  const c =
    tono === 'ok'
      ? 'border-emerald-800 bg-emerald-950/50 text-emerald-300'
      : tono === 'warn'
        ? 'border-amber-800 bg-amber-950/50 text-amber-300'
        : tono === 'info'
          ? 'border-sky-800 bg-sky-950/50 text-sky-300'
          : 'border-slate-700 bg-slate-800/60 text-slate-400';
  return <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${c}`}>{children}</span>;
}

/** Descarga las filas como CSV (separador ";", UTF-8 con BOM, para que Excel en es-AR lo abra bien). */
export function descargarCsv(nombre: string, encabezados: string[], filas: (string | number | null | undefined)[][]): void {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : v;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texto = [encabezados, ...filas].map((f) => f.map(esc).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

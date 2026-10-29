import type { PlanSillon } from '@/lib/lineas-sillon/plan';
import type { ConfigSillon, PuestoPersona, Slot } from '@/lib/supabase/lineas-sillon';

export interface EmpleadoOdoo {
  id: number;
  nombre: string;
  departamento: string | null;
}

export interface LineasSillonResponse {
  /** Plan en vivo, recalculado con lo que hay ahora en Odoo. */
  plan: PlanSillon;
  config: ConfigSillon;
  /** Empleados activos de Odoo, para vincular a cada persona. */
  empleados: EmpleadoOdoo[];
  /** Foto del plan de hoy (la de las 6:00), o null si todavía no se fijó. */
  fijado: { fecha: string; creadoEn: string; creadoPor: string; plan: PlanSillon } | null;
}

const horaFmt = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });
export const horaCorta = (iso: string) => horaFmt.format(new Date(iso));

/** Mismos puestos del croquis; se repiten acá para no meter el cliente de Supabase en el bundle del navegador. */
export const SLOTS_UI: { slot: Slot; label: string; puesto: PuestoPersona }[] = [
  { slot: 'C1', label: 'Costurera 1', puesto: 'costurera' },
  { slot: 'C2', label: 'Costurera 2', puesto: 'costurera' },
  { slot: 'C3', label: 'Costurera 3', puesto: 'costurera' },
  { slot: 'C', label: 'Carpintería', puesto: 'carpintero' },
  { slot: 'T', label: 'Tapicería', puesto: 'tendido' },
  { slot: 'E', label: 'Ensamble', puesto: 'estampado' },
];

export const PUESTO_LABEL: Record<PuestoPersona, string> = {
  costurera: 'Costureras',
  carpintero: 'Carpinteros',
  tendido: 'Tendido',
  estampado: 'Estampado',
};

export async function guardarSillon(body: unknown): Promise<unknown> {
  const res = await fetch('/api/lineas-sillon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; data?: unknown } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? 'No se pudo guardar');
  return json.data;
}

export const porcentaje = (x: number) => `${Math.round(x * 100)}%`;

/** Verde dentro de la jornada, ámbar hasta un 10% de excedente, rojo por encima. */
export const tonoEficiencia = (x: number) =>
  x === 0 ? 'text-slate-500' : x <= 1 ? 'text-emerald-400' : x <= 1.1 ? 'text-amber-400' : 'text-rose-400';

export const fechaLarga = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

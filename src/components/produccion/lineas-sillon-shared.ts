import type { LineaPlan, PlanSillon } from '@/lib/lineas-sillon/plan';
import type { ConfigSillon, PersonaSillon, PuestoPersona, Slot } from '@/lib/supabase/lineas-sillon';
import type { ProcesoHoja } from '@/lib/lineas-sillon/polivalencia';

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

export const PROCESO_DE_PUESTO: Record<PuestoPersona, ProcesoHoja> = { costurera: 'COS', carpintero: 'CAR', tendido: 'TAP', estampado: 'ENS' };

/**
 * Puestos en los que puede trabajar una persona: el suyo más cada proceso donde la matriz de polivalencia
 * le da al menos un producto en nivel 2 (lo hace solo) o 3. Un nivel 1 (no lo hace solo) no alcanza.
 */
export function puestosQuePuede(p: PersonaSillon): PuestoPersona[] {
  return (Object.keys(PROCESO_DE_PUESTO) as PuestoPersona[]).filter(
    (pu) => pu === p.puesto || Object.values(p.niveles[PROCESO_DE_PUESTO[pu]] ?? {}).some((n) => n >= 2),
  );
}

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

/** Fecha del día planificado número `n` (0 = hoy): cada día de planificación es un día hábil, se saltean sábados y domingos. */
export function fechaDia(hoy: string, n: number): string {
  const d = new Date(`${hoy}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    do d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  }
  return d.toISOString().slice(0, 10);
}

/** Cuántos días planificados abarcan las líneas (mínimo 1, tope para no desbordar la grilla). */
export function cantidadDias(lineas: LineaPlan[], tope = 15): number {
  const ultimo = Math.max(0, ...lineas.map((l) => l.estaciones[0]!.tramos.at(-1)?.dia ?? 0));
  return Math.min(tope, ultimo + 1);
}

export const fechaCorta = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });

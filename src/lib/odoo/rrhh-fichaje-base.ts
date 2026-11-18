import { readGroup } from './client';
import { claveNombre, fetchSheetTable, legajoNumero } from '@/lib/rrhh-sheet';
import { fechaArgentina } from './rrhh-quincena';

/**
 * Desde cuándo se le puede exigir fichada a cada empleado (para marcar "sin fichada" / "horas faltantes"). SOLO LECTURA.
 *
 *  - Si ya tiene alguna fichada en Odoo (en cualquier fecha): desde su primera fichada. Así, quien estuvo de baja todo el período
 *    y no fichó nada sigue apareciendo como "sin fichada" los días que no tiene licencia.
 *  - Si NUNCA fichó: solo si figura en la nómina de la Planilla con convenio SOIVA o Madereros (los que fichan); en ese caso,
 *    desde que arrancó el kiosco. Gerentes, fuera de convenio y viajantes no fichan y se ignoran, igual que antes.
 *  - En los dos casos, nunca antes de su fecha de ingreso.
 */

const CONVENIOS_QUE_FICHAN = new Set(['SOIVA', 'MADEREROS']);

export interface BaseFichaje {
  /** Primera fecha (ISO, hora argentina) en que se puede evaluar al empleado dentro de `desde`, o null si no se lo evalúa. */
  inicioEvaluacion(e: { id: number; name: string; barcode: string | false; x_studio_fecha_ingreso: string | false }, desde: string): string | null;
}

async function nominaQueFicha(): Promise<{ legajos: Set<number>; nombres: Set<string> } | null> {
  try {
    const tabla = await fetchSheetTable('PLANILLA DE CALCULO 2Q ', 'A5:F1200');
    const legajos = new Set<number>();
    const nombres = new Set<string>();
    for (const r of tabla.slice(1)) {
      const legajo = Number((r[0] ?? '').trim());
      const nombre = (r[1] ?? '').trim();
      if (!nombre || !CONVENIOS_QUE_FICHAN.has((r[5] ?? '').trim().toUpperCase())) continue;
      if (Number.isFinite(legajo) && legajo > 0) legajos.add(legajo);
      nombres.add(claveNombre(nombre));
    }
    return { legajos, nombres };
  } catch {
    // Sin la planilla se mantiene el comportamiento anterior: a quien nunca fichó no se lo evalúa.
    return null;
  }
}

export async function cargarBaseFichaje(): Promise<BaseFichaje> {
  const [grupos, nomina] = await Promise.all([
    readGroup({ model: 'hr.attendance', domain: [], fields: ['check_in:min'], groupBy: ['employee_id'], lazy: false }),
    nominaQueFicha(),
  ]);

  const primeras = new Map<number, string>();
  for (const g of grupos) {
    const emp = g.employee_id as [number, string] | false;
    const ci = g.check_in as string | false;
    if (emp && ci) primeras.set(emp[0], fechaArgentina(ci));
  }
  const inicioKiosco = [...primeras.values()].sort()[0] ?? null;

  return {
    inicioEvaluacion(e, desde) {
      let primera = primeras.get(e.id) ?? null;
      if (!primera && nomina && inicioKiosco) {
        const legajo = legajoNumero(e.barcode || null);
        if ((legajo !== null && nomina.legajos.has(legajo)) || nomina.nombres.has(claveNombre(e.name))) primera = inicioKiosco;
      }
      if (!primera) return null;
      return [desde, primera, e.x_studio_fecha_ingreso || ''].reduce((m, v) => (v > m ? v : m));
    },
  };
}

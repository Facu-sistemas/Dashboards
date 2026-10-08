// Reglas de reabastecimiento (mínimo y máximo) para importar en Odoo. La web NUNCA escribe en Odoo: genera un archivo
// y una persona lo importa a mano, primero en staging. Mismo criterio que la hoja "Para Odoo" del libro v12.
import { searchReadAll } from '../odoo/client';
import type { FilaCompleta } from './indicadores';

export interface FilaReposicion {
  /** ID externo de la regla existente en Odoo (vacío = regla nueva). */
  id: string;
  productId: number | null;
  sku: string;
  ubicacion: string;
  min: number;
  max: number;
  multiplo: number;
  trigger: 'manual' | 'auto';
  categoria: string;
  origen: string;
  abc: string;
  lleva: boolean;
  motivo: string;
  disponible: number;
  estado: string;
  metodo: string;
  /** Ya hay una regla en Odoo para este producto y ubicación. */
  existe: boolean;
}

export interface ResultadoReposicion {
  filas: FilaReposicion[];
  ubicacion: string;
  advertencias: string[];
}

const SIN_REGLA = new Set(['Agotar stock', 'Discontinuado', 'Consignado', 'Sin proyección']);

function motivoDe(f: FilaCompleta, lleva: boolean): string {
  if (f.met === 'Agotar stock') return 'Agotar stock: se consume hasta agotar y no se recompra';
  if (f.met === 'Discontinuado') return 'Discontinuado: no se recompra';
  if (f.met === 'Consignado') return 'Consignado (costo 0): no se compra';
  if (!lleva) return 'Sin consumo proyectado';
  if (f.ori === 'China') return 'China: compra por contenedor; la regla avisa pero no dispara sola';
  return 'Reposición automática al mínimo';
}

export async function construirReposicion(filas: FilaCompleta[], ubicacion: string): Promise<ResultadoReposicion> {
  const advertencias: string[] = [];

  // Reglas que ya existen en Odoo para esa ubicación (solo lectura), con su ID externo.
  const existentes = new Map<number, { id: string }>();
  const sinIdExterno: string[] = [];
  try {
    const reglas = await searchReadAll<{ id: number; product_id: [number, string]; location_id: [number, string]; active: boolean }>({
      model: 'stock.warehouse.orderpoint',
      domain: [['location_id.complete_name', '=', ubicacion]],
      fields: ['product_id', 'location_id', 'active'],
      context: { active_test: false },
    });
    const ids = reglas.map((r) => r.id);
    const externos = new Map<number, string>();
    for (let i = 0; i < ids.length; i += 500) {
      const datos = await searchReadAll<{ res_id: number; module: string; name: string }>({
        model: 'ir.model.data', domain: [['model', '=', 'stock.warehouse.orderpoint'], ['res_id', 'in', ids.slice(i, i + 500)]], fields: ['res_id', 'module', 'name'],
      });
      for (const d of datos) externos.set(d.res_id, `${d.module}.${d.name}`);
    }
    for (const r of reglas) {
      const ext = externos.get(r.id);
      if (ext) existentes.set(r.product_id[0], { id: ext });
      else { existentes.set(r.product_id[0], { id: '' }); sinIdExterno.push(r.product_id[1]); }
    }
  } catch (e) {
    advertencias.push(`No se pudieron leer las reglas existentes de Odoo (${e instanceof Error ? e.message : e}): el archivo no incluye los IDs de las reglas que ya existen.`);
  }

  const out: FilaReposicion[] = filas
    .map((f) => {
      const lleva = !(SIN_REGLA.has(f.met) || f.abc === 'Sin consumo' || f.ef <= 0);
      const min = lleva ? Math.ceil(f.ef) : 0;
      const max = lleva ? Math.max(min, Math.ceil(f.eg)) : 0;
      const ex = f.productId !== null ? existentes.get(f.productId) : undefined;
      return {
        id: ex?.id ?? '', productId: f.productId, sku: f.sku, ubicacion, min, max, multiplo: 1, trigger: f.ori === 'China' ? ('manual' as const) : ('auto' as const),
        categoria: f.cat, origen: f.ori, abc: f.abc, lleva, motivo: motivoDe(f, lleva), disponible: f.disp, estado: f.estado, metodo: f.met, existe: !!ex,
      };
    })
    .sort((a, b) => a.categoria.localeCompare(b.categoria, 'es') || a.sku.localeCompare(b.sku, 'es'));

  const duplicados = out.filter((f) => out.filter((g) => g.sku === f.sku).length > 1).map((f) => f.sku);
  if (duplicados.length) advertencias.push(`Hay productos con el mismo nombre (${[...new Set(duplicados)].join(', ')}): Odoo los busca por nombre al importar y puede tomar el equivocado.`);
  if (sinIdExterno.length) {
    advertencias.push(`${sinIdExterno.length} productos ya tienen regla en Odoo pero sin ID externo: no se incluyen en el archivo para no duplicarlas (exportar esas reglas desde Odoo una vez para que tengan ID).`);
  }
  return { filas: out, ubicacion, advertencias };
}

const esc = (v: string | number): string => {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Archivo de importación de Odoo: columnas id, product_id, location_id, product_min_qty, product_max_qty, qty_multiple, trigger. */
export function aCsvOdoo(r: ResultadoReposicion): string {
  const incluidas = r.filas.filter((f) => f.lleva && !(f.existe && f.id === ''));
  const lineas = ['id,product_id,location_id,product_min_qty,product_max_qty,qty_multiple,trigger'];
  for (const f of incluidas) lineas.push([f.id, f.sku, f.ubicacion, f.min, f.max, f.multiplo, f.trigger].map(esc).join(','));
  return `﻿${lineas.join('\r\n')}\r\n`;
}

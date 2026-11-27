import { searchReadAll } from './client';

/**
 * Tipo de liquidación (quincenal / mensual) y convenio (SOIVA / Madereros / …) de cada empleado, leídos de Odoo. SOLO LECTURA.
 *
 * Odoo de fábrica no tiene ninguno de los dos: RRHH los agrega en Studio en la ficha del empleado, con estas etiquetas:
 *  - "Tipo de liquidación" (selección: Quincenal, Mensual).
 *  - "Convenio" (selección: SOIVA, Madereros, Fuera de convenio, Viajantes).
 * Los campos se buscan por su etiqueta (no por el nombre técnico que arma Studio), así que funcionan apenas se crean. La
 * "Categoría de Convenio" que ya existe (x_studio_categora_de_convenio) es la escala salarial, no el convenio: no se usa.
 * Mientras un campo no exista o esté vacío para alguien, la Planilla usa la hoja de nómina de Google y lo avisa.
 */

const CAMPO_CATEGORIA = 'x_studio_categora_de_convenio';

type CampoOdoo = { name: string; field_description: string; ttype: string };

export interface NominaOdoo {
  /** Nombre técnico de cada campo en Odoo, o null si todavía no se creó. */
  campoTipo: string | null;
  campoConvenio: string | null;
  /** Por id de hr.employee: valores normalizados ('' = vacío en Odoo). */
  porEmpleado: Map<number, { tipoLiquidacion: string; convenio: string }>;
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Valor crudo de Odoo (selección, texto o many2one) a texto. */
function texto(v: unknown): string {
  if (Array.isArray(v)) return String(v[1] ?? '');
  if (typeof v === 'string') return v;
  return '';
}

export function normalizarTipoLiquidacion(v: string): string {
  const s = sinAcentos(v);
  if (s.startsWith('quinc')) return 'QUINCENAL';
  if (s.startsWith('mens')) return 'MENSUAL';
  return v.trim().toUpperCase();
}

export function normalizarConvenio(v: string): string {
  const s = sinAcentos(v);
  if (!s) return '';
  if (s.includes('soiva')) return 'SOIVA';
  if (s.includes('mader')) return 'MADEREROS';
  if (s.includes('fuera')) return 'FUERA DE CONVENIO';
  if (s.includes('viajant')) return 'VIAJANTES';
  return v.trim().toUpperCase();
}

export async function leerNominaOdoo(): Promise<NominaOdoo> {
  const campos = await searchReadAll<CampoOdoo>({
    model: 'ir.model.fields',
    domain: [
      ['model', '=', 'hr.employee'],
      ['name', 'like', 'x_'],
      ['ttype', 'in', ['selection', 'char', 'many2one']],
    ],
    fields: ['name', 'field_description', 'ttype'],
  });
  const campoTipo = campos.find((c) => sinAcentos(c.field_description).startsWith('tipo de liquidacion'))?.name ?? null;
  const campoConvenio = campos.find((c) => c.name !== CAMPO_CATEGORIA && sinAcentos(c.field_description) === 'convenio')?.name ?? null;

  const porEmpleado = new Map<number, { tipoLiquidacion: string; convenio: string }>();
  const fields = [campoTipo, campoConvenio].filter((f): f is string => Boolean(f));
  if (fields.length > 0) {
    const empleados = await searchReadAll<Record<string, unknown> & { id: number }>({
      model: 'hr.employee',
      domain: [['active', '=', true]],
      fields,
    });
    for (const e of empleados) {
      porEmpleado.set(e.id, {
        tipoLiquidacion: campoTipo ? normalizarTipoLiquidacion(texto(e[campoTipo])) : '',
        convenio: campoConvenio ? normalizarConvenio(texto(e[campoConvenio])) : '',
      });
    }
  }
  return { campoTipo, campoConvenio, porEmpleado };
}

/**
 * Tipos de ausencia (`hr.leave.type`) que la bandeja de Novedades puede cargar en Odoo. Solo los que se miden en horas:
 * los de unidad "día" (vacaciones, matrimonio, fallecimiento…) no admiten una fracción de jornada. Los ids son los de la
 * base de la empresa (mismo criterio que BANCO_HORAS_TYPE_ID en odoo/rrhh-quincena.ts). Sin imports de servidor: lo usan
 * el endpoint y la pantalla.
 */
export interface TipoAusenciaCargable {
  id: number;
  nombre: string;
  /** Tipo con saldo: Odoo exige asignaciones suficientes (banco de horas). */
  requiereSaldo: boolean;
}

export const TIPOS_AUSENCIA_CARGABLES: TipoAusenciaCargable[] = [
  { id: 6, nombre: 'Banco de horas', requiereSaldo: true },
  { id: 10, nombre: 'Trámite', requiereSaldo: false },
  { id: 2, nombre: 'Baja por enfermedad', requiereSaldo: false },
  { id: 9, nombre: 'Accidente', requiereSaldo: false },
  { id: 4, nombre: 'Permisos sin pagar', requiereSaldo: false },
  { id: 14, nombre: 'Estudio', requiereSaldo: false },
  { id: 16, nombre: 'Lactancia', requiereSaldo: false },
  { id: 17, nombre: 'Permiso gremial', requiereSaldo: false },
  { id: 18, nombre: 'Bombero', requiereSaldo: false },
];

/**
 * Tipos para cargar un día entero sin fichada ("sin-fichada"): se cargan como ausencia por días (la jornada completa
 * según el calendario), no por horas. Incluye los tipos de unidad "día" y los de horas que admiten un día completo.
 */
export const TIPOS_AUSENCIA_DIA_COMPLETO: { id: number; nombre: string }[] = [
  { id: 4, nombre: 'Permisos sin pagar (falta injustificada)' },
  { id: 6, nombre: 'Banco de horas' },
  { id: 2, nombre: 'Baja por enfermedad' },
  { id: 9, nombre: 'Accidente' },
  { id: 10, nombre: 'Trámite' },
  { id: 5, nombre: 'Vacaciones' },
  { id: 19, nombre: 'Día de convenio' },
  { id: 11, nombre: 'Matrimonio' },
  { id: 12, nombre: 'Fallecimiento' },
  { id: 13, nombre: 'Mudanza' },
  { id: 15, nombre: 'Donación de sangre' },
  { id: 20, nombre: 'Licencia por maternidad' },
  { id: 14, nombre: 'Estudio' },
  { id: 16, nombre: 'Lactancia' },
  { id: 17, nombre: 'Permiso gremial' },
  { id: 18, nombre: 'Bombero' },
];

/** Id del tipo "Banco de horas" en Odoo: las horas extra se acreditan con una asignación de este tipo. */
export const BANCO_HORAS_TIPO_ID = 6;
/** Horas por día con las que Odoo convierte las horas de una asignación en días (days = horas / 8,3). */
export const HORAS_DIA_ASIGNACION = 8.3;
/** Tope de horas extra a acreditar por novedad (un día muy largo). */
export const MAX_HORAS_EXTRA = 12;

/**
 * Tope de horas por ausencia: la jornada del calendario de Odoo (06:00–14:18 = 8,3 hs). Odoo calcula las horas de la
 * ausencia contra ese calendario, así que no puede cargar más de una jornada. (Liquidación cuenta 8,80 hs por día: un día
 * entero de falta se carga como ausencia por días en Odoo, no desde acá.)
 */
export const MAX_HORAS_AUSENCIA = 8.3;

// Estado de cada empleado dentro del Resumen de RRHH. Sin dependencias: lo usan el servidor y los componentes del navegador.
//
//   normal            aparece en el Resumen con sus horas (es el estado de quien no tiene fila en la tabla).
//   reporte_perfecto  aparece, mostrando si está fichado o no, pero sus horas no se controlan (a fin de mes siempre cierran bien).
//   ignorar           no aparece en el Resumen (dueños, etc.).
export type EstadoResumen = 'normal' | 'reporte_perfecto' | 'ignorar';

/** Los estados que se guardan en la tabla (`normal` = no hay fila). */
export type EstadoResumenGuardado = Exclude<EstadoResumen, 'normal'>;

export const ESTADOS_RESUMEN: { value: EstadoResumen; label: string; descripcion: string }[] = [
  { value: 'normal', label: 'Normal', descripcion: 'Aparece en el Resumen con sus horas.' },
  { value: 'reporte_perfecto', label: 'Reporte perfecto', descripcion: 'Aparece, pero solo se mira si está fichado: las horas no se controlan.' },
  { value: 'ignorar', label: 'Ignorar', descripcion: 'No aparece en el Resumen.' },
];

export function esEstadoResumen(valor: unknown): valor is EstadoResumen {
  return valor === 'normal' || valor === 'reporte_perfecto' || valor === 'ignorar';
}

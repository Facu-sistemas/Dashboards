// Constantes de Compras MP que usan tanto el servidor como el navegador. Sin dependencias: nada de acceso a datos acá.
export const DECISIONES = ['Llega', 'Cerrar saldo', 'Reclamar', 'Reprogramada'] as const;
export type Decision = (typeof DECISIONES)[number];

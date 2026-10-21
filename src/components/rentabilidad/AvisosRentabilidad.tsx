import Etiqueta from './Etiqueta';
import type { RentabilidadConfig, ProveedorCostoInfo } from '@/lib/rentabilidad/types';

/** Avisos de estado: costos no conectados (stub) y/o configuración por defecto. */
export default function AvisosRentabilidad({ costos, config, empresa }: { costos: ProveedorCostoInfo; config: RentabilidadConfig; empresa: string }) {
  return (
    <>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>
          Pasá el mouse por los títulos para ver de dónde sale cada dato. Empresa: <strong className="text-slate-300">{empresa}</strong> · Costos:{' '}
          <strong className="text-slate-300">{costos.modo === 'planilla' ? 'Planilla (coincide con el Excel)' : 'Odoo (dinámico)'}</strong>. Cómo se arma:
        </span>
        <Etiqueta clave="subtotal">Subtotal facturado</Etiqueta>
        <Etiqueta clave="notasCredito">Notas de crédito</Etiqueta>
        <Etiqueta clave="costoMp">Costo MP</Etiqueta>
        <Etiqueta clave="costoMod">Costo MOD</Etiqueta>
        <Etiqueta clave="costoTotal">Costo para contribución</Etiqueta>
        <Etiqueta clave="objetivo">Objetivo</Etiqueta>
        <Etiqueta clave="cobertura">Cobertura de costo</Etiqueta>
      </p>
      {!costos.activo && (
        <p className="rounded border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-300">
          Sin costos cargados: se muestran ventas y cantidades reales de Odoo. La contribución, el gap y el margen perdido se habilitan cuando se conecte el
          costeo (materia prima, mano de obra, fijos). No se estima ningún valor mientras tanto.
        </p>
      )}
      {costos.activo && <p className="text-xs text-slate-500">Costeo parcial: {costos.descripcion} Las filas sin costo no entran en la contribución (ver cobertura).</p>}
      {!config.disponible && (
        <p className="text-xs text-slate-500">
          Objetivos y umbrales por defecto (objetivo {config.global.objetivo}%, verde ≥ {config.global.verde}%, amarillo ≥ {config.global.amarillo}%): las
          tablas rentabilidad_* todavía no están creadas.
        </p>
      )}
    </>
  );
}

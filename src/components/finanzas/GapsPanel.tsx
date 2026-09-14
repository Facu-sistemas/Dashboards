import type { GapInsumo, GapReason } from './types';

interface Props {
  gaps: GapInsumo[];
  missingConsensoMonths: string[];
  missingTcMonths: string[];
  modelosSinBomReconocido: string[];
}

const REASON_LABELS: Record<GapReason, string> = {
  'sin-costo': 'Sin costo cargado en Odoo',
  'componente-generico-sin-repartir': 'Componente genérico compartido (tela/color) — pendiente de repartir por mix real',
  'no-es-materia-prima': 'BOM apunta a un componente que no es materia prima',
  'insumo-no-encontrado': 'Insumo de la Lista de Materiales no encontrado en Odoo (nombre no cruza)',
};

const monthFmt = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return monthFmt.format(new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1)));
}

/**
 * Gaps a de negocio (Compras/Finanzas) tienen que completar — nunca se
 * muestran como $0 silencioso en la tabla principal (sección 6 del doc).
 */
export default function GapsPanel({ gaps, missingConsensoMonths, missingTcMonths, modelosSinBomReconocido }: Props) {
  const hasAnything =
    gaps.length > 0 || missingConsensoMonths.length > 0 || missingTcMonths.length > 0 || modelosSinBomReconocido.length > 0;
  if (!hasAnything) {
    return <p className="py-4 text-sm text-slate-500">Sin gaps pendientes — todos los insumos tienen costo y categoría resueltos.</p>;
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      {missingConsensoMonths.length > 0 && (
        <div className="rounded border border-amber-900/60 bg-amber-950/30 p-3">
          <p className="font-medium text-amber-300">Falta consenso de unidades</p>
          <p className="mt-1 text-amber-200/80">
            El presupuesto de estos meses no se calcula hasta cargar el consenso de Colchones y Living:{' '}
            {missingConsensoMonths.map(formatMonth).join(', ')}.
          </p>
        </div>
      )}

      {missingTcMonths.length > 0 && (
        <div className="rounded border border-amber-900/60 bg-amber-950/30 p-3">
          <p className="font-medium text-amber-300">Falta TC asumido para meses futuros</p>
          <p className="mt-1 text-amber-200/80">
            Se usó el tipo de cambio del día como supuesto porque no hay un TC asumido cargado para:{' '}
            {missingTcMonths.map(formatMonth).join(', ')}.
          </p>
        </div>
      )}

      {modelosSinBomReconocido.length > 0 && (
        <div className="rounded border border-amber-900/60 bg-amber-950/30 p-3">
          <p className="font-medium text-amber-300">Modelos vendidos sin BOM reconocido ({modelosSinBomReconocido.length})</p>
          <p className="mt-1 text-amber-200/80">
            Tienen ventas reales pero su nombre no cruzó con ningún "Modelo (base)" de la Lista de Materiales — su
            consumo de insumos no está reflejado en el presupuesto: {modelosSinBomReconocido.slice(0, 15).join(', ')}
            {modelosSinBomReconocido.length > 15 ? `, y ${modelosSinBomReconocido.length - 15} más` : ''}.
          </p>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 font-medium">Insumo</th>
                <th className="py-2 font-medium">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g) => (
                <tr key={`${g.productId ?? 'null'}-${g.productName}-${g.reason}`} className="border-b border-slate-800/60 last:border-0">
                  <td className="py-2 pr-4 text-slate-200">{g.productName}</td>
                  <td className="py-2 text-slate-400">{REASON_LABELS[g.reason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

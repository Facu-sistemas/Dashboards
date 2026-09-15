import { useState, Fragment } from 'react';
import type { CategoryGroup, InsumoMonthFigure } from './types';
import { monthLabel, money, STATUS_TEXT_CLASSES } from './presupuesto-dinamico-utils';
import InsumoBreakdownModal from './InsumoBreakdownModal';

interface Props {
  categories: CategoryGroup[];
  months: string[];
  year: number;
}

function FigureCells({ figure, onDrillDown, divider }: { figure: InsumoMonthFigure; onDrillDown?: () => void; divider?: boolean }) {
  return (
    <>
      <td className={`py-1.5 pr-3 text-right text-slate-300 ${divider ? 'border-l border-slate-800' : ''}`}>
        {figure.presupuestado === null ? (
          <span className="text-slate-600">—</span>
        ) : onDrillDown ? (
          <button
            type="button"
            onClick={onDrillDown}
            title="Ver cómo se calculó este número"
            className="underline decoration-dotted decoration-slate-600 underline-offset-2 hover:text-brand-400 hover:decoration-brand-400"
          >
            {money.format(figure.presupuestado)}
          </button>
        ) : (
          money.format(figure.presupuestado)
        )}
      </td>
      <td className="py-1.5 pr-3 text-right text-slate-300">{money.format(figure.real)}</td>
      <td className={`py-1.5 pr-4 text-right font-medium ${STATUS_TEXT_CLASSES[figure.status]}`}>
        {figure.compliancePct !== null ? `${figure.compliancePct.toFixed(0)}%` : '—'}
      </td>
    </>
  );
}

/** Categoría → Insumo, por mes y año. El "Mes" del shell (PresupuestoDinamicoApp) ya deja ver un mes puntual — no hace falta un nivel Trimestre acá encima, sólo agrega un click extra para ver lo mismo que el filtro de arriba ya resuelve. */
export default function CategoryInsumoTree({ categories, months, year }: Props) {
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [drillDown, setDrillDown] = useState<{ productId: number; productName: string; month: string } | null>(null);

  function toggleCategory(id: number) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (categories.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin insumos de materia prima con datos para este año.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="sticky left-0 bg-slate-900 py-2 pr-4 font-medium">Categoría / Insumo</th>
            {months.map((m, i) => (
              <th key={m} colSpan={3} className={`py-2 pr-4 text-center font-medium ${i > 0 ? 'border-l border-slate-800' : ''}`}>
                {monthLabel(m)}
              </th>
            ))}
            <th colSpan={3} className="border-l border-slate-800 py-2 text-center font-medium">Anual</th>
          </tr>
          <tr className="border-b border-slate-800 text-right text-[11px] uppercase tracking-wide text-slate-600">
            <th className="sticky left-0 bg-slate-900 py-1.5 pr-4 text-left font-normal"></th>
            {months.map((m, i) => (
              <Fragment key={m}>
                <th className={`py-1.5 pr-3 font-normal ${i > 0 ? 'border-l border-slate-800' : ''}`}>Presup.</th>
                <th className="py-1.5 pr-3 font-normal">Real</th>
                <th className="py-1.5 pr-4 font-normal">%</th>
              </Fragment>
            ))}
            <th className="border-l border-slate-800 py-1.5 pr-3 font-normal">Presup.</th>
            <th className="py-1.5 pr-3 font-normal">Real</th>
            <th className="py-1.5 pr-4 font-normal">%</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => {
            const isExpanded = expandedCategories.has(cat.categoryId);
            return (
              <Fragment key={cat.categoryId}>
                <tr className="border-b border-slate-800/60 bg-slate-800/30">
                  <td className="sticky left-0 bg-slate-800/30 py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => toggleCategory(cat.categoryId)}
                      className="flex items-center gap-1.5 font-medium text-slate-100 hover:text-brand-400"
                    >
                      <span>{isExpanded ? '▾' : '▸'}</span>
                      {cat.categoryName}
                      <span className="text-xs font-normal text-slate-500">({cat.insumos.length})</span>
                    </button>
                  </td>
                  {months.map((m, i) => (
                    <FigureCells key={`${cat.categoryId}-${m}`} figure={cat.months[m]!} divider={i > 0} />
                  ))}
                  <FigureCells figure={cat.annual} divider />
                </tr>

                {isExpanded &&
                  cat.insumos.map((insumo) => (
                    <tr key={`insumo-${insumo.productId}`} className="border-b border-slate-800/40 last:border-0">
                      <td className="sticky left-0 bg-slate-900 py-1.5 pr-4 pl-6 text-slate-300">{insumo.productName}</td>
                      {months.map((m, i) => (
                        <FigureCells
                          key={`${insumo.productId}-${m}`}
                          figure={insumo.months[m]!}
                          divider={i > 0}
                          onDrillDown={
                            insumo.months[m]!.presupuestado !== null
                              ? () => setDrillDown({ productId: insumo.productId, productName: insumo.productName, month: m })
                              : undefined
                          }
                        />
                      ))}
                      <FigureCells figure={insumo.annual} divider />
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {drillDown && (
        <InsumoBreakdownModal
          year={year}
          productId={drillDown.productId}
          productName={drillDown.productName}
          month={drillDown.month}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  );
}

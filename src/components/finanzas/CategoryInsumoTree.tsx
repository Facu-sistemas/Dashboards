import { useState, Fragment } from 'react';
import type { CategoryGroup, InsumoMonthFigure } from './types';
import { QUARTERS, monthsInQuarter, monthLabel, aggregateFigures, money, STATUS_TEXT_CLASSES } from './presupuesto-dinamico-utils';

interface Props {
  categories: CategoryGroup[];
  months: string[];
}

function FigureCells({ figure }: { figure: InsumoMonthFigure }) {
  return (
    <>
      <td className="py-1.5 pr-3 text-right text-slate-300">
        {figure.presupuestado !== null ? money.format(figure.presupuestado) : <span className="text-slate-600">—</span>}
      </td>
      <td className="py-1.5 pr-3 text-right text-slate-300">{money.format(figure.real)}</td>
      <td className={`py-1.5 pr-4 text-right font-medium ${STATUS_TEXT_CLASSES[figure.status]}`}>
        {figure.compliancePct !== null ? `${figure.compliancePct.toFixed(0)}%` : '—'}
      </td>
    </>
  );
}

export default function CategoryInsumoTree({ categories, months }: Props) {
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [expandedQuarters, setExpandedQuarters] = useState<Set<string>>(new Set());

  function toggleCategory(id: number) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleQuarter(label: string) {
    setExpandedQuarters((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  if (categories.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin insumos de materia prima con datos para este año.</p>;
  }

  function figuresFor(figuresByMonth: Record<string, InsumoMonthFigure>, quarterMonths: string[]) {
    return aggregateFigures(quarterMonths.map((m) => figuresByMonth[m]!));
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="sticky left-0 bg-slate-900 py-2 pr-4 font-medium">Categoría / Insumo</th>
            {QUARTERS.map((q) => {
              const qMonths = monthsInQuarter(months, q.monthNumbers);
              if (qMonths.length === 0) return null;
              const expanded = expandedQuarters.has(q.label);
              return (
                <th key={q.label} colSpan={expanded ? qMonths.length * 3 : 3} className="py-2 pr-4 font-medium">
                  <button type="button" onClick={() => toggleQuarter(q.label)} className="flex items-center gap-1 hover:text-slate-300">
                    <span>{expanded ? '▾' : '▸'}</span>
                    {q.label}
                  </button>
                </th>
              );
            })}
            <th colSpan={3} className="py-2 font-medium">Anual</th>
          </tr>
          <tr className="border-b border-slate-800 text-right text-[11px] uppercase tracking-wide text-slate-600">
            <th className="sticky left-0 bg-slate-900 py-1.5 pr-4 text-left font-normal"></th>
            {QUARTERS.map((q) => {
              const qMonths = monthsInQuarter(months, q.monthNumbers);
              if (qMonths.length === 0) return null;
              const expanded = expandedQuarters.has(q.label);
              const cols = expanded ? qMonths.map((m) => monthLabel(m)) : [q.label];
              return cols.map((label) => (
                <Fragment key={label}>
                  <th className="py-1.5 pr-3 font-normal">{label} Presup.</th>
                  <th className="py-1.5 pr-3 font-normal">{label} Real</th>
                  <th className="py-1.5 pr-4 font-normal">{label} %</th>
                </Fragment>
              ));
            })}
            <th className="py-1.5 pr-3 font-normal">Presup.</th>
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
                  {QUARTERS.map((q) => {
                    const qMonths = monthsInQuarter(months, q.monthNumbers);
                    if (qMonths.length === 0) return null;
                    const expanded = expandedQuarters.has(q.label);
                    if (expanded) {
                      return qMonths.map((m) => <FigureCells key={`${cat.categoryId}-${m}`} figure={cat.months[m]!} />);
                    }
                    return <FigureCells key={`${cat.categoryId}-${q.label}`} figure={figuresFor(cat.months, qMonths)} />;
                  })}
                  <FigureCells figure={cat.annual} />
                </tr>

                {isExpanded &&
                  cat.insumos.map((insumo) => (
                    <tr key={`insumo-${insumo.productId}`} className="border-b border-slate-800/40 last:border-0">
                      <td className="sticky left-0 bg-slate-900 py-1.5 pr-4 pl-6 text-slate-300">{insumo.productName}</td>
                      {QUARTERS.map((q) => {
                        const qMonths = monthsInQuarter(months, q.monthNumbers);
                        if (qMonths.length === 0) return null;
                        const expanded = expandedQuarters.has(q.label);
                        if (expanded) {
                          return qMonths.map((m) => <FigureCells key={`${insumo.productId}-${m}`} figure={insumo.months[m]!} />);
                        }
                        return <FigureCells key={`${insumo.productId}-${q.label}`} figure={figuresFor(insumo.months, qMonths)} />;
                      })}
                      <FigureCells figure={insumo.annual} />
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

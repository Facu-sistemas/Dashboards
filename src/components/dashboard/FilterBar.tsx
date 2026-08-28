import { useApiQuery } from './useApiQuery';
import { monthOptions } from '../shared/monthOptions';
import type { CategoryOption, DashboardFilters } from './types';

interface Props {
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
}

export default function FilterBar({ filters, onChange }: Props) {
  const categoriesQuery = useApiQuery<CategoryOption[]>(['categories'], '/api/categories');
  const months = monthOptions();

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Período
        <select
          value={filters.month}
          onChange={(e) => onChange({ ...filters, month: e.target.value })}
          className="min-w-[10rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Categoría
        <select
          value={filters.categoryId ?? ''}
          onChange={(e) =>
            onChange({ ...filters, categoryId: e.target.value ? Number(e.target.value) : undefined })
          }
          className="min-w-[12rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
        >
          <option value="">Todas</option>
          {categoriesQuery.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

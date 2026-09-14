import type { FueraDeAlcanceCategoryRow } from './types';
import { money } from './presupuesto-dinamico-utils';

interface Props {
  categories: FueraDeAlcanceCategoryRow[];
}

/** Categorías de compra real que NO son materia prima (servicios, indumentaria, reventa, ...) — solo informativo, nunca entra al % de Cumplimiento del presupuesto de materia prima. */
export default function FueraDeAlcanceTable({ categories }: Props) {
  if (categories.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">Sin compras fuera de alcance registradas este año.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 font-medium">Categoría</th>
            <th className="py-2 font-medium">Real (anual)</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.categoryId} className="border-b border-slate-800/60 last:border-0">
              <td className="py-2 pr-4 text-slate-200">{c.categoryName}</td>
              <td className="py-2 text-slate-300">{money.format(c.annual)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

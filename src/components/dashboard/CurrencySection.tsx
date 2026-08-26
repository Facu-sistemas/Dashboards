import ComplianceTable from './ComplianceTable';
import ComplianceBarChart from './ComplianceBarChart';
import { ChartSkeleton } from './Skeletons';
import type { CategoryBudgetStatus, PurchaseCurrency } from './types';

interface Props {
  currency: PurchaseCurrency;
  rows: CategoryBudgetStatus[];
  isLoading: boolean;
}

const TITLES: Record<PurchaseCurrency, string> = {
  ARS: 'Categorías en pesos (ARS)',
  USD: 'Categorías en dólares (USD) — insumos químicos',
};

export default function CurrencySection({ currency, rows, isLoading }: Props) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-sm font-medium text-slate-300">{TITLES[currency]}</h2>

      {isLoading ? (
        <ChartSkeleton height={320} />
      ) : (
        <>
          <ComplianceBarChart currency={currency} rows={rows} />
          <ComplianceTable currency={currency} rows={rows} />
        </>
      )}
    </section>
  );
}

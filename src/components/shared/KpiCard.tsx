interface Props {
  label: string;
  value?: number;
  isLoading?: boolean;
  format?: 'currency' | 'number';
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const plain = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

export default function KpiCard({ label, value, isLoading, format = 'number' }: Props) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      {isLoading ? (
        <div className="mt-2 h-6 w-32 animate-pulse-slow rounded bg-slate-800" />
      ) : (
        <p className="mt-1 text-xl font-semibold text-slate-100">
          {value !== undefined ? (format === 'currency' ? money.format(value) : plain.format(value)) : '—'}
        </p>
      )}
    </div>
  );
}

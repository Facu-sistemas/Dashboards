export function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div
      className="w-full animate-pulse-slow rounded-lg bg-slate-800/60"
      style={{ height }}
      role="status"
      aria-label="Cargando datos del gráfico"
    />
  );
}

export function MetricCardSkeleton() {
  return (
    <div className="animate-pulse-slow rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 h-3 w-24 rounded bg-slate-800" />
      <div className="h-6 w-32 rounded bg-slate-800" />
    </div>
  );
}

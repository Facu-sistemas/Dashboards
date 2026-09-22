import { useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import { formatCompactCurrency, formatNumber } from '../gerencia/format';
import type { ClientesActivosFuente, TendenciaMensualRow } from '../../lib/odoo/clientes-activos';

interface Props {
  rows: TendenciaMensualRow[];
  fuente: ClientesActivosFuente;
}

// timeZone: 'UTC' — mismo motivo que en los demás gráficos mensuales del proyecto (monthOptions.ts).
const monthLabelFormatter = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const label = monthLabelFormatter.format(new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type Metrica = 'clientes' | 'facturado';

/**
 * Un solo toggle arriba en vez de barra+línea superpuestas: mezclar clientes
 * (decenas) y facturado (miles de millones) en dos ejes hacía que la línea
 * del que quedaba en el eje secundario se viera "para todos lados" sin
 * aportar nada — más claro mostrar una métrica genuina a la vez.
 */
export default function TendenciaMensualChart({ rows, fuente }: Props) {
  const chartTheme = useChartTheme();
  const [metrica, setMetrica] = useState<Metrica>('clientes');
  if (rows.length === 0) return null;

  const montoLabel = fuente === 'pedidos' ? 'Vendido' : 'Facturado';
  const METRICA_OPTIONS: { value: Metrica; label: string }[] = [
    { value: 'clientes', label: 'Clientes activos' },
    { value: 'facturado', label: montoLabel },
  ];

  const data = rows.map((r) => ({
    month: monthLabel(r.month),
    valor: metrica === 'clientes' ? r.clientesActivos : r.facturado,
  }));

  const fmt = (v: number) => (metrica === 'clientes' ? formatNumber(v) : formatCompactCurrency(v));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        {METRICA_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setMetrica(o.value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              metrica === o.value
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
          <XAxis dataKey="month" stroke={chartTheme.axis} fontSize={12} />
          <YAxis stroke={chartTheme.axis} fontSize={11} tickFormatter={(v) => fmt(Number(v))} width={metrica === 'facturado' ? 64 : 40} />
          <Tooltip
            contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: chartTheme.tooltipText }}
            itemStyle={{ color: chartTheme.tooltipText }}
            formatter={(value) => fmt(Number(value))}
          />
          <Bar dataKey="valor" name={METRICA_OPTIONS.find((o) => o.value === metrica)!.label} fill={chartTheme.primary} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Line
            type="monotone"
            dataKey="valor"
            name="Tendencia"
            stroke={chartTheme.secondary}
            strokeWidth={2}
            dot={{ r: 3 }}
            isAnimationActive={false}
            legendType="none"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

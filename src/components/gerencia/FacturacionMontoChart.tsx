import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import { formatValue as fmt } from './format';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface Props {
  title: string;
  real: number[];
  nMeses: number;
}

/**
 * Igual que VentasGerenciaChart pero de una sola serie — para desgloses $
 * de Facturación (sillones/colchones/block/reventa/flete) que no tienen
 * objetivo por categoría en Odoo (ver el comentario grande de
 * facturacion-gerencia.ts): solo tiene sentido mostrar el real.
 */
export default function FacturacionMontoChart({ title, real, nMeses }: Props) {
  const chartTheme = useChartTheme();
  const data = MESES.slice(0, nMeses).map((mes, i) => ({ mes, real: real[i] ?? 0 }));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
          <XAxis dataKey="mes" stroke={chartTheme.axis} fontSize={11} />
          <YAxis stroke={chartTheme.axis} fontSize={11} tickFormatter={(v) => fmt(Number(v), 'currency')} width={56} />
          <Tooltip
            contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: chartTheme.tooltipText }}
            itemStyle={{ color: chartTheme.tooltipText }}
            formatter={(value: number) => fmt(value, 'currency')}
          />
          <Bar dataKey="real" name="Facturado" fill={chartTheme.primary} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

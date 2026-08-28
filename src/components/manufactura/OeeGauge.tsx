import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

interface Props {
  pct: number;
}

// Arc scales to 120% so over-performance still fits, per plan's "0-100% (o hasta 120%)".
const MAX_SCALE = 120;

function zoneColor(pct: number): string {
  if (pct < 60) return '#ef4444';
  if (pct < 85) return '#f59e0b';
  return '#10b981';
}

export default function OeeGauge({ pct }: Props) {
  const clamped = Math.max(0, Math.min(pct, MAX_SCALE));
  const data = [
    { value: clamped, fill: zoneColor(pct) },
    { value: MAX_SCALE - clamped, fill: '#1e293b' },
  ];

  return (
    <div className="relative mx-auto w-full max-w-xs">
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            startAngle={180}
            endAngle={0}
            cx="50%"
            cy="100%"
            innerRadius="70%"
            outerRadius="100%"
            stroke="none"
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center">
        <span className="text-4xl font-semibold text-slate-100">{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { useChartTheme } from '@/components/shared/useChartTheme';
import type { HistorialMovimiento, HistorialRango, HistorialResult, MovimientoTipo } from './types';

const RANGOS: { id: HistorialRango; label: string; periodo: string }[] = [
  { id: 'hoy', label: 'Hoy', periodo: 'ayer' },
  { id: '7d', label: '7 días', periodo: 'los 7 días anteriores' },
  { id: '30d', label: '30 días', periodo: 'los 30 días anteriores' },
  { id: '12m', label: '12 meses', periodo: 'los 12 meses anteriores' },
];

const TIPOS: { id: MovimientoTipo; label: string; verbo: string; glyph: string }[] = [
  { id: 'entrada', label: 'Entradas', verbo: 'Entró', glyph: '↓' },
  { id: 'salida', label: 'Salidas', verbo: 'Salió', glyph: '↑' },
  { id: 'interno', label: 'Internos', verbo: 'Movido', glyph: '⇄' },
  { id: 'consumo', label: 'Consumos', verbo: 'Consumió', glyph: '⚙' },
];
/** El resumen de arriba cuenta solo movimientos del depósito; los consumos van aparte. */
const TIPOS_DEPOSITO = TIPOS.filter((t) => t.id !== 'consumo');

const PAGINA = 100;
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_LARGO = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const intFmt = new Intl.NumberFormat('es-AR');
const qtyFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const BA = 'America/Argentina/Buenos_Aires';
const horaFmt = new Intl.DateTimeFormat('es-AR', { timeZone: BA, hour: '2-digit', minute: '2-digit' });
const diaFmt = new Intl.DateTimeFormat('es-AR', { timeZone: BA, weekday: 'long', day: 'numeric', month: 'long' });
const diaKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: BA }); // YYYY-MM-DD

const STYLES = `
@keyframes hist-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes hist-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes hist-pop { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
@keyframes hist-ping { 0% { transform: scale(1); opacity: .6; } 100% { transform: scale(2.6); opacity: 0; } }
.hist-up { animation: hist-up 480ms cubic-bezier(.22,1,.36,1) both; }
.hist-grow { transform-origin: left; animation: hist-grow 700ms cubic-bezier(.22,1,.36,1) both; }
.hist-pop { animation: hist-pop 420ms cubic-bezier(.22,1,.36,1) both; }
.hist-ping { animation: hist-ping 2s ease-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .hist-up, .hist-grow, .hist-pop, .hist-ping { animation: none; }
}
`;

/** Número que "corre" hasta su valor — da vida al cambiar de rango sin librerías. */
function useCountUp(target: number, ms = 800): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = origin + (target - origin) * eased;
      from.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return Math.round(value);
}

type TipoTheme = { primary: string; secondary: string; danger: string; warn: string };

function tipoColor(tipo: MovimientoTipo, theme: TipoTheme): string {
  return tipo === 'entrada' ? theme.secondary : tipo === 'salida' ? theme.danger : tipo === 'consumo' ? theme.warn : theme.primary;
}

function Card({ title, subtitle, children, delay = 0, className = '' }: { title: string; subtitle?: string; children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <section className={`hist-up rounded-xl border border-slate-800 bg-slate-900 p-4 ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <h3 className="text-sm font-medium text-slate-200">{title}</h3>
      {subtitle && <p className="mb-3 text-xs text-slate-500">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- Hero

function Hero({ data }: { data: HistorialResult }) {
  const { totales } = data;
  const total = useCountUp(totales.total);
  const rango = RANGOS.find((r) => r.id === data.rango)!;
  const delta = data.totalAnterior > 0 ? ((totales.total - data.totalAnterior) / data.totalAnterior) * 100 : null;
  const sube = delta !== null && delta >= 0;
  const partes = TIPOS_DEPOSITO.map((t) => ({ ...t, n: t.id === 'entrada' ? totales.entradas : t.id === 'salida' ? totales.salidas : totales.internos }));
  const entradas = useCountUp(totales.entradas);
  const salidas = useCountUp(totales.salidas);
  const internos = useCountUp(totales.internos);
  const counts = { entrada: entradas, salida: salidas, interno: internos };

  return (
    <section className="hist-up relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, rgb(var(--brand-500)), transparent)' }}
      />
      <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-center">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">Movimientos del depósito</p>
          <div className="mt-1 flex flex-wrap items-end gap-3">
            <span className="text-6xl font-semibold tabular-nums leading-none text-slate-100">{intFmt.format(total)}</span>
            {delta !== null && (
              <span
                className={`mb-1 rounded-full px-2 py-0.5 text-xs font-medium ${sube ? 'bg-status-green/15 text-status-green' : 'bg-status-red/15 text-status-red'}`}
                title={`${intFmt.format(data.totalAnterior)} movimientos en ${rango.periodo}`}
              >
                {sube ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}% vs {rango.periodo}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-400">
            {intFmt.format(totales.productos)} productos distintos · {intFmt.format(totales.ubicaciones)} ubicaciones tocadas
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
            {partes.map((p) =>
              p.n > 0 ? (
                <div
                  key={p.id}
                  className="hist-grow h-full"
                  style={{
                    width: `${(p.n / Math.max(1, totales.total)) * 100}%`,
                    background: p.id === 'entrada' ? 'rgb(var(--status-green))' : p.id === 'salida' ? 'rgb(var(--status-red))' : 'rgb(var(--brand-500))',
                  }}
                  title={`${p.label}: ${intFmt.format(p.n)}`}
                />
              ) : null
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {partes.map((p, i) => (
              <div key={p.id} className="hist-pop rounded-lg border border-slate-800 bg-slate-950/40 p-3" style={{ animationDelay: `${150 + i * 90}ms` }}>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span
                    className="grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: p.id === 'entrada' ? 'rgb(var(--status-green))' : p.id === 'salida' ? 'rgb(var(--status-red))' : 'rgb(var(--brand-500))' }}
                  >
                    {p.glyph}
                  </span>
                  {p.label}
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">{intFmt.format(counts[p.id as keyof typeof counts])}</p>
                <p className="text-xs text-slate-500">{totales.total ? Math.round((p.n / totales.total) * 100) : 0}% del total</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Serie

function Serie({ data }: { data: HistorialResult }) {
  const theme = useChartTheme();
  const unidad = data.rango === 'hoy' ? 'hora' : data.rango === '12m' ? 'mes' : 'día';
  return (
    <Card title="Pulso del depósito" subtitle={`Movimientos por ${unidad}, apilados por tipo`} delay={80}>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.serie} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs>
              {(['entradas', 'salidas', 'internos'] as const).map((k) => {
                const c = k === 'entradas' ? theme.secondary : k === 'salidas' ? theme.danger : theme.primary;
                return (
                  <linearGradient key={k} id={`hist-${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c} stopOpacity={0.75} />
                    <stop offset="100%" stopColor={c} stopOpacity={0.05} />
                  </linearGradient>
                );
              })}
            </defs>
            <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke={theme.axis} tick={{ fontSize: 11 }} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
            <YAxis stroke={theme.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8, color: theme.tooltipText, fontSize: 12 }}
              labelStyle={{ color: theme.tooltipText, fontWeight: 600 }}
              itemStyle={{ color: theme.tooltipText }}
            />
            <Area type="monotone" dataKey="internos" name="Internos" stackId="1" stroke={theme.primary} fill="url(#hist-internos)" strokeWidth={2} />
            <Area type="monotone" dataKey="entradas" name="Entradas" stackId="1" stroke={theme.secondary} fill="url(#hist-entradas)" strokeWidth={2} />
            <Area type="monotone" dataKey="salidas" name="Salidas" stackId="1" stroke={theme.danger} fill="url(#hist-salidas)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Heatmap

function Heatmap({ data }: { data: HistorialResult }) {
  const max = useMemo(() => Math.max(1, ...data.heatmap.flat()), [data.heatmap]);
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const pico = useMemo(() => {
    let best = { d: 0, h: 0, n: 0 };
    data.heatmap.forEach((row, d) => row.forEach((n, h) => n > best.n && (best = { d, h, n })));
    return best;
  }, [data.heatmap]);
  const info = hover ?? (pico.n > 0 ? { d: pico.d, h: pico.h } : null);

  return (
    <Card title="¿Cuándo se mueve el depósito?" subtitle="Día de la semana × hora del día (hora Argentina)" delay={160}>
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="ml-9 grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px] pb-1 text-center text-[10px] text-slate-500">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h}>{h % 3 === 0 ? h : ''}</span>
            ))}
          </div>
          {data.heatmap.map((row, d) => (
            <div key={d} className="mb-[3px] flex items-center gap-1">
              <span className="w-8 text-right text-[11px] text-slate-500">{DIAS[d]}</span>
              <div className="grid flex-1 grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px]">
                {row.map((n, h) => {
                  const active = hover?.d === d && hover.h === h;
                  return (
                    <div
                      key={h}
                      onMouseEnter={() => setHover({ d, h })}
                      onMouseLeave={() => setHover(null)}
                      className="hist-pop aspect-square rounded-[4px] transition-transform hover:scale-125"
                      style={{
                        animationDelay: `${(d * 24 + h) * 4}ms`,
                        background:
                          n === 0 ? 'rgb(var(--slate-800) / 0.6)' : `color-mix(in srgb, rgb(var(--brand-500)) ${Math.round(18 + (n / max) * 82)}%, rgb(var(--slate-800)))`,
                        outline: active ? '2px solid rgb(var(--slate-100))' : 'none',
                        zIndex: active ? 1 : 0,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 min-h-[1.25rem] text-xs text-slate-400">
        {info ? (
          <>
            <span className="font-medium text-slate-200">
              {DIAS_LARGO[info.d]} {String(info.h).padStart(2, '0')}:00
            </span>{' '}
            — {intFmt.format(data.heatmap[info.d]![info.h]!)} movimientos{!hover && pico.n > 0 ? ' (hora pico del período)' : ''}
          </>
        ) : (
          'Sin movimientos en el período.'
        )}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------- Ranking

function Ranking({ titulo, subtitulo, items, color, delay, onPick, picked, header }: {
  titulo: string;
  subtitulo?: string;
  items: { nombre: string; movimientos: number }[];
  color: string;
  delay: number;
  onPick?: (nombre: string) => void;
  picked?: string | null;
  header?: React.ReactNode;
}) {
  const max = Math.max(1, ...items.map((i) => i.movimientos));
  return (
    <Card title={titulo} subtitle={subtitulo} delay={delay}>
      {header}
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Sin datos en el período.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((it, i) => {
            const activo = picked === it.nombre;
            const inner = (
              <>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className={`truncate ${activo ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>
                    <span className="mr-1.5 text-slate-600">{i + 1}</span>
                    {it.nombre}
                  </span>
                  <span className="tabular-nums text-slate-400">{intFmt.format(it.movimientos)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div className="hist-grow h-full rounded-full" style={{ width: `${(it.movimientos / max) * 100}%`, background: color, animationDelay: `${delay + i * 60}ms` }} />
                </div>
              </>
            );
            return (
              <li key={it.nombre}>
                {onPick ? (
                  <button type="button" onClick={() => onPick(it.nombre)} className="block w-full text-left" title="Filtrar la línea de tiempo">
                    {inner}
                  </button>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Consumos

function Consumos({ data, color }: { data: HistorialResult; color: string }) {
  const { consumos } = data;
  const total = useCountUp(consumos.total);
  const partes = [
    { label: 'Fabricación', n: consumos.fabricacion },
    { label: 'Reparaciones', n: consumos.reparacion },
    { label: 'Otros', n: consumos.otros },
  ];
  return (
    <Ranking
      titulo="Consumos de PRE-PRODUCCION"
      subtitulo="Lo que se retira de PRE-PRODUCCION para fabricar y reparar"
      items={consumos.topProductos}
      color={color}
      delay={280}
      header={
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <span className="text-4xl font-semibold tabular-nums leading-none text-slate-100">{intFmt.format(total)}</span>
            <span className="mb-0.5 text-xs text-slate-500">líneas consumidas en el período</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {partes.map((p) => (
              <div key={p.label} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                <p className="text-[11px] text-slate-500">{p.label}</p>
                <p className="text-lg font-semibold tabular-nums text-slate-100">{intFmt.format(p.n)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Más consumidos</p>
        </div>
      }
    />
  );
}

// ---------------------------------------------------------------- Timeline

function Timeline({ data, theme }: { data: HistorialResult; theme: TipoTheme }) {
  const [tipo, setTipo] = useState<MovimientoTipo | null>(null);
  const [rack, setRack] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [visibles, setVisibles] = useState(PAGINA);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => setVisibles(PAGINA), [tipo, rack, q, abierto, data]);
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [abierto]);

  // Los consumos son muchos más que los movimientos del depósito: solo se mezclan
  // al elegir el filtro "Consumos" o al buscar, para no taparlos en la vista normal.
  const base = useMemo(() => {
    if (tipo === 'consumo') return data.consumos.recientes;
    if (q.trim() && !tipo && !rack) return [...data.recientes, ...data.consumos.recientes].sort((a, b) => b.fecha.localeCompare(a.fecha));
    return data.recientes;
  }, [data.recientes, data.consumos.recientes, tipo, q, rack]);

  const filtrados = useMemo(
    () =>
      base.filter((m) => {
        if (tipo && m.tipo !== tipo) return false;
        if (q && !`${m.producto} ${m.origen} ${m.destino} ${m.referencia ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
        if (rack) {
          const celda = m.tipo === 'salida' ? m.origen : m.destino;
          const r = /^([A-F])\.\d+\.[A-F]$/.test(celda) ? `Rack ${celda[0]}` : 'Otros';
          if (r !== rack) return false;
        }
        return true;
      }),
    [base, tipo, rack, q]
  );

  const grupos = useMemo(() => {
    const map = new Map<string, { titulo: string; items: HistorialMovimiento[] }>();
    for (const m of filtrados.slice(0, visibles)) {
      const d = new Date(m.fecha);
      const key = diaKeyFmt.format(d);
      if (!map.has(key)) map.set(key, { titulo: diaFmt.format(d), items: [] });
      map.get(key)!.items.push(m);
    }
    return [...map.values()];
  }, [filtrados, visibles]);

  const filtros = (
    <div className="flex flex-wrap items-center gap-2">
      {TIPOS.map((t) => {
        const on = tipo === t.id;
        const c = tipoColor(t.id, theme);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTipo(on ? null : t.id)}
            className="rounded-full border px-3 py-1 text-xs transition-colors"
            style={on ? { background: c, borderColor: c, color: '#fff' } : { borderColor: 'rgb(var(--slate-700))', color: 'rgb(var(--slate-400))' }}
          >
            {t.glyph} {t.label}
          </button>
        );
      })}
      {(tipo || rack || q) && (
        <button type="button" onClick={() => (setTipo(null), setRack(null), setQ(''))} className="text-xs text-slate-500 underline hover:text-slate-300">
          limpiar filtros{rack ? ` (${rack})` : ''}
        </button>
      )}
    </div>
  );

  const lista = (
    <>
      {grupos.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">No hay movimientos con ese filtro.</p>
      ) : (
        grupos.map((g) => (
          <div key={g.titulo} className="mb-4 last:mb-0">
            <p className="sticky top-0 z-10 bg-slate-900 py-1 text-xs font-medium uppercase tracking-wide text-slate-500">{g.titulo}</p>
            <ol className="relative ml-2 border-l border-slate-800 pl-5">
              {g.items.map((m, i) => {
                const c = tipoColor(m.tipo, theme);
                const t = TIPOS.find((x) => x.id === m.tipo)!;
                const reciente = i === 0 && g === grupos[0];
                return (
                  <li key={m.id} className="hist-up relative pb-3" style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
                    <span className="absolute -left-[27px] top-1 grid h-3.5 w-3.5 place-items-center">
                      {reciente && <span className="hist-ping absolute h-3.5 w-3.5 rounded-full" style={{ background: c }} />}
                      <span className="relative h-2.5 w-2.5 rounded-full ring-4 ring-slate-900" style={{ background: c }} />
                    </span>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="min-w-0 truncate text-sm text-slate-200">{m.producto}</p>
                      <span className="text-xs tabular-nums text-slate-500">{horaFmt.format(new Date(m.fecha))}</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      <span style={{ color: c }} className="font-medium">
                        {t.verbo}
                      </span>{' '}
                      {qtyFmt.format(m.cantidad)} {m.unidad} · {m.origen} <span className="text-slate-600">→</span> {m.destino}
                      {m.referencia && <span className="text-slate-500"> · {m.referencia}</span>}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>
        ))
      )}
      {filtrados.length > visibles && (
        <button
          type="button"
          onClick={() => setVisibles((v) => v + PAGINA)}
          className="mt-2 w-full rounded-lg border border-slate-700 py-2 text-xs text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100"
        >
          Mostrar {Math.min(PAGINA, filtrados.length - visibles)} más ({intFmt.format(filtrados.length - visibles)} restantes)
        </button>
      )}
    </>
  );

  const esConsumo = tipo === 'consumo';
  const total = esConsumo ? data.consumos.total : data.totales.total;
  const cargados = base.length;
  const hayMasQueCargados = !q.trim() && total > cargados;
  const conteo = `${intFmt.format(filtrados.length)} de ${intFmt.format(total)} ${esConsumo ? 'consumos' : 'movimientos'}${hayMasQueCargados ? ` (se cargan los ${intFmt.format(cargados)} más recientes)` : ''}`;

  return (
    <div className="flex h-full flex-col gap-4">
      {abierto &&
        createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6" onClick={() => setAbierto(false)}>
          <div className="hist-pop flex h-full max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-100">Línea de tiempo completa</h3>
                <p className="text-xs text-slate-500">{conteo}</p>
              </div>
              <button type="button" onClick={() => setAbierto(false)} className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-600 hover:text-slate-100">
                Cerrar ✕
              </button>
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar producto o ubicación…"
              className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
            />
            <div className="mb-3">{filtros}</div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">{lista}</div>
          </div>
        </div>,
        document.body
      )}

      <Ranking
        titulo="Actividad por rack"
        subtitulo="Tocá un rack para filtrar la línea de tiempo"
        items={data.porRack}
        color="rgb(var(--brand-500))"
        delay={240}
        onPick={(n) => setRack((r) => (r === n ? null : n))}
        picked={rack}
      />

      <Card title="Línea de tiempo" subtitle={conteo} delay={320} className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex flex-col gap-3">
          {filtros}
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="rounded-lg border border-brand-500/60 bg-brand-500/10 py-2 text-sm font-medium text-brand-400 transition-colors hover:bg-brand-500/20"
          >
            ⤢ Ver línea de tiempo completa
          </button>
        </div>
        {/* En pantallas anchas la lista se estira hasta la altura de la columna de al lado; el absolute evita que su contenido agrande la fila. */}
        <div className="relative min-h-[420px] flex-1">
          <div className="absolute inset-0 overflow-y-auto pr-1">{lista}</div>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- App

function HistorialInner() {
  const [rango, setRango] = useState<HistorialRango>('7d');
  const theme = useChartTheme();
  const query = useApiQuery<HistorialResult>(['almacen-historial', rango], `/api/almacen-historial?rango=${rango}`);
  const idx = RANGOS.findIndex((r) => r.id === rango);

  return (
    <div className="flex flex-col gap-4">
      <style>{STYLES}</style>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative inline-grid grid-cols-4 rounded-full border border-slate-800 bg-slate-900 p-1">
          <span
            className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-full transition-transform duration-300 ease-out"
            style={{ transform: `translateX(${idx * 100}%)`, background: 'rgb(var(--brand-500))' }}
          />
          {RANGOS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRango(r.id)}
              className={`relative z-10 px-4 py-1.5 text-sm transition-colors ${rango === r.id ? 'font-medium text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {query.isFetching && <span className="text-xs text-slate-500 animate-pulse-slow">actualizando…</span>}
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
        </div>
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudo cargar el historial: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading || !query.data ? (
        <div className="flex flex-col gap-4">
          <div className="h-44 w-full animate-pulse-slow rounded-xl bg-slate-800/60" />
          <div className="h-72 w-full animate-pulse-slow rounded-xl bg-slate-800/60" />
        </div>
      ) : (
        <div key={rango} className={`flex flex-col gap-4 transition-opacity ${query.isFetching ? 'opacity-60' : ''}`}>
          {query.data.truncado && (
            <p className="rounded border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-300">
              El período tiene más movimientos de los que se pueden leer de una vez: los números son un piso, no el total exacto.
            </p>
          )}
          <Hero data={query.data} />
          <Serie data={query.data} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <Heatmap data={query.data} />
              <div className="grid gap-4 md:grid-cols-2">
                <Ranking titulo="Productos más movidos" items={query.data.topProductos} color="rgb(var(--status-green))" delay={200} />
                <Ranking titulo="Ubicaciones más activas" subtitulo="Celdas con más movimientos" items={query.data.topUbicaciones} color="rgb(var(--status-yellow))" delay={260} />
              </div>
              <Consumos data={query.data} color={theme.warn} />
            </div>
            <div className="min-w-0">
              <Timeline data={query.data} theme={theme} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function HistorialApp() {
  return (
    <QueryProvider>
      <HistorialInner />
    </QueryProvider>
  );
}

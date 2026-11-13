import { Fragment, useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import { useChartTheme } from '@/components/shared/useChartTheme';
import LastUpdated from '@/components/shared/LastUpdated';
import Tip from '@/components/shared/Tip';
import type { DiaProductividad, GrupoKey, ProductividadResult } from '@/lib/productividad-horas';

type Vista = 'planta' | 'living' | 'colchones';

const VISTAS: { key: Vista; label: string; nota: string }[] = [
  { key: 'planta', label: 'Planta', nota: 'Living + Colchones, con las horas de todo producción (Espumado, Almacén, Mantenimiento y apoyo incluidos).' },
  { key: 'living', label: 'Living', nota: 'Sillones terminados ÷ horas de quienes figuran en Producción / Living.' },
  { key: 'colchones', label: 'Colchones', nota: 'Colchones terminados ÷ horas de quienes figuran en Producción / Colchones (y Espumado si está tildado).' },
];

const n1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const n2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function etiquetaDia(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return `${DIAS_SEMANA[dow]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

interface Metricas {
  dia: string;
  etiqueta: string;
  enCurso: boolean;
  /** Falta la salida de más del 25% de las jornadas: las horas quedan subestimadas y el ratio inflado. */
  poco: boolean;
  ueq: number;
  horas: number;
  personas: number;
  incompletas: number;
  ordenes: number;
  /** ueq por hora-hombre; null si no hay datos para dividir. */
  prod: number | null;
  gente: [string, number][];
  productos: [string, number][];
}

function metricasDe(d: DiaProductividad, vista: Vista, conEspumado: boolean): Metricas {
  const g = d.grupos;
  const sumar = (keys: GrupoKey[], campo: 'horas' | 'personas' | 'incompletas') => keys.reduce((s, k) => s + g[k][campo], 0);
  const keysHoras: GrupoKey[] = vista === 'planta' ? ['living', 'colchones', 'espumado', 'apoyo'] : vista === 'living' ? ['living'] : conEspumado ? ['colchones', 'espumado'] : ['colchones'];
  const keysUeq: GrupoKey[] = vista === 'planta' ? ['living', 'colchones'] : [vista];
  const ueq = keysUeq.reduce((s, k) => s + g[k].ueq, 0);
  const horas = sumar(keysHoras, 'horas');
  const gente = keysHoras.flatMap((k) => g[k].gente);
  const productos = keysUeq.flatMap((k) => g[k].productos).sort((a, b) => b[1] - a[1]);
  return {
    dia: d.dia,
    etiqueta: etiquetaDia(d.dia),
    enCurso: d.enCurso,
    poco: sumar(keysHoras, 'incompletas') > 0.25 * (sumar(keysHoras, 'personas') + sumar(keysHoras, 'incompletas')),
    ueq,
    horas,
    personas: sumar(keysHoras, 'personas'),
    incompletas: sumar(keysHoras, 'incompletas'),
    ordenes: keysUeq.reduce((s, k) => s + g[k].ordenes, 0),
    prod: horas > 0 && ueq > 0 ? ueq / horas : null,
    gente: gente.sort((a, b) => a[0].localeCompare(b[0], 'es')),
    productos,
  };
}

/** Regresión lineal simple ueq = a + b·horas. */
function regresion(pts: { x: number; y: number }[]): { a: number; b: number; r: number } | null {
  const n = pts.length;
  if (n < 4) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b, r: sxy / Math.sqrt(sxx * syy) };
}

const ORIGEN_PROD = 'Producción: órdenes de fabricación en estado «Hecho» de Odoo (Fabricación), por fecha de fin, en unidades equivalentes (campo x_studio_unidades_eq). Sillón → Living, Colchones → Colchones; los intermedios (PI) no cuentan.';
const ORIGEN_HORAS = 'Horas: del fichador facial (Supabase, tabla fichaje_marcas). Por persona y día, de la primera entrada a la última salida; incluyen almuerzo y descansos. Cada persona suma al sector de su departamento en Odoo (Empleados).';

function Kpi({ titulo, valor, sub, tono, tip }: { titulo: string; valor: string; sub?: string; tono?: 'ok' | 'mal'; tip: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        <Tip text={tip} className="cursor-help border-b border-dotted border-slate-500">{titulo}</Tip>
      </p>
      <p className={`mt-1 text-2xl font-semibold ${tono === 'ok' ? 'text-emerald-400' : tono === 'mal' ? 'text-red-400' : 'text-slate-100'}`}>{valor}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function ProductividadInner() {
  const [vista, setVista] = useState<Vista>('planta');
  const [rango, setRango] = useState<7 | 14 | 0>(0);
  const [conEspumado, setConEspumado] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);
  const tema = useChartTheme();

  const query = useApiQuery<ProductividadResult>(['productividad-horas'], '/api/productividad-horas?dias=60');
  const data = query.data;

  const filas = useMemo(() => {
    if (!data) return [];
    let dias = data.dias.map((d) => metricasDe(d, vista, conEspumado)).filter((m) => m.horas > 0 || m.ueq > 0);
    if (rango > 0) {
      const corte = new Date(Date.parse(`${data.hasta}T00:00:00Z`) - rango * 86_400_000).toISOString().slice(0, 10);
      dias = dias.filter((m) => m.dia > corte);
    }
    return dias;
  }, [data, vista, rango, conEspumado]);

  const validos = filas.filter((m) => !m.enCurso && !m.poco && m.prod !== null);
  const totUeq = validos.reduce((s, m) => s + m.ueq, 0);
  const totHoras = validos.reduce((s, m) => s + m.horas, 0);
  const prodMedia = totHoras > 0 ? totUeq / totHoras : null;
  const personasMedia = validos.length ? validos.reduce((s, m) => s + m.personas, 0) / validos.length : 0;
  const mejor = validos.reduce<Metricas | null>((a, m) => (!a || m.prod! > a.prod! ? m : a), null);
  const peor = validos.reduce<Metricas | null>((a, m) => (!a || m.prod! < a.prod! ? m : a), null);
  const reg = useMemo(() => regresion(validos.map((m) => ({ x: m.horas, y: m.ueq }))), [validos]);
  const totIncompletas = filas.reduce((s, m) => s + m.incompletas, 0);
  const nota = VISTAS.find((v) => v.key === vista)!.nota;

  const chart = validos.map((m) => ({ dia: m.etiqueta, ueq: Math.round(m.ueq), prod: Math.round(m.prod! * 100) / 100 }));
  const dispersion = validos.map((m) => ({ x: Math.round(m.horas), y: Math.round(m.ueq), dia: m.etiqueta, prod: m.prod! }));
  const xs = dispersion.map((p) => p.x);
  const tendencia = reg && xs.length ? [Math.min(...xs), Math.max(...xs)].map((x) => ({ x, y: Math.round(reg.a + reg.b * x) })) : [];
  const tooltipStyle = { background: tema.tooltipBg, border: `1px solid ${tema.tooltipBorder}`, borderRadius: 8 };

  const maquinasSinOperador = (data?.maquinas ?? []).filter((q) => q.hoyPresente === false);
  const maquinasOrdenadas = [...(data?.maquinas ?? [])].sort((a, b) => Number(b.hoyPresente === false) - Number(a.hoyPresente === false) || a.codigo.localeCompare(b.codigo));

  if (query.isLoading && !data) return <p className="text-sm text-slate-400">Cruzando producción con fichadas…</p>;
  if (query.error && !data) return <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{(query.error as Error).message}</p>;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-md border border-slate-700 text-sm">
            {VISTAS.map((v) => (
              <button key={v.key} type="button" onClick={() => setVista(v.key)} className={`px-4 py-1.5 ${vista === v.key ? 'bg-slate-700 text-slate-100' : 'bg-slate-900 text-slate-400 hover:text-slate-200'}`}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-md border border-slate-700 text-sm">
            {([[7, '7 días'], [14, '14 días'], [0, 'Todo']] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setRango(k)} className={`px-3 py-1.5 ${rango === k ? 'bg-slate-700 text-slate-100' : 'bg-slate-900 text-slate-400 hover:text-slate-200'}`}>
                {label}
              </button>
            ))}
          </div>
          {vista === 'colchones' && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={conEspumado} onChange={(e) => setConEspumado(e.target.checked)} />
              Sumar horas de Espumado
            </label>
          )}
        </div>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>
      <p className="-mt-3 text-xs text-slate-500">{nota}</p>

      {validos.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-8 text-center text-sm text-slate-400">
          Todavía no hay días completos con producción y fichadas en este período.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi tip={`Unidades equivalentes terminadas ÷ horas-hombre presentes, sumando todos los días válidos del período (no es un promedio de promedios).

${ORIGEN_PROD}

${ORIGEN_HORAS}`} titulo="Unidades eq. por hora-hombre" valor={prodMedia !== null ? n2.format(prodMedia) : '—'} sub={`${n0.format(totUeq)} ueq ÷ ${n0.format(totHoras)} hs presentes · ${validos.length} días`} />
            <Kpi tip={`Es la inversa del indicador anterior: cuántas horas de gente presente cuesta cada unidad equivalente.

${ORIGEN_PROD}

${ORIGEN_HORAS}`} titulo="Horas-hombre por unidad" valor={prodMedia ? n2.format(1 / prodMedia) : '—'} sub="Cuántas horas de gente presente cuesta cada unidad equivalente" />
            <Kpi tip={`Personas con jornada completa (entrada y salida) por día, en promedio, y horas promedio de cada jornada.

${ORIGEN_HORAS}`} titulo="Dotación media" valor={`${n0.format(personasMedia)} personas`} sub={`${n1.format(totHoras / Math.max(1, validos.reduce((s, m) => s + m.personas, 0)))} hs promedio por jornada`} />
            {mejor && peor && (
              <Kpi
                tip={`Los días con mayor y menor unidades por hora-hombre del período, y cuánto se alejan del promedio. Los días en curso o con muchas fichadas incompletas no participan.

${ORIGEN_PROD}

${ORIGEN_HORAS}`}
                titulo="Mejor / peor día"
                valor={`${n2.format(mejor.prod!)} / ${n2.format(peor.prod!)}`}
                sub={`${mejor.etiqueta} (+${n0.format(((mejor.prod! / prodMedia!) - 1) * 100)}%) · ${peor.etiqueta} (${n0.format(((peor.prod! / prodMedia!) - 1) * 100)}%)`}
              />
            )}
          </div>

          <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-1 text-sm font-medium text-slate-200">
              <Tip text={`${ORIGEN_PROD}

${ORIGEN_HORAS}`} className="cursor-help border-b border-dotted border-slate-500">Producción y productividad por día</Tip>
            </h3>
            <p className="mb-3 text-xs text-slate-500">Barras: unidades equivalentes terminadas. Línea: unidades por hora-hombre presente.</p>
            <div className="overflow-x-auto">
              <div style={{ width: Math.max(chart.length * 70, 480), height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={tema.grid} />
                    <XAxis dataKey="dia" stroke={tema.axis} fontSize={12} />
                    <YAxis yAxisId="ueq" stroke={tema.axis} fontSize={12} width={50} />
                    <YAxis yAxisId="prod" orientation="right" stroke={tema.axisSecondary} fontSize={12} width={40} domain={[0, 'auto']} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: tema.tooltipText }} />
                    <Legend />
                    <Bar yAxisId="ueq" dataKey="ueq" name="Unidades eq." fill={tema.mutedBar} isAnimationActive={false} />
                    <Line yAxisId="prod" type="monotone" dataKey="prod" name="ueq / hora-hombre" stroke={tema.primary} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h3 className="mb-1 text-sm font-medium text-slate-200">
                <Tip text={`Regresión lineal simple entre las horas-hombre de cada día y las unidades terminadas ese día (línea punteada). Con pocos días es orientativa.

${ORIGEN_PROD}

${ORIGEN_HORAS}`} className="cursor-help border-b border-dotted border-slate-500">¿Más horas = más producción?</Tip>
              </h3>
              <p className="mb-3 text-xs text-slate-500">Cada punto es un día: horas-hombre presentes contra unidades terminadas.</p>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={tema.grid} />
                    <XAxis type="number" dataKey="x" name="Horas" stroke={tema.axis} fontSize={12} domain={['auto', 'auto']} label={{ value: 'horas-hombre', position: 'insideBottom', offset: -8, fill: tema.axis, fontSize: 11 }} />
                    <YAxis type="number" dataKey="y" name="ueq" stroke={tema.axis} fontSize={12} width={50} domain={['auto', 'auto']} />
                    <ZAxis range={[70, 70]} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      cursor={{ strokeDasharray: '3 3' }}
                      content={({ active, payload }) => {
                        const p = active ? (payload?.[0]?.payload as { dia?: string; x: number; y: number; prod?: number } | undefined) : undefined;
                        if (!p?.dia) return null;
                        return (
                          <div className="rounded-lg border px-3 py-2 text-xs" style={{ background: tema.tooltipBg, borderColor: tema.tooltipBorder, color: tema.tooltipText }}>
                            <p className="font-medium">{p.dia}</p>
                            <p>{n0.format(p.x)} hs · {n0.format(p.y)} ueq</p>
                            <p>{n2.format(p.prod ?? 0)} ueq/hora</p>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={dispersion} fill={tema.primary} isAnimationActive={false} />
                    {tendencia.length === 2 && <Scatter data={tendencia} line={{ stroke: tema.warn, strokeWidth: 2, strokeDasharray: '5 4' }} shape={() => <g />} isAnimationActive={false} legendType="none" />}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h3 className="text-sm font-medium text-slate-200">Lectura</h3>
              {reg ? (
                <ul className="flex flex-col gap-2 text-sm text-slate-300">
                  <li>
                    Cada <strong>+100 horas-hombre</strong> presentes se asocian a{' '}
                    <strong className={reg.b >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {reg.b >= 0 ? '+' : ''}
                      {n0.format(reg.b * 100)} ueq
                    </strong>{' '}
                    (correlación {n2.format(reg.r)}, sobre {validos.length} días).
                  </li>
                  {prodMedia !== null && (
                    <li>
                      {reg.b < prodMedia * 0.85
                        ? `El rendimiento de las horas adicionales (${n2.format(reg.b)} ueq/h) es menor que el promedio (${n2.format(prodMedia)}): sumar gente rinde menos que lo que ya rinde el equipo — o hay días con horas que no producen (esperas, falta de material).`
                        : reg.b > prodMedia * 1.15
                          ? `Las horas adicionales rinden más (${n2.format(reg.b)} ueq/h) que el promedio (${n2.format(prodMedia)}): los días con más gente producen proporcionalmente más.`
                          : `Las horas adicionales rinden casi igual que el promedio (${n2.format(reg.b)} vs ${n2.format(prodMedia)} ueq/h): la producción escala con la dotación.`}
                    </li>
                  )}
                  {Math.abs(reg.r) < 0.5 && <li className="text-slate-400">La relación es débil: la producción del día depende de otras cosas además de cuánta gente vino (mix de productos, material disponible, plan).</li>}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">Hacen falta al menos 4 días completos para analizar la relación entre horas y producción.</p>
              )}
              <div className="mt-auto rounded-md bg-slate-800/60 p-3 text-xs text-slate-400">
                <p className="mb-1 font-medium text-slate-300">Cómo leer estos números</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>Horas = de la primera entrada a la última salida del fichador. Incluyen almuerzo y descansos: sirven para comparar días, no para medir tiempo efectivo.</li>
                  <li>Producción = órdenes terminadas ese día en Odoo, en unidades equivalentes. Una orden que se termina un día puede haberse trabajado en varios: mirá tendencias de varios días más que un día suelto.</li>
                  <li>Se cruza por sector (departamento de Odoo), no por persona: no se puede saber qué hizo cada uno.</li>
                </ul>
                {(totIncompletas > 0 || data.fueraDeProduccion > 0) && (
                  <p className="mt-2 text-status-yellow">
                    {totIncompletas > 0 && `${totIncompletas} jornadas con entrada sin salida (o fuera de 1–14 hs) no suman horas. `}
                    {data.fueraDeProduccion > 0 && `${data.fueraDeProduccion} personas con fichadas no están en un departamento de producción de Odoo.`}
                  </p>
                )}
              </div>
            </section>
          </div>
        </>
      )}

      <details className="rounded-lg border border-slate-800 bg-slate-900 p-4" open={maquinasSinOperador.length > 0}>
        <summary className="cursor-pointer text-sm font-medium text-slate-200">
          <Tip text={'Equipos de Odoo › Mantenimiento: el operador es el campo «Responsable» de cada equipo (se excluyen las herramientas neumáticas NEU-). «Días presente» y «Hoy» salen de si ese empleado fichó entrada en el fichador facial (Supabase, fichaje_marcas). Se cuentan solo los días en que fichó bastante gente (día de trabajo).'} className="cursor-help border-b border-dotted border-slate-500">Máquinas y operadores (Mantenimiento de Odoo)</Tip>
          {data.diasDeTrabajo.length > 0 && maquinasSinOperador.length > 0 && (
            <span className="ml-2 rounded bg-red-500/15 px-2 py-0.5 text-xs font-normal text-red-300">{maquinasSinOperador.length} sin operador hoy</span>
          )}
        </summary>
        <p className="mb-3 mt-2 text-xs text-slate-500">
          El operador sale del campo «Responsable» de cada equipo en Mantenimiento. Odoo no registra producción por máquina (no hay órdenes de trabajo), así que acá solo se ve si el operador vino:
          una máquina sin su operador probablemente esté parada o cubierta por otra persona.
        </p>
        <div className="max-h-96 overflow-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="border-b border-slate-800 uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1.5 pr-3">Máquina</th>
                <th className="py-1.5 pr-3">Operador</th>
                <th className="py-1.5 pr-3 text-right">Días presente</th>
                <th className="py-1.5 text-center">Hoy</th>
              </tr>
            </thead>
            <tbody>
              {maquinasOrdenadas.map((q) => (
                <tr key={`${q.codigo}${q.nombre}${q.operador}`} className="border-b border-slate-800/50">
                  <td className="py-1.5 pr-3 text-slate-300">
                    <span className="font-mono text-slate-500">{q.codigo}</span> {q.nombre}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-300">{q.operador}</td>
                  <td className={`py-1.5 pr-3 text-right ${data.diasDeTrabajo.length > 0 && q.diasPresente < data.diasDeTrabajo.length * 0.8 ? 'text-status-yellow' : 'text-slate-400'}`}>
                    {q.diasPresente} / {data.diasDeTrabajo.length}
                  </td>
                  <td className="py-1.5 text-center">{q.hoyPresente === null ? <span className="text-slate-600">—</span> : q.hoyPresente ? <span className="text-emerald-400">✓</span> : <span className="text-red-400">✗</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <section className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Día</th>
              <th className="px-3 py-2 text-right"><Tip text={"Personas del sector con jornada completa ese día (entrada y salida). El «+N?» son las que tienen entrada sin salida: no suman horas. Fuente: fichador facial."} className="cursor-help border-b border-dotted border-slate-600">Personas</Tip></th>
              <th className="px-3 py-2 text-right"><Tip text={"Suma de las horas presentes (primera entrada → última salida) de esas personas. Fuente: fichador facial."} className="cursor-help border-b border-dotted border-slate-600">Horas-hombre</Tip></th>
              <th className="px-3 py-2 text-right"><Tip text={"Órdenes de fabricación terminadas ese día con unidades equivalentes mayores a 0. Fuente: Odoo › Fabricación."} className="cursor-help border-b border-dotted border-slate-600">Órdenes</Tip></th>
              <th className="px-3 py-2 text-right"><Tip text={"Suma de x_studio_unidades_eq de esas órdenes, por fecha de fin (hora Argentina). Fuente: Odoo › Fabricación."} className="cursor-help border-b border-dotted border-slate-600">Unidades eq.</Tip></th>
              <th className="px-3 py-2 text-right"><Tip text={"Unidades equivalentes ÷ horas-hombre del día. Se muestra «—» si el día está en curso o tiene muchas fichadas incompletas."} className="cursor-help border-b border-dotted border-slate-600">ueq / hora</Tip></th>
              <th className="px-3 py-2 text-right"><Tip text={"Diferencia del ueq/hora del día contra el promedio ponderado del período."} className="cursor-help border-b border-dotted border-slate-600">vs. promedio</Tip></th>
            </tr>
          </thead>
          <tbody>
            {[...filas].reverse().map((m) => {
              const delta = m.prod !== null && !m.poco && prodMedia ? (m.prod / prodMedia - 1) * 100 : null;
              const abierta = abierto === m.dia;
              return (
                <Fragment key={m.dia}>
                  <tr onClick={() => setAbierto(abierta ? null : m.dia)} className="cursor-pointer border-b border-slate-800/60 hover:bg-slate-800/40">
                    <td className="px-3 py-2 text-slate-200">
                      {abierta ? '▾' : '▸'} {m.etiqueta}
                      {m.enCurso && <span className="ml-2 rounded bg-status-yellow/15 px-1.5 py-0.5 text-[10px] text-status-yellow">en curso</span>}
                      {m.poco && !m.enCurso && <span className="ml-2 rounded bg-status-yellow/15 px-1.5 py-0.5 text-[10px] text-status-yellow" title="Falta la salida de muchas jornadas: no entra en promedios ni gráficos">fichadas incompletas</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {m.personas}
                      {m.incompletas > 0 && <span className="ml-1 text-xs text-status-yellow" title="Entradas sin salida: no suman horas">+{m.incompletas}?</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">{n0.format(m.horas)}</td>
                    <td className="px-3 py-2 text-right text-slate-300">{m.ordenes}</td>
                    <td className="px-3 py-2 text-right text-slate-300">{n0.format(m.ueq)}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-100">{m.prod !== null && !m.enCurso && !m.poco ? n2.format(m.prod) : '—'}</td>
                    <td className={`px-3 py-2 text-right ${delta === null || m.enCurso || m.poco ? 'text-slate-500' : delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {delta === null || m.enCurso || m.poco ? '—' : `${delta >= 0 ? '+' : ''}${n0.format(delta)}%`}
                    </td>
                  </tr>
                  {abierta && (
                    <tr className="border-b border-slate-800/60 bg-slate-950/40">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs font-medium text-slate-400">Qué se terminó ({m.ordenes} órdenes)</p>
                            <ul className="max-h-60 overflow-y-auto text-xs">
                              {m.productos.length === 0 && <li className="text-slate-500">Nada terminado.</li>}
                              {m.productos.map(([nombre, ueq]) => (
                                <li key={nombre} className="flex justify-between gap-3 border-b border-slate-800/50 py-1">
                                  <span className="truncate text-slate-300">{nombre}</span>
                                  <span className="shrink-0 font-mono text-slate-400">{n1.format(ueq)} ueq</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-medium text-slate-400">Quiénes estuvieron ({m.gente.length}) · horas presentes</p>
                            <ul className="max-h-60 overflow-y-auto text-xs">
                              {m.gente.map(([nombre, hs]) => (
                                <li key={nombre} className="flex justify-between gap-3 border-b border-slate-800/50 py-1">
                                  <span className="truncate text-slate-300">{nombre}</span>
                                  <span className={`shrink-0 font-mono ${hs < 6 ? 'text-status-yellow' : 'text-slate-400'}`}>{n1.format(hs)} h</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default function ProductividadApp() {
  return (
    <QueryProvider>
      <ProductividadInner />
    </QueryProvider>
  );
}

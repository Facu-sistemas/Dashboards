import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { SemaforoDonut, SectoresBars } from './SeguimientoMoCharts';
import type { SeguimientoGrupo, SeguimientoMoResult, SeguimientoSemaforo, SeguimientoUmbrales } from '@/lib/odoo/seguimiento-mo';

type SeguimientoResponse = SeguimientoMoResult & { umbralesDisponible: boolean };

const COLORS: Record<SeguimientoSemaforo, { label: string; text: string; bg: string; border: string; bar: string }> = {
  verde: { label: 'En tiempo', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', bar: 'bg-emerald-500' },
  amarillo: { label: 'Atención', text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/40', bar: 'bg-amber-500' },
  rojo: { label: 'Demorada', text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/40', bar: 'bg-red-500' },
};
const SEMAFOROS: SeguimientoSemaforo[] = ['verde', 'amarillo', 'rojo'];
const PAGE = 20;

const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

const pct = (n: number, total: number) => (total > 0 ? (n / total) * 100 : 0);
const fechaAr = (iso: string) => iso.split('-').reverse().join('/');

function rangoLabel(g: SeguimientoGrupo, c: SeguimientoSemaforo): string {
  const { amarilloDesde, rojoDesde } = g.umbrales;
  if (c === 'verde') return `menos de ${amarilloDesde} días`;
  if (c === 'amarillo') return `${amarilloDesde} a ${rojoDesde - 1} días`;
  return `${rojoDesde} días o más`;
}


const inputCls = 'w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-right text-slate-100 focus:border-brand-500 focus:outline-none';

function UmbralRow({ grupo, label, umbrales, onSaved }: { grupo: 'colchones' | 'living'; label: string; umbrales: SeguimientoUmbrales; onSaved: () => void }) {
  const [amarillo, setAmarillo] = useState(String(umbrales.amarilloDesde));
  const [rojo, setRojo] = useState(String(umbrales.rojoDesde));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setAmarillo(String(umbrales.amarilloDesde));
    setRojo(String(umbrales.rojoDesde));
  }, [umbrales.amarilloDesde, umbrales.rojoDesde]);

  const a = Number(amarillo);
  const r = Number(rojo);
  const valido = Number.isInteger(a) && Number.isInteger(r) && a >= 1 && r > a;
  const sinCambios = a === umbrales.amarilloDesde && r === umbrales.rojoDesde;

  async function guardar() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/seguimiento-mo-umbrales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grupo, amarilloDesde: a, rojoDesde: r }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'No se pudo guardar');
      setMsg({ ok: true, text: 'Guardado' });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <span className="w-24 pb-1.5 text-sm font-medium text-slate-200">{label}</span>
      <label className="flex flex-col gap-1 text-xs text-amber-400">
        Amarillo desde (días)
        <input type="number" min={1} value={amarillo} onChange={(e) => setAmarillo(e.target.value)} className={inputCls} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-red-400">
        Rojo desde (días)
        <input type="number" min={2} value={rojo} onChange={(e) => setRojo(e.target.value)} className={inputCls} />
      </label>
      <button
        type="button"
        onClick={guardar}
        disabled={!valido || sinCambios || saving}
        className="rounded bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? 'Guardando…' : 'Guardar'}
      </button>
      {!valido && <span className="pb-1.5 text-xs text-red-400">El rojo tiene que ser mayor que el amarillo</span>}
      {msg && <span className={`pb-1.5 text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</span>}
    </div>
  );
}

function ConfigSemaforo({ data, onSaved }: { data: SeguimientoResponse; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-medium text-slate-200">Configurar semáforo</span>
        <span className="text-xs text-slate-500">{open ? 'Ocultar' : 'Mostrar'}</span>
      </button>
      {open && (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-xs text-slate-500">
            Días corridos desde la creación de la MO. Verde es todo lo que está por debajo del amarillo. Los cambios aplican a todos los usuarios.
          </p>
          {!data.umbralesDisponible && (
            <p className="rounded border border-amber-900 bg-amber-950/40 p-2 text-xs text-amber-300">
              La tabla seguimiento_mo_umbrales todavía no existe en Supabase: se usan los valores por defecto y los cambios no se pueden guardar.
            </p>
          )}
          <UmbralRow grupo="colchones" label="Colchones" umbrales={data.colchones.umbrales} onSaved={onSaved} />
          <UmbralRow grupo="living" label="Living" umbrales={data.living.umbrales} onSaved={onSaved} />
        </div>
      )}
    </div>
  );
}

function GrupoSeguimiento({ title, grupo }: { title: string; grupo: SeguimientoGrupo }) {
  const [semaforo, setSemaforo] = useState<SeguimientoSemaforo | null>(null);
  const [sector, setSector] = useState<string | null>(null);
  const [verTodas, setVerTodas] = useState(false);

  const filtradas = grupo.ordenes
    .filter((o) => (semaforo ? o.semaforo === semaforo : true) && (sector ? o.sector === sector : true))
    .sort((a, b) => b.ageDays - a.ageDays);
  const visibles = verTodas ? filtradas : filtradas.slice(0, PAGE);
  const hayFiltro = semaforo !== null || sector !== null;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        <p className="text-xs text-slate-500">
          {num.format(grupo.total)} MO abiertas · promedio {dec.format(grupo.avgDays)} días · la más vieja {num.format(grupo.maxDays)} días
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => setSemaforo(null)}
          className={`rounded-lg border p-3 text-left transition ${semaforo === null ? 'border-brand-500 bg-slate-800/60' : 'border-slate-800 hover:border-slate-700'}`}
        >
          <div className="text-xs uppercase tracking-wide text-slate-500">Total abiertas</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">{num.format(grupo.total)}</div>
          <div className="text-xs text-slate-500">100%</div>
        </button>
        {SEMAFOROS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setSemaforo(semaforo === c ? null : c)}
            className={`rounded-lg border p-3 text-left transition ${COLORS[c].bg} ${semaforo === c ? COLORS[c].border + ' ring-1 ring-current ' + COLORS[c].text : 'border-transparent hover:border-slate-700'}`}
          >
            <div className={`text-xs uppercase tracking-wide ${COLORS[c].text}`}>{COLORS[c].label}</div>
            <div className={`mt-1 text-2xl font-semibold ${COLORS[c].text}`}>
              {num.format(grupo[c])} <span className="text-base font-medium">· {dec.format(pct(grupo[c], grupo.total))}%</span>
            </div>
            <div className="text-xs text-slate-500">{rangoLabel(grupo, c)}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <h4 className="mb-1 text-sm font-medium text-slate-300">Distribución</h4>
          <SemaforoDonut grupo={grupo} semaforo={semaforo} onSemaforo={setSemaforo} />
        </div>
        <div className="lg:col-span-3">
          <h4 className="mb-1 text-sm font-medium text-slate-300">MO por sector</h4>
          <SectoresBars grupo={grupo} sector={sector} onSector={setSector} />
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-medium text-slate-300">Por sector</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-1.5 pr-3 font-medium">Sector</th>
                <th className="px-3 py-1.5 text-right font-medium">MO</th>
                <th className="px-3 py-1.5 text-right font-medium text-emerald-400">Verde</th>
                <th className="px-3 py-1.5 text-right font-medium text-amber-400">Amarillo</th>
                <th className="px-3 py-1.5 text-right font-medium text-red-400">Rojo</th>
                <th className="py-1.5 pl-3 text-right font-medium">Prom. días</th>
              </tr>
            </thead>
            <tbody>
              {grupo.sectores.map((s) => (
                <tr
                  key={s.sector}
                  onClick={() => setSector(sector === s.sector ? null : s.sector)}
                  className={`cursor-pointer border-b border-slate-800/60 last:border-0 hover:bg-slate-800/40 ${sector === s.sector ? 'bg-slate-800/60' : ''}`}
                >
                  <td className="py-1.5 pr-3 text-slate-200">{s.sector}</td>
                  <td className="px-3 py-1.5 text-right text-slate-200">{num.format(s.total)}</td>
                  <td className="px-3 py-1.5 text-right text-emerald-400">
                    {num.format(s.verde)} <span className="text-xs text-slate-500">({dec.format(pct(s.verde, s.total))}%)</span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-amber-400">
                    {num.format(s.amarillo)} <span className="text-xs text-slate-500">({dec.format(pct(s.amarillo, s.total))}%)</span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-red-400">
                    {num.format(s.rojo)} <span className="text-xs text-slate-500">({dec.format(pct(s.rojo, s.total))}%)</span>
                  </td>
                  <td className="py-1.5 pl-3 text-right text-slate-300">{dec.format(s.avgDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-medium text-slate-300">
            Órdenes{semaforo ? ` · ${COLORS[semaforo].label}` : ''}{sector ? ` · ${sector}` : ''}
            <span className="ml-2 text-xs text-slate-500">{num.format(filtradas.length)}</span>
          </h4>
          {hayFiltro && (
            <button type="button" onClick={() => { setSemaforo(null); setSector(null); }} className="text-xs text-brand-500 hover:underline">
              Quitar filtros
            </button>
          )}
        </div>
        {filtradas.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No hay órdenes con este filtro.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">MO</th>
                  <th className="px-3 py-1.5 font-medium">Producto</th>
                  <th className="px-3 py-1.5 font-medium">Sector</th>
                  <th className="px-3 py-1.5 font-medium">Creada</th>
                  <th className="px-3 py-1.5 font-medium">Planificada</th>
                  <th className="px-3 py-1.5 font-medium">Estado</th>
                  <th className="py-1.5 pl-3 text-right font-medium">Días</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((o) => (
                  <tr key={o.id} className="border-b border-slate-800/60 last:border-0">
                    <td className="whitespace-nowrap py-1.5 pr-3 text-slate-400">{o.reference}</td>
                    <td className="max-w-[26rem] truncate px-3 py-1.5 text-slate-200" title={o.productName}>{o.productName}</td>
                    <td className="px-3 py-1.5 text-slate-400">{o.sector}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-400">{fechaAr(o.createdDate)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-400">{o.plannedDate ? fechaAr(o.plannedDate) : '—'}</td>
                    <td className="px-3 py-1.5 text-slate-400">{o.iniciado ? 'Iniciada' : 'No iniciada'}</td>
                    <td className="py-1.5 pl-3 text-right">
                      <span className={`inline-block min-w-[3rem] rounded-full px-2 py-0.5 text-xs font-semibold ${COLORS[o.semaforo].bg} ${COLORS[o.semaforo].text}`}>
                        {o.ageDays} d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtradas.length > PAGE && (
          <button type="button" onClick={() => setVerTodas(!verTodas)} className="mt-2 text-xs text-brand-500 hover:underline">
            {verTodas ? 'Ver menos' : `Ver las ${num.format(filtradas.length)} órdenes`}
          </button>
        )}
      </div>
    </section>
  );
}

function DescargarPdf({ data }: { data: SeguimientoResponse }) {
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function descargar() {
    setGenerando(true);
    setError(null);
    try {
      // jsPDF solo se baja cuando se pide el reporte, no pesa en la carga del tab.
      const { generarPdfSeguimientoMo, nombreArchivoSeguimiento } = await import('./seguimiento-mo-pdf');
      generarPdfSeguimientoMo(data).save(nombreArchivoSeguimiento(data.today));
    } catch (e) {
      console.error('[seguimiento-mo-pdf]', e);
      setError('No se pudo generar el PDF. Recargá la página e intentá de nuevo.');
    } finally {
      setGenerando(false);
    }
  }
  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-xs text-red-400">{error}</span>}
      <button
        type="button"
        onClick={descargar}
        disabled={generando}
        className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
      >
        {generando ? 'Generando…' : 'Descargar PDF'}
      </button>
    </div>
  );
}

function SeguimientoInner({ puedeEditar }: { puedeEditar: boolean }) {
  const queryClient = useQueryClient();
  const query = useApiQuery<SeguimientoResponse>(['seguimiento-mo'], '/api/seguimiento-mo');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          {SEMAFOROS.map((c) => (
            <span key={c} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${COLORS[c].bar}`} />
              <span className={COLORS[c].text}>{COLORS[c].label}</span>
              {query.data && (
                <span className="text-slate-500">
                  Colchones {rangoLabel(query.data.colchones, c)} · Living {rangoLabel(query.data.living, c)}
                </span>
              )}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-4">
          {query.data && <DescargarPdf data={query.data} />}
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
        </div>
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {puedeEditar && query.data && (
        <ConfigSemaforo data={query.data} onSaved={() => queryClient.invalidateQueries({ queryKey: ['seguimiento-mo'] })} />
      )}

      {query.isLoading ? (
        <>
          <div className="h-72 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
          <div className="h-72 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        </>
      ) : (
        query.data && (
          <>
            <GrupoSeguimiento title="Colchones" grupo={query.data.colchones} />
            <GrupoSeguimiento title="Living" grupo={query.data.living} />
          </>
        )
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function SeguimientoMoApp({ puedeEditar = false }: { puedeEditar?: boolean }) {
  return (
    <QueryProvider>
      <SeguimientoInner puedeEditar={puedeEditar} />
    </QueryProvider>
  );
}

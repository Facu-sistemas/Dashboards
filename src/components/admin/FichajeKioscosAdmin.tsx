import { useEffect, useRef, useState } from 'react';
import type { KioscoLatido } from '@/lib/supabase/fichaje-kioscos';
import type { MarcaFichaje, UltimasDePersona } from '@/lib/supabase/fichaje-marcas';

interface Props {
  marcas: MarcaFichaje[];
  /** Por persona: dónde y cuándo fue su última entrada y su última salida. */
  ultimas: UltimasDePersona[];
  /** Última señal de vida de cada celular de quiosco. */
  latidos: KioscoLatido[];
  /** username → nombre completo de la cuenta (sirve como nombre de la ubicación, p. ej. "Entrada principal"). */
  nombresKioscos: Record<string, string>;
  /** Mensaje de Supabase si no se pudo leer la tabla (no existe, falta un permiso, etc.). */
  error: string | null;
}

const MAX_FILAS = 60;
/** Cuentas de los celulares oficiales de la fábrica; el resto (ficherotest, el dev) son de prueba. */
const ES_OFICIAL = /^fichero[123]$/;
const FORMATO_FECHA = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const FORMATO_DIA = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' });

function iniciales(n: string): string {
  return n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('');
}

function hace(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function Senal({ latido, limiteMs }: { latido: KioscoLatido; limiteMs: number }) {
  const caido = Date.now() - new Date(latido.ultimoLatido).getTime() > limiteMs;
  const problema = !caido && (!latido.camaraActiva || latido.problema);
  const color = caido ? 'text-red-400' : problema ? 'text-amber-300' : 'text-emerald-400';
  return (
    <p className={`mt-1 flex flex-wrap items-center gap-x-3 text-xs ${color}`}>
      <span>{caido ? `Sin señal desde ${hace(latido.ultimoLatido)}` : problema ? (latido.problema ?? 'Cámara apagada') : 'Conectado'}</span>
      {latido.bateria != null && (
        <span className={latido.bateria <= 20 && !latido.cargando ? 'font-medium text-red-400' : latido.bateria <= 40 && !latido.cargando ? 'text-amber-300' : 'text-slate-400'}>
          {latido.cargando ? '⚡' : '🔋'} {latido.bateria}%{caido ? ' (último dato)' : ''}
        </span>
      )}
    </p>
  );
}

/**
 * Fichadas por kiosco (cuenta de celular): cuántas hizo cada uno hoy y cuándo fue su última actividad, más el listado
 * de las últimas marcas. Sirve para ver dónde ficha la gente y para notar un celular que dejó de responder en horario laboral.
 */
export default function FichajeKioscosAdmin({ marcas: marcasIniciales, ultimas, latidos, nombresKioscos, error }: Props) {
  const [marcas, setMarcas] = useState<MarcaFichaje[]>(marcasIniciales);
  const [sonido, setSonido] = useState(true);
  const vistas = useRef<Set<string>>(new Set(marcasIniciales.map((m) => m.id)));
  const ctxAudio = useRef<AudioContext | null>(null);
  const sonidoRef = useRef(sonido);
  sonidoRef.current = sonido;

  // Pitidos cortos: entrada = dos tonos que suben, salida = dos que bajan.
  function pitar(accion: 'entrada' | 'salida') {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = (ctxAudio.current ??= new Ctx());
      if (ctx.state === 'suspended') void ctx.resume();
      const tonos = accion === 'entrada' ? [660, 880] : [880, 520];
      tonos.forEach((hz, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = ctx.currentTime + i * 0.16;
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.15);
      });
    } catch {
      /* sin audio disponible */
    }
  }

  // Consulta las fichadas cada 5 s (solo con la pestaña visible) y suena por cada una nueva.
  useEffect(() => {
    let vivo = true;
    async function consultar() {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/admin/fichaje-marcas-recientes', { cache: 'no-store' });
        const json = (await res.json()) as { ok: boolean; marcas?: MarcaFichaje[] };
        if (!vivo || !res.ok || !json.ok || !json.marcas) return;
        const nuevas = json.marcas.filter((m) => !vistas.current.has(m.id));
        if (nuevas.length === 0) return;
        for (const m of nuevas) vistas.current.add(m.id);
        setMarcas(json.marcas);
        if (sonidoRef.current) {
          const ult = nuevas.reduce((a, b) => (a.marcadoEn > b.marcadoEn ? a : b));
          pitar(ult.accion);
        }
      } catch {
        /* se reintenta en la próxima vuelta */
      }
    }
    const t = setInterval(() => void consultar(), 5000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  const [filtro, setFiltro] = useState<string>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [periodo, setPeriodo] = useState<'hoy' | 'recientes'>('hoy');
  const [busquedaHist, setBusquedaHist] = useState('');
  const [recargas, setRecargas] = useState<Record<string, 'pidiendo' | 'pedida' | string>>({});

  async function recargar(username: string) {
    setRecargas((r) => ({ ...r, [username]: 'pidiendo' }));
    try {
      const res = await fetch('/api/admin/fichaje-kioscos-recargar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kiosco: username }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'No se pudo pedir la recarga');
      setRecargas((r) => ({ ...r, [username]: 'pedida' }));
      setTimeout(() => setRecargas((r) => ({ ...r, [username]: '' })), 5000);
    } catch (err) {
      setRecargas((r) => ({ ...r, [username]: (err as Error).message }));
    }
  }

  const hoy = FORMATO_DIA.format(new Date());
  const porKiosco = new Map<string, { total: number; hoy: number; ultima: string }>();
  for (const m of marcas) {
    const k = porKiosco.get(m.kiosco) ?? { total: 0, hoy: 0, ultima: m.marcadoEn };
    k.total += 1;
    if (FORMATO_DIA.format(new Date(m.marcadoEn)) === hoy) k.hoy += 1;
    if (m.marcadoEn > k.ultima) k.ultima = m.marcadoEn;
    porKiosco.set(m.kiosco, k);
  }
  const latidoDe = new Map(latidos.map((l) => [l.kiosco, l]));
  // Un celular sin señal por más de 3 minutos se da por caído (manda una cada 60 s mientras la página está abierta).
  const SIN_SENAL_MS = 3 * 60_000;
  for (const l of latidos) if (!porKiosco.has(l.kiosco)) porKiosco.set(l.kiosco, { total: 0, hoy: 0, ultima: '' });
  const kioscos = [...porKiosco.entries()].sort((a, b) => b[1].ultima.localeCompare(a[1].ultima));
  const nombre = (username: string) => nombresKioscos[username] || username;

  const texto = busqueda.trim().toLowerCase();
  const personas = texto ? ultimas.filter((p) => p.empleadoNombre.toLowerCase().includes(texto)) : ultimas;
  const celda = (m: UltimasDePersona['entrada']) =>
    m ? (
      <>
        <span className="text-slate-200">{nombre(m.kiosco)}</span> <span className="font-mono text-xs text-slate-500">{FORMATO_FECHA.format(new Date(m.marcadoEn))}</span>
      </>
    ) : (
      <span className="text-slate-600">—</span>
    );

  const textoHist = busquedaHist.trim().toLowerCase();
  const delPeriodo = marcas.filter(
    (m) =>
      (filtro === 'todos' || m.kiosco === filtro) &&
      (periodo === 'recientes' || FORMATO_DIA.format(new Date(m.marcadoEn)) === hoy) &&
      (!textoHist || m.empleadoNombre.toLowerCase().includes(textoHist)),
  );
  const visibles = periodo === 'hoy' ? delPeriodo : delPeriodo.slice(0, MAX_FILAS);
  const personasDistintas = new Set(delPeriodo.map((m) => m.empleadoId)).size;

  // Tiempo promedio entre una fichada y la siguiente (mismo kiosco, hoy). Se descartan pausas de más de 10 min (no hay cola).
  const promedioEntre = (usuario: string | null): number | null => {
    const horas = marcas
      .filter((m) => (usuario === null || m.kiosco === usuario) && FORMATO_DIA.format(new Date(m.marcadoEn)) === hoy)
      .map((m) => new Date(m.marcadoEn).getTime())
      .sort((a, b) => a - b);
    const difs: number[] = [];
    for (let i = 1; i < horas.length; i++) {
      const d = horas[i]! - horas[i - 1]!;
      if (d <= 10 * 60_000) difs.push(d);
    }
    return difs.length ? difs.reduce((a, b) => a + b, 0) / difs.length / 1000 : null;
  };
  // Adentro = su última fichada de hoy fue una entrada; afuera = fue una salida (marcas vienen de la más nueva a la más vieja).
  const ultimaDeHoy = new Map<number, 'entrada' | 'salida'>();
  for (const m of marcas) {
    if (FORMATO_DIA.format(new Date(m.marcadoEn)) === hoy && !ultimaDeHoy.has(m.empleadoId)) ultimaDeHoy.set(m.empleadoId, m.accion);
  }
  const adentro = [...ultimaDeHoy.values()].filter((a) => a === 'entrada').length;
  const afuera = ultimaDeHoy.size - adentro;
  const fmtSeg =(s: number | null) => (s === null ? '—' : s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-slate-300">Fichadas por kiosco (Fichaje)</h2>
        <p className="mt-1 text-xs text-slate-500">
          Cada fichada guarda con qué cuenta de celular se hizo. Como nombre de la ubicación se muestra el «nombre completo» de la cuenta (si no tiene,
          el usuario). Se registra desde que se activó esta función; las fichadas anteriores no tienen kiosco.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-200">
          No se pudo leer la tabla <code>fichaje_marcas</code>: {error}. El SQL de la tabla y sus permisos está en{' '}
          <code>src/lib/supabase/fichaje-marcas.ts</code>.
        </p>
      ) : marcas.length === 0 && latidos.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-6 text-center text-sm text-slate-500">Todavía no hay fichadas registradas.</p>
      ) : (
        <>
          {(() => {
            const tarjeta = ([username, k]: (typeof kioscos)[number]) => {
              const min = k.ultima ? (Date.now() - new Date(k.ultima).getTime()) / 60000 : Infinity;
              const estado = min < 60 ? { color: 'bg-emerald-400', label: 'Activo' } : min < 60 * 12 ? { color: 'bg-amber-400', label: 'Sin actividad' } : { color: 'bg-red-400', label: 'Inactivo' };
              const sel = filtro === username;
              const rec = recargas[username];
              return (
                <div key={username} className="relative">
                <button
                  type="button"
                  onClick={() => setFiltro(sel ? 'todos' : username)}
                  className={`flex items-center gap-4 rounded-xl border p-4 text-left transition-all ${
                    sel ? 'border-brand-500 bg-slate-800 shadow-lg' : 'border-slate-800 bg-slate-900 hover:-translate-y-0.5 hover:border-slate-600'
                  }`}
                >
                  <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-slate-800">
                    <span className="text-2xl font-semibold leading-none text-slate-100">{k.hoy}</span>
                    <span className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">hoy</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">{nombre(username)}</p>
                    {nombre(username) !== username && <p className="truncate text-[11px] text-slate-500">{username}</p>}
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
                      <span className={`h-2 w-2 rounded-full ${estado.color}`} />
                      {k.ultima ? `${estado.label} · ${hace(k.ultima)}` : 'Sin fichadas todavía'}
                    </p>
                    {latidoDe.get(username) && <Senal latido={latidoDe.get(username)!} limiteMs={SIN_SENAL_MS} />}
                  </div>
                </button>
                {latidoDe.get(username) && (
                  <button
                    type="button"
                    disabled={rec === 'pidiendo' || rec === 'pedida'}
                    onClick={() => void recargar(username)}
                    title="El celular recarga la página en menos de 1 minuto (cuando recibe la próxima señal)"
                    className="absolute right-3 top-3 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-60"
                  >
                    {rec === 'pidiendo' ? 'Pidiendo…' : rec === 'pedida' ? 'Pedido ✓' : '↻ Recargar'}
                  </button>
                )}
                {rec && rec !== 'pidiendo' && rec !== 'pedida' && <p className="mt-1 text-xs text-red-400">{rec}</p>}
                </div>
              );
            };
            const oficiales = kioscos.filter(([u]) => ES_OFICIAL.test(u));
            const pruebas = kioscos.filter(([u]) => !ES_OFICIAL.test(u));
            return (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Oficiales</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{oficiales.map((e) => tarjeta(e))}</div>
                </div>
                {pruebas.length > 0 && (
                  <details className="group">
                    <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300">
                      De prueba ({pruebas.length})
                    </summary>
                    <div className="mt-2 grid gap-3 opacity-80 sm:grid-cols-2 lg:grid-cols-3">{pruebas.map((e) => tarjeta(e))}</div>
                  </details>
                )}
              </div>
            );
          })()}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-xs text-slate-400">
            <span title="Su última fichada de hoy fue una entrada">
              🟢 Trabajando: <strong className="text-sm text-emerald-400">{adentro}</strong>
            </span>
            <span title="Su última fichada de hoy fue una salida">
              🔴 Afuera: <strong className="text-sm text-red-400">{afuera}</strong>
            </span>
            <span>
              Promedio entre fichadas hoy: <strong className="text-sm text-slate-100">{fmtSeg(promedioEntre(null))}</strong>
            </span>
            {kioscos
              .filter(([u]) => ES_OFICIAL.test(u))
              .map(([u]) => (
                <span key={u}>
                  {nombre(u)}: <strong className="text-slate-200">{fmtSeg(promedioEntre(u))}</strong>
                </span>
              ))}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium text-slate-300">
                  {periodo === 'hoy' ? 'Fichadas de hoy' : 'Últimas fichadas'} · {filtro === 'todos' ? 'todos los kioscos' : nombre(filtro)}
                </h3>
                <p className="text-xs text-slate-500">
                  {delPeriodo.length} fichadas · {personasDistintas} personas
                  {filtro === 'todos' ? ' — tocá una tarjeta de arriba para ver quiénes ficharon en ese kiosco.' : ' — tocá la tarjeta de nuevo para ver todos.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSonido((s) => !s);
                    pitar('entrada');
                  }}
                  title="Suena cuando alguien entra (tono que sube) o sale (tono que baja) mientras tenés esta pestaña abierta"
                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  {sonido ? '🔔 Sonido activado' : '🔕 Sonido apagado'}
                </button>
                <div className="flex overflow-hidden rounded-md border border-slate-700 text-xs">
                  {(['hoy', 'recientes'] as const).map((per) => (
                    <button
                      key={per}
                      type="button"
                      onClick={() => setPeriodo(per)}
                      className={`px-3 py-1.5 ${periodo === per ? 'bg-slate-700 text-slate-100' : 'bg-slate-900 text-slate-400 hover:text-slate-200'}`}
                    >
                      {per === 'hoy' ? 'Hoy' : 'Recientes'}
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  value={busquedaHist}
                  onChange={(e) => setBusquedaHist(e.target.value)}
                  placeholder="Buscar persona…"
                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>
            {visibles.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-6 text-center text-sm text-slate-500">No hay fichadas para mostrar.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {visibles.map((m) => {
                  const ent = m.accion === 'entrada';
                  return (
                    <li key={m.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${ent ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                        {ent ? '↓' : '↑'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-100">{m.empleadoNombre}</p>
                        <p className="truncate text-xs text-slate-500">
                          <span className={ent ? 'text-emerald-400' : 'text-red-400'}>{ent ? 'Entrada' : 'Salida'}</span> · {nombre(m.kiosco)}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-xs text-slate-400">{FORMATO_FECHA.format(new Date(m.marcadoEn))}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {periodo === 'recientes' && (
              <p className="text-xs text-slate-500">
                Se muestran hasta {MAX_FILAS}; el resumen usa las últimas {marcas.length}.
              </p>
            )}
          </div>

          <details className="group">
            <summary className="cursor-pointer text-sm text-slate-400 hover:text-slate-200">Última entrada y última salida por persona</summary>
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">Dónde y cuándo fue la última entrada y la última salida de cada persona.</p>
              <input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar persona…"
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
              />
            </div>
            {personas.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-6 text-center text-sm text-slate-500">Nadie coincide con la búsqueda.</p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {personas.map((p) => (
                  <div key={p.empleadoId} className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-300">
                        {iniciales(p.empleadoNombre)}
                      </span>
                      <p className="truncate text-sm font-medium text-slate-100">{p.empleadoNombre}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-400">↓ Entrada</p>
                        <div className="text-xs">{celda(p.entrada)}</div>
                      </div>
                      <div className="rounded-lg bg-red-500/10 px-2.5 py-1.5">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-red-400">↑ Salida</p>
                        <div className="text-xs">{celda(p.salida)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-500">{ultimas.length} personas con fichadas registradas desde que se activó esta función.</p>
          </div>

          </details>
        </>
      )}
    </section>
  );
}

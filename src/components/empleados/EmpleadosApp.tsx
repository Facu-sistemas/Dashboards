import { useCallback, useEffect, useRef, useState } from 'react';
import { useFichajeCamara } from '@/components/fichaje/useFichajeCamara';
import type { PortalEmpleado } from '@/lib/odoo/empleado-portal';

/** Cuadros que el navegador junta antes de pedirle al servidor que verifique (el servidor repite el reconocimiento). */
const CUADROS = 3;
const INTERVALO_MS = 400;

type Fase = 'cargando' | 'login' | 'portal';

const fmtHs = (n: number) => `${n.toFixed(1).replace('.', ',')} hs`;
const fmtFecha = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
const fmtHora = (iso: string) => iso;

async function pedirPortal(): Promise<{ estado: 'ok'; data: PortalEmpleado } | { estado: 'sin-sesion' } | { estado: 'error'; mensaje: string }> {
  try {
    const res = await fetch('/api/empleados/portal', { credentials: 'same-origin' });
    if (res.status === 401) return { estado: 'sin-sesion' };
    const json = (await res.json()) as { ok: boolean; data?: PortalEmpleado; error?: string };
    if (!json.ok || !json.data) return { estado: 'error', mensaje: json.error ?? 'No se pudieron cargar tus datos.' };
    return { estado: 'ok', data: json.data };
  } catch {
    return { estado: 'error', mensaje: 'Sin conexión con el sistema.' };
  }
}

export default function EmpleadosApp() {
  const [fase, setFase] = useState<Fase>('cargando');
  const [data, setData] = useState<PortalEmpleado | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await pedirPortal();
    if (r.estado === 'ok') {
      setData(r.data);
      setError(null);
      setFase('portal');
    } else if (r.estado === 'sin-sesion') {
      setData(null);
      setFase('login');
    } else {
      setError(r.mensaje);
      setFase((f) => (f === 'cargando' ? 'login' : f));
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function salir() {
    await fetch('/api/empleados/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    setData(null);
    setFase('login');
  }

  if (fase === 'cargando') return <p className="py-20 text-center text-slate-400">Cargando...</p>;
  if (fase === 'login') return <Login alEntrar={cargar} errorInicial={error} />;
  return <Portal data={data!} alSalir={salir} alActualizar={cargar} />;
}

// ───────────────────────────── Login con la cara ─────────────────────────────

function Login({ alEntrar, errorInicial }: { alEntrar: () => Promise<void>; errorInicial: string | null }) {
  const { videoRef, camaraActiva, estado, setEstado, error, detectar } = useFichajeCamara(true);
  const [mensaje, setMensaje] = useState<string | null>(errorInicial);
  const [verificando, setVerificando] = useState(false);
  const bloqueadoHasta = useRef(0);

  useEffect(() => {
    if (!camaraActiva || verificando) return;
    let cancelado = false;
    let juntos: number[][] = [];

    async function tick() {
      if (cancelado) return;
      if (Date.now() < bloqueadoHasta.current) {
        setTimeout(tick, INTERVALO_MS);
        return;
      }
      const det = await detectar();
      if (cancelado) return;
      if (!det) {
        juntos = [];
        setEstado('Buscando tu cara...');
      } else {
        juntos.push(Array.from(det.descriptor));
        setEstado('Verificando...');
        if (juntos.length >= CUADROS) {
          const descriptores = juntos.slice(-CUADROS);
          juntos = [];
          setVerificando(true);
          try {
            const res = await fetch('/api/empleados/login', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ descriptores }),
            });
            const json = (await res.json()) as { ok: boolean; error?: string };
            if (json.ok) {
              await alEntrar();
              return;
            }
            setMensaje(json.error ?? 'No te pude reconocer.');
            bloqueadoHasta.current = Date.now() + 2000;
          } catch {
            setMensaje('Sin conexión con el sistema.');
            bloqueadoHasta.current = Date.now() + 3000;
          }
          setVerificando(false);
          return;
        }
      }
      setTimeout(tick, INTERVALO_MS);
    }
    void tick();
    return () => {
      cancelado = true;
    };
  }, [camaraActiva, verificando, detectar, setEstado, alEntrar]);

  return (
    <div className="flex flex-col items-center gap-4 pt-8">
      <img src="/Logo%20FL%20icon.svg" alt="" className="h-12 w-12" />
      <h1 className="text-2xl font-bold text-slate-100">Portal del empleado</h1>
      <p className="max-w-sm text-center text-sm text-slate-400">
        Mirá de frente a la cámara: entrás con la misma cara que registraste para fichar.
      </p>
      <div className="relative aspect-[4/3] w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-black">
        <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
        <div className={`pointer-events-none absolute inset-6 rounded-[3rem] border-2 ${verificando ? 'border-emerald-400' : 'border-white/40'}`} />
      </div>
      <p className="text-sm text-slate-300">{verificando ? 'Verificando...' : estado}</p>
      {mensaje && <p className="rounded border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{mensaje}</p>}
      {error && <p className="rounded border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}
      <p className="max-w-sm text-center text-xs text-slate-500">
        ¿No te reconoce? Pedile a RRHH que revise tu registro facial.
      </p>
    </div>
  );
}

// ───────────────────────────── Portal ─────────────────────────────

const ETIQUETA_ESTADO: Record<string, { texto: string; clase: string }> = {
  ok: { texto: 'OK', clase: 'bg-emerald-500/20 text-emerald-300' },
  licencia: { texto: 'Licencia', clase: 'bg-sky-500/20 text-sky-300' },
  feriado: { texto: 'Feriado', clase: 'bg-slate-700/60 text-slate-300' },
  'horas-faltantes': { texto: 'Faltan horas', clase: 'bg-amber-500/20 text-amber-300' },
  'sin-salida': { texto: 'Sin salida', clase: 'bg-amber-500/20 text-amber-300' },
  'marca-incompleta': { texto: 'Marca incompleta', clase: 'bg-amber-500/20 text-amber-300' },
  'sin-fichada': { texto: 'Sin fichada', clase: 'bg-red-500/20 text-red-300' },
  'horas-extra': { texto: 'Horas extra', clase: 'bg-violet-500/20 text-violet-300' },
};

function Tarjeta({ titulo, children, className = '' }: { titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-slate-900 p-4 ${className}`}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{titulo}</h2>
      {children}
    </section>
  );
}

function Portal({ data, alSalir, alActualizar }: { data: PortalEmpleado; alSalir: () => void; alActualizar: () => Promise<void> }) {
  const { empleado, hoyEstado, mes, banco, vacaciones } = data;
  const [verTodoBanco, setVerTodoBanco] = useState(false);
  const movimientos = verTodoBanco ? banco.movimientos : banco.movimientos.slice(0, 5);
  const pct = mes.horasEsperadas ? Math.min(100, Math.round((mes.horasCargadas / mes.horasEsperadas) * 100)) : null;
  const diasConDato = mes.dias.filter((d) => d.fecha <= data.hoy && !['fin-de-semana', 'sin-datos', 'pendiente'].includes(d.estado)).reverse();

  // Se recarga solo cada 2 minutos (por si fichó mientras tenía el portal abierto).
  useEffect(() => {
    const t = setInterval(() => void alActualizar(), 120_000);
    return () => clearInterval(t);
  }, [alActualizar]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">Hola,</p>
          <h1 className="text-2xl font-bold text-slate-100">{empleado.nombre}</h1>
          <p className="text-sm text-slate-400">
            {[empleado.puesto, empleado.departamento, empleado.legajo ? `Legajo ${empleado.legajo}` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button type="button" onClick={alSalir} className="shrink-0 rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-red-500 hover:text-red-400">
          Salir
        </button>
      </header>

      <Tarjeta titulo="Hoy">
        <div className="flex items-center gap-3">
          <span className={`h-3 w-3 rounded-full ${hoyEstado.fichado ? 'animate-pulse bg-emerald-400' : hoyEstado.marcas.length > 0 ? 'bg-slate-500' : 'bg-amber-400'}`} />
          <p className="text-lg font-semibold text-slate-100">
            {hoyEstado.fichado
              ? 'Estás adentro (fichaste la entrada)'
              : hoyEstado.marcas.length > 0
                ? 'Ya fichaste la salida'
                : hoyEstado.licencia
                  ? 'Tenés una licencia hoy'
                  : 'Todavía no fichaste hoy'}
          </p>
        </div>
        {hoyEstado.marcas.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {hoyEstado.marcas.map((m, i) => (
              <li key={i} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-200">
                {fmtHora(m.entrada)} → {m.salida ? fmtHora(m.salida) : 'en curso'}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <div className="grid gap-4 sm:grid-cols-2">
        <Tarjeta titulo="Banco de horas">
          <p className={`text-4xl font-bold ${banco.saldo < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{fmtHs(banco.saldo)}</p>
          <p className="mt-1 text-xs text-slate-500">Saldo actual</p>
        </Tarjeta>
        <Tarjeta titulo="Vacaciones">
          <p className="text-4xl font-bold text-sky-400">{vacaciones.saldo.toString().replace('.', ',')} días</p>
          <p className="mt-1 text-xs text-slate-500">
            Disponibles · {vacaciones.asignadas.toString().replace('.', ',')} asignados, {vacaciones.tomadas.toString().replace('.', ',')} tomados
          </p>
        </Tarjeta>
      </div>

      <Tarjeta titulo={`Este mes (${mes.periodo})`}>
        <div className="flex items-end justify-between gap-3">
          <p className="text-3xl font-bold text-slate-100">{fmtHs(mes.horasCargadas)}</p>
          {mes.horasEsperadas !== null && <p className="text-sm text-slate-400">de {fmtHs(mes.horasEsperadas)} hasta hoy</p>}
        </div>
        {pct !== null && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
            <div className={`h-full ${pct >= 95 ? 'bg-emerald-500' : pct >= 80 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
          </div>
        )}
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-lg bg-slate-800 py-2"><dt className="text-xs text-slate-400">Días trabajados</dt><dd className="font-semibold text-slate-100">{mes.diasTrabajados}</dd></div>
          <div className="rounded-lg bg-slate-800 py-2"><dt className="text-xs text-slate-400">Horas extra</dt><dd className="font-semibold text-violet-300">{fmtHs(mes.horasExtra)}</dd></div>
          <div className="rounded-lg bg-slate-800 py-2"><dt className="text-xs text-slate-400">Novedades</dt><dd className={`font-semibold ${mes.novedades > 0 ? 'text-amber-300' : 'text-slate-100'}`}>{mes.novedades}</dd></div>
        </dl>
      </Tarjeta>

      <Tarjeta titulo="Mis fichadas del mes">
        {diasConDato.length === 0 ? (
          <p className="text-sm text-slate-400">Todavía no hay días para mostrar.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {diasConDato.map((d) => {
              const e = ETIQUETA_ESTADO[d.estado] ?? { texto: d.estado, clase: 'bg-slate-700 text-slate-300' };
              return (
                <li key={d.fecha} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="w-16 shrink-0 text-slate-300">{fmtFecha(d.fecha)}</span>
                  <span className="flex-1 text-slate-400">
                    {d.entrada ? `${d.entrada} → ${d.salida ?? '—'}` : d.licencias[0]?.tipo ?? ''}
                    {d.fichadoHs > 0 && <span className="ml-2 text-slate-200">{fmtHs(d.fichadoHs)}</span>}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${d.descartada ? 'bg-slate-700/60 text-slate-400' : e.clase}`}>{e.texto}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta titulo="Movimientos del banco de horas">
        {banco.movimientos.length === 0 ? (
          <p className="text-sm text-slate-400">Sin movimientos en los últimos 6 meses.</p>
        ) : (
          <>
            <ul className="divide-y divide-slate-800">
              {movimientos.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="w-16 shrink-0 text-slate-300">{fmtFecha(m.fecha)}</span>
                  <span className="flex-1 truncate text-slate-400" title={m.concepto}>
                    {m.concepto}
                    {m.estado === 'pendiente' && <span className="ml-2 text-xs text-amber-300">pendiente</span>}
                  </span>
                  <span className={`font-semibold ${m.horas < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{m.horas > 0 ? '+' : ''}{fmtHs(m.horas)}</span>
                </li>
              ))}
            </ul>
            {banco.movimientos.length > 5 && (
              <button type="button" onClick={() => setVerTodoBanco((v) => !v)} className="mt-2 text-sm text-brand-400 hover:underline">
                {verTodoBanco ? 'Ver menos' : `Ver los ${banco.movimientos.length} movimientos`}
              </button>
            )}
          </>
        )}
      </Tarjeta>

      {vacaciones.licenciasTomadas.length > 0 && (
        <Tarjeta titulo="Vacaciones tomadas">
          <ul className="divide-y divide-slate-800 text-sm">
            {[...vacaciones.licenciasTomadas].reverse().slice(0, 8).map((l, i) => (
              <li key={i} className="flex justify-between py-2 text-slate-300">
                <span>{fmtFecha(l.dateFrom.slice(0, 10))} → {fmtFecha(l.dateTo.slice(0, 10))}</span>
                <span className="text-slate-400">{l.numberOfDays.toString().replace('.', ',')} días</span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      <p className="pb-6 text-center text-xs text-slate-500">
        La sesión se cierra sola a los 30 minutos. Si algo no coincide con tus fichadas, avisale a RRHH.
      </p>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFichajeCamara } from '@/components/fichaje/useFichajeCamara';
import type { PortalEmpleado } from '@/lib/odoo/empleado-portal';
import { ESTADO_SOLICITUD_TEXTO, type EstadoSolicitud, type SolicitudRetiro } from '@/lib/rrhh-solicitudes';
import { horasMinTxt } from '@/lib/horas-formato';

/** Cuadros que el navegador junta antes de pedirle al servidor que verifique (el servidor repite el reconocimiento). */
const CUADROS = 3;
const INTERVALO_MS = 400;
/** Los primeros cuadros de una cámara recién abierta salen oscuros o desenfocados (exposición y foco todavía ajustando): se descartan. */
const CALENTAMIENTO_MS = 1500;
/** Un cuadro solo cuenta si la cara se detecta con firmeza y ocupa una parte razonable de la imagen. */
const SCORE_MIN = 0.8;
const ANCHO_CARA_MIN = 0.22;

type Fase = 'cargando' | 'login' | 'entrando' | 'portal';

/** Las horas se muestran en horas y minutos ("14 h 6 min"), no en decimales: el empleado leería 0,73 como 73 minutos. */
const fmtHs = horasMinTxt;
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
  const [nombreEntrando, setNombreEntrando] = useState('');

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

  const entrar = useCallback(async (nombre: string) => {
    setNombreEntrando(nombre);
    setFase('entrando');
    await cargar();
  }, [cargar]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function salir() {
    await fetch('/api/empleados/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    setData(null);
    setFase('login');
  }

  return (
    <div className="flex flex-col">
      {fase === 'cargando' ? (
        <p className="py-20 text-center text-slate-400">Cargando...</p>
      ) : fase === 'login' ? (
        <Login alEntrar={entrar} errorInicial={error} />
      ) : fase === 'entrando' ? (
        <Entrando nombre={nombreEntrando} />
      ) : (
        <Portal data={data!} alSalir={salir} alActualizar={cargar} />
      )}
      <CambiarTema />
    </div>
  );
}

/** Modo claro/oscuro: mismo mecanismo que el botón del layout (atributo data-theme + localStorage), pero al pie de la pantalla para que no tape nada. */
function CambiarTema() {
  const [claro, setClaro] = useState(false);
  useEffect(() => setClaro(document.documentElement.getAttribute('data-theme') === 'light'), []);
  function alternar() {
    const siguiente = !claro;
    if (siguiente) document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    try {
      localStorage.setItem('theme', siguiente ? 'light' : 'dark');
    } catch {
      // Sin localStorage: vale solo para esta visita.
    }
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: siguiente ? 'light' : 'dark' } }));
    setClaro(siguiente);
  }
  return (
    <button type="button" onClick={alternar} className="mx-auto mt-2 flex items-center gap-2 rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-brand-500 hover:text-brand-400">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        {claro ? <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>}
      </svg>
      {claro ? 'Modo oscuro' : 'Modo claro'}
    </button>
  );
}

// ───────────────────────────── Login con la cara ─────────────────────────────

function Login({ alEntrar, errorInicial }: { alEntrar: (nombre: string) => Promise<void>; errorInicial: string | null }) {
  const { videoRef, camaraActiva, estado, setEstado, error, detectar } = useFichajeCamara(true);
  const [mensaje, setMensaje] = useState<string | null>(errorInicial);
  const [verificando, setVerificando] = useState(false);
  const bloqueadoHasta = useRef(0);
  const camaraDesde = useRef(0);

  useEffect(() => {
    if (camaraActiva) camaraDesde.current = Date.now();
  }, [camaraActiva]);

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
      if (Date.now() - camaraDesde.current < CALENTAMIENTO_MS) {
        setEstado('Ajustando la cámara...');
        setTimeout(tick, INTERVALO_MS);
        return;
      }
      const det = await detectar();
      if (cancelado) return;
      const anchoImagen = videoRef.current?.videoWidth || 640;
      const firme = !!det && det.detection.score >= SCORE_MIN && det.detection.box.width >= anchoImagen * ANCHO_CARA_MIN;
      if (!det || !firme) {
        juntos = [];
        setEstado(det ? 'Acercate y mirá de frente...' : 'Buscando tu cara...');
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
            const json = (await res.json()) as { ok: boolean; data?: { nombre: string }; error?: string };
            if (json.ok) {
              await alEntrar(json.data?.nombre ?? '');
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
      <div className="relative aspect-[3/4] max-h-[70vh] w-full max-w-md overflow-hidden sm:aspect-[4/3] rounded-2xl border border-slate-800 bg-black">
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

// ───────────────────────────── Pantalla de carga tras el login ─────────────────────────────

const PASOS_ENTRANDO = ['Entrando...', 'Buscando tus fichadas...', 'Calculando tu banco de horas...', 'Revisando tus vacaciones...', 'Ya casi...'];

function Entrando({ nombre }: { nombre: string }) {
  const [paso, setPaso] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPaso((p) => Math.min(p + 1, PASOS_ENTRANDO.length - 1)), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center gap-4 pt-28 text-center">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-700 border-t-emerald-400" />
      <h1 className="text-2xl font-bold text-slate-100">{nombre ? `Hola, ${nombre}` : 'Hola'}</h1>
      <p className="text-sm text-slate-300">{PASOS_ENTRANDO[paso]}</p>
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
  const [vista, setVista] = useState<'resumen' | 'retiro'>('resumen');
  const [solicitudes, setSolicitudes] = useState<SolicitudRetiro[] | null>(null);
  /** Respuestas que el empleado ya vio en esta sesión (el servidor las marca al abrir la pestaña; esto apaga el puntito al instante). */
  const [vistasLocal, setVistasLocal] = useState<Set<string>>(new Set());

  const cargarSolicitudes = useCallback(async () => {
    try {
      const res = await fetch('/api/empleados/solicitudes', { credentials: 'same-origin' });
      const json = (await res.json()) as { ok: boolean; data?: SolicitudRetiro[] };
      setSolicitudes(json.ok && json.data ? json.data : []);
    } catch {
      setSolicitudes((s) => s ?? []);
    }
  }, []);
  useEffect(() => {
    void cargarSolicitudes();
  }, [cargarSolicitudes]);

  const sinVer = (solicitudes ?? []).filter((s) => (s.estado === 'aprobada' || s.estado === 'rechazada') && !s.vistaPorEmpleado && !vistasLocal.has(s.id));

  function abrirRetiro() {
    setVista('retiro');
    if (sinVer.length > 0) {
      setVistasLocal((v) => new Set([...v, ...sinVer.map((s) => s.id)]));
      void fetch('/api/empleados/solicitudes', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'vistas' }),
      }).catch(() => {});
    }
  }
  const movimientos = verTodoBanco ? banco.movimientos : banco.movimientos.slice(0, 5);
  const pct = mes.horasEsperadas ? Math.min(100, Math.round((mes.horasCargadas / mes.horasEsperadas) * 100)) : null;
  const diasConDato = mes.dias.filter((d) => d.fecha <= data.hoy && !['fin-de-semana', 'sin-datos', 'pendiente'].includes(d.estado)).reverse();

  // Se recarga solo cada 2 minutos (por si fichó mientras tenía el portal abierto).
  useEffect(() => {
    const t = setInterval(() => {
      void alActualizar();
      void cargarSolicitudes();
    }, 120_000);
    return () => clearInterval(t);
  }, [alActualizar, cargarSolicitudes]);

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

      <nav className="flex gap-2">
        {([['resumen', 'Mi resumen'], ['retiro', 'Retiro anticipado']] as const).map(([id, texto]) => (
          <button
            key={id}
            type="button"
            onClick={() => (id === 'retiro' ? abrirRetiro() : setVista(id))}
            className={`relative flex-1 rounded-full border px-4 py-2 text-sm font-medium ${vista === id ? 'border-brand-500 bg-brand-500/10 text-brand-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
          >
            {texto}
            {id === 'retiro' && sinVer.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-bold text-slate-950">{sinVer.length}</span>
            )}
          </button>
        ))}
      </nav>

      {vista === 'retiro' ? (
        <RetiroAnticipado hoy={data.hoy} lista={solicitudes} recargar={cargarSolicitudes} />
      ) : (
        <>
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
                  <span className={`font-semibold ${m.horas < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{m.horas > 0 && Math.round(m.horas * 60) > 0 ? '+' : ''}{fmtHs(m.horas)}</span>
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

        </>
      )}

      <p className="pb-6 text-center text-xs text-slate-500">
        La sesión se cierra sola a la hora. Si algo no coincide con tus fichadas, avisale a RRHH.
      </p>
    </div>
  );
}

// ───────────────────────────── Nota de solicitud de retiro anticipado ─────────────────────────────

const COLOR_SOLICITUD: Record<EstadoSolicitud, string> = {
  pendiente: 'bg-amber-500/20 text-amber-300',
  aprobada: 'bg-emerald-500/20 text-emerald-300',
  rechazada: 'bg-rose-500/20 text-rose-300',
  cancelada: 'bg-slate-700/60 text-slate-400',
};

function RetiroAnticipado({ hoy, lista, recargar }: { hoy: string; lista: SolicitudRetiro[] | null; recargar: () => Promise<void> }) {
  const [fecha, setFecha] = useState(hoy);
  const [hora, setHora] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviada, setEnviada] = useState(false);
  const [cancelando, setCancelando] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    setEnviada(false);
    try {
      const res = await fetch('/api/empleados/solicitudes', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha, horaRetiro: hora, motivo }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(res.status === 401 ? 'Tu sesión venció. Salí y volvé a entrar.' : (json.error ?? 'No se pudo enviar la solicitud.'));
      setEnviada(true);
      setMotivo('');
      setHora('');
      await recargar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function cancelar(id: string) {
    if (!window.confirm('¿Cancelar esta solicitud?')) return;
    setCancelando(id);
    setError(null);
    try {
      const res = await fetch('/api/empleados/solicitudes', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'cancelar', id }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? 'No se pudo cancelar.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancelando(null);
      await recargar();
    }
  }

  const campo = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-slate-100 placeholder:text-slate-500';

  return (
    <>
      <Tarjeta titulo="Nota de solicitud de retiro anticipado">
        <form onSubmit={enviar} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Día
              <input type="date" required min={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Hora en que te retirás
              <input type="time" required value={hora} onChange={(e) => setHora(e.target.value)} className={campo} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Motivo
            <textarea required minLength={5} maxLength={500} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Contá brevemente por qué necesitás retirarte antes" className={campo} />
          </label>
          {error && <p className="rounded border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}
          {enviada && <p className="rounded border border-emerald-900 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300">Solicitud enviada. RRHH la va a revisar.</p>}
          <button type="submit" disabled={enviando} className="rounded-lg bg-brand-500 px-4 py-3 text-base font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
            {enviando ? 'Enviando...' : 'Enviar solicitud'}
          </button>
        </form>
      </Tarjeta>

      <Tarjeta titulo="Mis solicitudes">
        {lista === null ? (
          <p className="text-sm text-slate-400">Cargando...</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-slate-400">Todavía no hiciste ninguna solicitud.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {lista.map((s) => (
              <li key={s.id} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-200">{fmtFecha(s.fecha)} · {s.horaRetiro} hs</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${COLOR_SOLICITUD[s.estado]}`}>{ESTADO_SOLICITUD_TEXTO[s.estado]}</span>
                </div>
                <p className="mt-1 text-slate-400">{s.motivo}</p>
                {s.estado === 'pendiente' && (
                  <p className="mt-1 text-xs text-slate-300">
                    {s.aproboRrhhPor ? '✓' : '○'} RRHH · {s.aproboLiderPor ? '✓' : '○'} Líder
                    <span className="text-slate-500"> — {!s.aproboRrhhPor && !s.aproboLiderPor ? 'esperando a RRHH y a tu líder' : !s.aproboRrhhPor ? 'tu líder ya aprobó, falta RRHH' : !s.aproboLiderPor ? 'RRHH ya aprobó, falta tu líder' : ''}</span>
                  </p>
                )}
                {s.comentarioRrhh && <p className="mt-1 text-slate-300">RRHH: {s.comentarioRrhh}</p>}
                {s.comentarioLider && <p className="mt-1 text-slate-300">Líder: {s.comentarioLider}</p>}
                {(s.estado === 'aprobada' || s.estado === 'rechazada') && !s.vistaPorEmpleado && <p className="mt-1 text-xs font-semibold text-amber-300">Nueva respuesta de RRHH</p>}
                {s.estado === 'pendiente' && (
                  <button type="button" disabled={cancelando === s.id} onClick={() => void cancelar(s.id)} className="mt-2 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50">
                    {cancelando === s.id ? 'Cancelando...' : 'Cancelar solicitud'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </>
  );
}

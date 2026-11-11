import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import QueryProvider from '@/components/QueryProvider';
import { agruparPersonas, rankingPersonas } from '@/lib/fichaje-matching';
import { RespuestaNoJsonError } from '@/lib/respuesta-no-json';
import {
  enviarLatido,
  marcarEnOdoo,
  MARGEN_RECONOCIMIENTO,
  UMBRAL_RECONOCIMIENTO as UMBRAL,
  type CaraRegistrada,
  type ResultadoFichaje,
} from './fichaje-shared';
import { encolar, esFalloDeRed, leerCola, sincronizarCola } from './fichaje-cola';
import { recargarConTope } from './fichaje-recuperacion';
import { useFichajeCamara } from './useFichajeCamara';
import { usePantallaCompleta } from './usePantallaCompleta';
import { activarAudio, audioActivo, estaSilenciado, silenciar, sonar } from './fichaje-sonido';

/** Cuadros consecutivos con el mismo empleado antes de confirmar el reconocimiento. */
const CONFIRMACIONES = 3;
const INTERVALO_MS = 400;
/** Cuánto queda en pantalla el cartel de "Entrada/Salida registrada". */
const RESULTADO_MS = 3000;
/** Cuánto sigue el cartel "Hola, X" (y el botón) después de la última vez que se vio la cara: si la persona se mueve un instante, no se le va el botón. */
const RETENCION_MS = 2000;
// v2: la clave anterior pudo quedar guardada en "apagada" por un error que sacaba al quiosco de pantalla completa sin avisar.
const PREF_PANTALLA_COMPLETA = 'fichaje-pantalla-completa-v2';
/** Cada cuánto el celular avisa que sigue vivo (y de paso detecta si el servidor dejó de contestar bien). */
const LATIDO_MS = 60_000;

function FichajeReconocerInner({ esDev }: { esDev: boolean }) {
  const carasQ = useApiQuery<CaraRegistrada[]>(['fichaje-caras'], '/api/fichaje-caras');
  const caras = carasQ.data ?? [];

  const { videoRef, camaraActiva, estado, setEstado, error, setError, iniciar, detener, detectar } = useFichajeCamara(true);

  const [reconocido, setReconocido] = useState<{ empleadoId: number; nombre: string; distancia: number } | null>(null);
  const [fichando, setFichando] = useState(false);
  const [fichaje, setFichaje] = useState<ResultadoFichaje | null>(null);
  /** Nombre de quien acaba de fichar sin internet (la fichada quedó guardada en el celular, pendiente de enviar). */
  const [guardado, setGuardado] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState(0);
  const [silencio, setSilencio] = useState(estaSilenciado);
  const [audioListo, setAudioListo] = useState(false);
  /** true cuando el servidor sigue contestando mal después de varias recargas automáticas: se muestra el aviso en pantalla. */
  const [sinConexion, setSinConexion] = useState(false);
  const [recargando, setRecargando] = useState(false);
  const { pantallaCompleta, contenedorRef, entrar: entrarPantallaCompleta, salir: salirPantallaCompleta, alTocar } = usePantallaCompleta(PREF_PANTALLA_COMPLETA, !esDev);

  const personas = useMemo(() => agruparPersonas(caras), [caras]);
  const personasRef = useRef(personas);
  personasRef.current = personas;
  /** Última vez que se vio (confirmada) la cara del reconocido; sirve para retener el cartel RETENCION_MS. */
  const ultimaVistaRef = useRef(0);

  // Recuperación: si el servidor contesta HTML en vez de datos (deploy en curso, caída), se recarga la página sola.
  // Si después de varias recargas sigue igual, queda el aviso en pantalla y el panel de admin lo muestra como sin señal.
  const recuperar = useCallback(() => {
    if (!recargarConTope()) setSinConexion(true);
  }, []);
  useEffect(() => {
    if (carasQ.error instanceof RespuestaNoJsonError) recuperar();
  }, [carasQ.error, recuperar]);
  useEffect(() => {
    // Vite avisa así cuando un archivo de la página ya no existe en el servidor (pasa tras un deploy): recargar lo trae de nuevo.
    window.addEventListener('vite:preloadError', recuperar);
    return () => window.removeEventListener('vite:preloadError', recuperar);
  }, [recuperar]);

  // Señal de vida: cada minuto. Si contesta bien, se levanta el aviso de "sin conexión"; si contesta HTML, se recupera.
  const latidoRef = useRef({ camara: false, problema: null as string | null });
  latidoRef.current = {
    camara: camaraActiva,
    problema:
      (error ??
        (pendientes > 0 ? `${pendientes} fichada(s) guardada(s) sin enviar` : !pantallaCompleta && !esDev ? 'No está en pantalla completa' : null))?.slice(0, 300) ?? null,
  };
  useEffect(() => {
    let cancelado = false;
    async function latir() {
      try {
        // Battery API: solo Chrome/Android (Safari en iPhone no la tiene). Si no hay, se manda sin batería.
        const bat = await (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery?.().catch(() => null);
        const { recargar: ordenRecarga } = await enviarLatido({ ...latidoRef.current, bateria: bat ? Math.round(bat.level * 100) : null, cargando: bat ? bat.charging : null });
        if (!cancelado) setSinConexion(false);
        // Recarga pedida desde el admin. La pantalla completa de la app se restaura sola; la real del navegador necesita un toque.
        if (ordenRecarga) {
          setRecargando(true);
          setTimeout(() => location.reload(), 1500);
        }
      } catch (err) {
        if (!cancelado && err instanceof RespuestaNoJsonError) recuperar();
        // Sin internet (fetch rechazado): no se recarga, porque recargar sin red deja la pantalla de "sin conexión" del navegador.
      }
    }
    void latir();
    const t = setInterval(() => void latir(), LATIDO_MS);
    return () => {
      cancelado = true;
      clearInterval(t);
    };
  }, [recuperar]);

  // Desbloqueo del audio: el navegador exige un toque antes de dejar sonar. Se intenta al cargar (por si ya lo permite) y en
  // cada toque; mientras siga bloqueado se muestra el cartel "Tocá la pantalla para activar el sonido".
  useEffect(() => {
    const revisar = () => setAudioListo(audioActivo());
    const intentar = () => void activarAudio().then(revisar);
    intentar();
    document.addEventListener('pointerdown', intentar, true);
    document.addEventListener('visibilitychange', revisar);
    const t = setInterval(revisar, 2000);
    return () => {
      document.removeEventListener('pointerdown', intentar, true);
      document.removeEventListener('visibilitychange', revisar);
      clearInterval(t);
    };
  }, []);

  // Bip al reconocer a alguien (una vez por persona reconocida) y tonos de entrada/salida al fichar.
  const reconocidoId = reconocido?.empleadoId ?? null;
  useEffect(() => {
    if (reconocidoId !== null) sonar('reconocido');
  }, [reconocidoId]);
  useEffect(() => {
    if (fichaje) sonar(fichaje.accion);
  }, [fichaje]);

  function alternarSilencio() {
    const nuevo = !silencio;
    setSilencio(nuevo);
    silenciar(nuevo);
    if (!nuevo) {
      // Al activar el sonido (es un toque) se aprovecha para desbloquear el audio y se prueba con un bip.
      void activarAudio().then((ok) => {
        setAudioListo(ok);
        sonar('reconocido');
      });
    }
  }

  // Bucle de reconocimiento: corre mientras la cámara está abierta.
  useEffect(() => {
    if (!camaraActiva) {
      ultimaVistaRef.current = 0;
      setReconocido(null);
      return;
    }
    // Mientras se ficha y mientras se muestra el resultado, el reconocimiento se pausa: así el cartel no
    // desaparece si la cara sale un instante de cámara, y no se puede fichar dos veces seguidas por accidente.
    if (fichando || fichaje || guardado) return;
    let cancelado = false;
    let candidato: number | null = null;
    let racha = 0;

    // Si hay un reconocido que se vio hace menos de RETENCION_MS, el cartel se mantiene aunque ahora no se lo vea bien.
    const retenido = () => Date.now() - ultimaVistaRef.current <= RETENCION_MS;

    async function tick() {
      if (cancelado) return;
      const det = await detectar();
      if (cancelado) return;

      if (!det) {
        candidato = null;
        racha = 0;
        if (!retenido()) {
          setReconocido(null);
          setEstado('Buscando cara...');
        }
      } else if (personasRef.current.length === 0) {
        setEstado('Hay una cara, pero todavía no hay empleados registrados.');
      } else {
        // Ranking de empleados (distancia = promedio de sus 2 muestras más cercanas). Se acepta solo si la mejor
        // está bajo el umbral y además le gana a la segunda por un margen: si dos empleados dan casi igual,
        // es preferible no reconocer a nadie que reconocer al equivocado.
        const [mejor, segunda] = rankingPersonas(det.descriptor, personasRef.current);
        const ambigua = !!mejor && !!segunda && mejor.distancia <= UMBRAL && segunda.distancia - mejor.distancia < MARGEN_RECONOCIMIENTO;
        if (mejor && mejor.distancia <= UMBRAL && !ambigua) {
          racha = candidato === mejor.empleadoId ? racha + 1 : 1;
          candidato = mejor.empleadoId;
          if (racha >= CONFIRMACIONES) {
            ultimaVistaRef.current = Date.now();
            setReconocido({ empleadoId: mejor.empleadoId, nombre: mejor.nombre, distancia: mejor.distancia });
            setEstado('Reconocido');
          } else {
            setEstado('Verificando...');
          }
        } else {
          candidato = null;
          racha = 0;
          if (retenido()) {
            setTimeout(tick, INTERVALO_MS);
            return;
          }
          setReconocido(null);
          // A los empleados no se les muestra con quién se parecen ni distancias: eso es un dato de diagnóstico para
          // el dev (y para RRHH, en el reporte "Pares parecidos" del admin).
          setEstado(
            esDev
              ? ambigua
                ? `Ambigua: ${mejor!.nombre} ${mejor!.distancia.toFixed(2)} vs ${segunda!.nombre} ${segunda!.distancia.toFixed(2)}`
                : `Cara no reconocida (distancia ${mejor?.distancia.toFixed(2)}).`
              : ambigua
                ? 'No pude identificarte con seguridad. Mirá de frente a la cámara.'
                : 'Cara no reconocida.'
          );
        }
      }
      setTimeout(tick, INTERVALO_MS);
    }
    void tick();
    return () => {
      cancelado = true;
    };
  }, [camaraActiva, detectar, setEstado, fichando, fichaje, guardado, esDev]);

  // El resultado del fichaje queda en pantalla unos segundos y después se vuelve a buscar caras.
  useEffect(() => {
    if (!fichaje) return;
    const t = setTimeout(() => setFichaje(null), RESULTADO_MS);
    return () => clearTimeout(t);
  }, [fichaje]);

  // El cartel de "guardado sin internet" dura lo mismo que el de resultado.
  useEffect(() => {
    if (!guardado) return;
    const t = setTimeout(() => setGuardado(null), RESULTADO_MS);
    return () => clearTimeout(t);
  }, [guardado]);

  // Fichadas guardadas sin internet: se reenvían solas cada 15 s y apenas el navegador detecta que volvió la red.
  const sincronizar = useCallback(async () => {
    if (leerCola().length === 0) {
      setPendientes(0);
      return;
    }
    const r = await sincronizarCola();
    setPendientes(r.pendientes);
    if (r.descartadas.length > 0) setError(`El sistema rechazó fichadas guardadas: ${r.descartadas.join('; ')}`);
  }, [setError]);
  useEffect(() => {
    void sincronizar();
    const t = setInterval(() => void sincronizar(), 15_000);
    const alVolver = () => void sincronizar();
    window.addEventListener('online', alVolver);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', alVolver);
    };
  }, [sincronizar]);

  function guardarSinInternet(empleadoId: number, nombre: string) {
    encolar({ empleadoId, nombre, tomadoEn: new Date().toISOString() });
    setPendientes(leerCola().length);
    setGuardado(nombre);
    setReconocido(null);
    setEstado('Fichaje guardado sin internet.');
    sonar('reconocido');
  }

  async function ficharAhora() {
    if (!reconocido || fichando) return;
    const { empleadoId, nombre } = reconocido;
    ultimaVistaRef.current = 0;
    setFichando(true);
    setError(null);
    try {
      // Si quedaron fichadas guardadas, van primero (Odoo las recibe en el orden en que se tocaron); si no se pueden
      // enviar todavía, esta también se guarda en la cola en lugar de saltearles el turno.
      if (leerCola().length > 0) await sincronizar();
      if (leerCola().length > 0) {
        guardarSinInternet(empleadoId, nombre);
        return;
      }
      setFichaje(await marcarEnOdoo(empleadoId));
      setReconocido(null);
      setEstado('Fichaje registrado.');
    } catch (err) {
      if (esFalloDeRed(err)) {
        guardarSinInternet(empleadoId, nombre);
        return;
      }
      if (err instanceof RespuestaNoJsonError) {
        // No se llegó a registrar el fichaje (el servidor no contestó datos): se recarga y se vuelve a intentar.
        setError('El sistema no respondió y el fichaje no se registró. Se recarga la página; volvé a fichar en unos segundos.');
        recuperar();
      } else {
        setError((err as Error).message);
      }
      sonar('error');
    } finally {
      setFichando(false);
    }
  }

  const mensajes = (
    <>
      {recargando && <p className="animate-pulse rounded bg-brand-500 px-3 py-2 text-center text-sm font-semibold text-white">Recargando...</p>}
      <p className="text-center text-sm text-slate-400">{estado}</p>
      {!silencio && !audioListo && (
        <p className="rounded bg-amber-500/20 px-3 py-1.5 text-center text-sm text-amber-200">Tocá la pantalla para activar el sonido</p>
      )}
      {pendientes > 0 && (
        <p className="rounded bg-amber-500/20 px-3 py-1.5 text-center text-sm text-amber-200">
          {pendientes} fichada{pendientes === 1 ? '' : 's'} guardada{pendientes === 1 ? '' : 's'} sin internet: se envía{pendientes === 1 ? '' : 'n'} sola{pendientes === 1 ? '' : 's'} cuando vuelva.
        </p>
      )}
      {sinConexion && (
        <p className="rounded bg-red-600 px-3 py-2 text-center text-sm font-semibold text-white">
          Sin conexión con el sistema. Avisá a Sistemas.
        </p>
      )}
      {error && <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}
    </>
  );

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={entrarPantallaCompleta}
          className="rounded bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
        >
          Pantalla completa
        </button>
        <button
          type="button"
          onClick={alternarSilencio}
          className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
        >
          {silencio ? 'Sonido apagado' : 'Sonido activado'}
        </button>
        <button
          type="button"
          onClick={camaraActiva ? detener : iniciar}
          className="ml-auto rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
        >
          {camaraActiva ? 'Apagar cámara' : 'Activar cámara'}
        </button>
      </div>

      {/* El mismo <video> sirve para los dos modos: solo cambian las clases, así la cámara no se reinicia al entrar/salir. */}
      <div
        ref={contenedorRef}
        onClick={alTocar}
        className={
          pantallaCompleta
            ? 'fixed inset-0 z-[200] bg-black'
            : 'relative mx-auto aspect-[4/3] w-full max-w-xl overflow-hidden rounded-lg bg-black'
        }
      >
        <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />

        {pantallaCompleta && (
          <>
            <div className="absolute inset-x-0 top-0 flex flex-col gap-2 bg-gradient-to-b from-black/70 to-transparent p-3 pr-16">
              {mensajes}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                salirPantallaCompleta();
              }}
              aria-label="Salir de pantalla completa"
              className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-xl text-white/80 hover:bg-black/70"
            >
              ✕
            </button>
          </>
        )}

        {fichaje ? (
          // Verde = entrada, rojo = salida. Tapa todo el video para que no se pueda pasar por alto.
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-white ${
              fichaje.accion === 'entrada' ? 'bg-emerald-600/95' : 'bg-red-600/95'
            }`}
          >
            <span className="text-6xl leading-none">{fichaje.accion === 'entrada' ? '→' : '←'}</span>
            <p className="text-3xl font-bold uppercase tracking-wide">{fichaje.accion === 'entrada' ? 'Entrada' : 'Salida'}</p>
            <p className="text-xl font-semibold">{fichaje.empleado}</p>
            {fichaje.hora && (
              <p className="text-lg">{new Date(fichaje.hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs</p>
            )}
            <p className="text-xs opacity-80">Registrada en Odoo</p>
          </div>
        ) : guardado ? (
          // Ámbar = guardada sin internet: no se sabe todavía si es entrada o salida, lo decide Odoo al recibirla.
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-amber-600/95 px-4 text-center text-white">
            <span className="text-6xl leading-none">✓</span>
            <p className="text-3xl font-bold uppercase tracking-wide">Fichaje guardado</p>
            <p className="text-xl font-semibold">{guardado}</p>
            <p className="text-sm opacity-90">Sin internet: se registra solo cuando vuelva la conexión</p>
          </div>
        ) : (
          reconocido && (
            // En pantalla completa el cartel flota a ~22% del borde inferior: pegado abajo choca con la barra de
            // navegación del celular y el botón queda incómodo de tocar con el celular en un soporte.
            <div
              // Toda la tarjeta ficha, no solo el botón: con el celular en un soporte es fácil errarle al botón.
              onClick={(e) => {
                e.stopPropagation();
                void ficharAhora();
              }}
              className={`absolute cursor-pointer bg-sky-700/90 px-4 text-center active:bg-sky-800/90 ${
                pantallaCompleta ? 'inset-x-4 bottom-[22%] rounded-2xl py-6 shadow-lg' : 'inset-x-3 bottom-3 rounded-xl py-3'
              }`}
            >
              <p className={`font-semibold text-white ${pantallaCompleta ? 'text-2xl' : 'text-lg'}`}>Hola, {reconocido.nombre}</p>
              {esDev && <p className="text-xs text-sky-100">distancia {reconocido.distancia.toFixed(2)}</p>}
              <button
                type="button"
                disabled={fichando}
                className={`mt-2 rounded bg-white font-semibold text-sky-800 disabled:opacity-60 ${
                  pantallaCompleta ? 'px-12 py-4 text-xl' : 'px-5 py-2 text-sm'
                }`}
              >
                {fichando ? 'Fichando...' : 'Fichar'}
              </button>
            </div>
          )
        )}
      </div>

      {!pantallaCompleta && mensajes}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:only="react"`), same pattern as the other tabs. */
export default function FichajeReconocerApp({ esDev }: { esDev: boolean }) {
  return (
    <QueryProvider>
      <FichajeReconocerInner esDev={esDev} />
    </QueryProvider>
  );
}

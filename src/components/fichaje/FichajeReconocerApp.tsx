import { useEffect, useRef, useState } from 'react';
import { useApiQuery } from '../dashboard/useApiQuery';
import QueryProvider from '../QueryProvider';
import { marcarEnOdoo, UMBRAL_RECONOCIMIENTO as UMBRAL, type CaraRegistrada, type ResultadoFichaje } from './fichaje-shared';
import { useFichajeCamara } from './useFichajeCamara';
import { usePantallaCompleta } from './usePantallaCompleta';

/** Cuadros consecutivos con el mismo empleado antes de confirmar el reconocimiento. */
const CONFIRMACIONES = 3;
const INTERVALO_MS = 400;
/** Cuánto queda en pantalla el cartel de "Entrada/Salida registrada". */
const RESULTADO_MS = 3000;
const PREF_PANTALLA_COMPLETA = 'fichaje-pantalla-completa';

function FichajeReconocerInner() {
  const carasQ = useApiQuery<CaraRegistrada[]>(['fichaje-caras'], '/api/fichaje-caras');
  const caras = carasQ.data ?? [];

  const { videoRef, faceapiRef, camaraActiva, estado, setEstado, error, setError, iniciar, detener, detectar } = useFichajeCamara(true);

  const [reconocido, setReconocido] = useState<{ empleadoId: number; nombre: string; distancia: number } | null>(null);
  const [fichando, setFichando] = useState(false);
  const [fichaje, setFichaje] = useState<ResultadoFichaje | null>(null);
  const { pantallaCompleta, contenedorRef, entrar: entrarPantallaCompleta, salir: salirPantallaCompleta, alTocar } = usePantallaCompleta(PREF_PANTALLA_COMPLETA);

  const carasRef = useRef(caras);
  carasRef.current = caras;

  // Bucle de reconocimiento: corre mientras la cámara está abierta.
  useEffect(() => {
    if (!camaraActiva) {
      setReconocido(null);
      return;
    }
    // Mientras se ficha y mientras se muestra el resultado, el reconocimiento se pausa: así el cartel no
    // desaparece si la cara sale un instante de cámara, y no se puede fichar dos veces seguidas por accidente.
    if (fichando || fichaje) return;
    let cancelado = false;
    let candidato: number | null = null;
    let racha = 0;

    async function tick() {
      if (cancelado) return;
      const faceapi = faceapiRef.current!;
      const det = await detectar();
      if (cancelado) return;

      if (!det) {
        candidato = null;
        racha = 0;
        setReconocido(null);
        setEstado('Buscando cara...');
      } else if (carasRef.current.length === 0) {
        setEstado('Hay una cara, pero todavía no hay empleados registrados.');
      } else {
        // Mejor coincidencia por empleado (cada uno tiene varias muestras).
        let mejor: { empleadoId: number; nombre: string; distancia: number } | null = null;
        for (const c of carasRef.current) {
          const d = faceapi.euclideanDistance(det.descriptor, c.descriptor);
          if (!mejor || d < mejor.distancia) mejor = { empleadoId: c.empleadoId, nombre: c.empleadoNombre, distancia: d };
        }
        if (mejor && mejor.distancia <= UMBRAL) {
          racha = candidato === mejor.empleadoId ? racha + 1 : 1;
          candidato = mejor.empleadoId;
          if (racha >= CONFIRMACIONES) {
            setReconocido({ empleadoId: mejor.empleadoId, nombre: mejor.nombre, distancia: mejor.distancia });
            setEstado('Reconocido');
          } else {
            setEstado('Verificando...');
          }
        } else {
          candidato = null;
          racha = 0;
          setReconocido(null);
          setEstado(`Cara no reconocida (distancia ${mejor?.distancia.toFixed(2)}).`);
        }
      }
      setTimeout(tick, INTERVALO_MS);
    }
    void tick();
    return () => {
      cancelado = true;
    };
  }, [camaraActiva, detectar, faceapiRef, setEstado, fichando, fichaje]);

  // El resultado del fichaje queda en pantalla unos segundos y después se vuelve a buscar caras.
  useEffect(() => {
    if (!fichaje) return;
    const t = setTimeout(() => setFichaje(null), RESULTADO_MS);
    return () => clearTimeout(t);
  }, [fichaje]);

  async function ficharAhora() {
    if (!reconocido) return;
    setFichando(true);
    setError(null);
    try {
      setFichaje(await marcarEnOdoo(reconocido.empleadoId));
      setReconocido(null);
      setEstado('Fichaje registrado.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFichando(false);
    }
  }

  const mensajes = (
    <>
      <p className="text-center text-sm text-slate-400">{estado}</p>
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
        ) : (
          reconocido && (
            <div className={`absolute inset-x-0 bottom-0 bg-sky-700/90 px-4 text-center ${pantallaCompleta ? 'py-6' : 'py-3'}`}>
              <p className={`font-semibold text-white ${pantallaCompleta ? 'text-2xl' : 'text-lg'}`}>Hola, {reconocido.nombre}</p>
              <p className="text-xs text-sky-100">distancia {reconocido.distancia.toFixed(2)}</p>
              <button
                type="button"
                disabled={fichando}
                onClick={(e) => {
                  e.stopPropagation();
                  void ficharAhora();
                }}
                className={`mt-2 rounded bg-white font-semibold text-sky-800 disabled:opacity-60 ${
                  pantallaCompleta ? 'px-10 py-3 text-lg' : 'px-5 py-2 text-sm'
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
export default function FichajeReconocerApp() {
  return (
    <QueryProvider>
      <FichajeReconocerInner />
    </QueryProvider>
  );
}

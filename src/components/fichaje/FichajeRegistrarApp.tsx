import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '../dashboard/useApiQuery';
import QueryProvider from '../QueryProvider';
import { agruparPersonas, rankingPersonas } from '../../lib/fichaje-matching';
import {
  registrarCaras,
  UMBRAL_PARECIDO,
  UMBRAL_RECONOCIMIENTO,
  type CaraRegistrada,
  type CaraResumen,
  type Empleado,
} from './fichaje-shared';
import { useFichajeCamara } from './useFichajeCamara';
import { usePantallaCompleta } from './usePantallaCompleta';

const MUESTRAS_REGISTRO = 5;
const INTERVALO_MS = 400;
/** Confianza mínima del detector para considerar que lo que ve es una cara nítida. */
const SCORE_MIN = 0.7;
/** Ancho mínimo de la cara respecto del ancho del video: más chico que esto está demasiado lejos. */
const ANCHO_MIN = 0.25;
/** Cuadros buenos seguidos antes de habilitar "Confirmar" (evita capturar un cuadro movido). */
const RACHA_MIN = 2;
/** Después de confirmar una muestra se piden más cuadros buenos, para que cambie un poco el ángulo antes de la siguiente. */
const RACHA_TRAS_CONFIRMAR = -4;

interface Muestra {
  descriptor: number[];
  /** El empleado ya registrado (distinto del que se está registrando) con la cara más parecida a esta muestra. */
  cercano: { nombre: string; distancia: number } | null;
}

type Riesgo = 'confusion' | 'parecido' | 'ok';
type Calidad = 'sin-cara' | 'lejos' | 'borrosa' | 'ok';

interface Vivo {
  calidad: Calidad;
  cercano: { nombre: string; distancia: number } | null;
  riesgo: Riesgo;
}

function riesgoDe(distancia: number | undefined): Riesgo {
  if (distancia === undefined) return 'ok';
  if (distancia <= UMBRAL_RECONOCIMIENTO) return 'confusion';
  if (distancia <= UMBRAL_PARECIDO) return 'parecido';
  return 'ok';
}

const COLOR_TEXTO: Record<Riesgo, string> = {
  confusion: 'text-red-400',
  parecido: 'text-amber-300',
  ok: 'text-emerald-400',
};

const COLOR_PUNTO: Record<Riesgo, string> = {
  confusion: 'bg-red-500',
  parecido: 'bg-amber-400',
  ok: 'bg-emerald-500',
};

const COLOR_FONDO: Record<Riesgo, string> = {
  confusion: 'bg-red-600/90',
  parecido: 'bg-amber-500/90',
  ok: 'bg-emerald-600/90',
};

/** Cartel en vivo: dice si la captura sirve y, si sirve, a quién se parece (verde / ámbar / rojo). */
function Semaforo({ vivo, listo, hayMuestras }: { vivo: Vivo | null; listo: boolean; hayMuestras: boolean }) {
  if (!vivo || vivo.calidad === 'sin-cara') {
    return <p className="rounded bg-slate-800/90 px-3 py-2 text-center text-sm text-slate-200">No se ve ninguna cara</p>;
  }
  if (vivo.calidad === 'lejos') {
    return <p className="rounded bg-slate-800/90 px-3 py-2 text-center text-sm text-slate-200">Acercate un poco a la cámara</p>;
  }
  if (vivo.calidad === 'borrosa') {
    return <p className="rounded bg-slate-800/90 px-3 py-2 text-center text-sm text-slate-200">Mirá de frente y quedate quieto/a</p>;
  }
  const { cercano, riesgo } = vivo;
  return (
    <div className={`rounded px-3 py-2 text-center text-white ${COLOR_FONDO[riesgo]}`}>
      {cercano ? (
        <p className="text-sm">
          Más parecido/a a <span className="font-semibold">{cercano.nombre}</span>{' '}
          <span className="font-mono font-bold">{cercano.distancia.toFixed(2)}</span>
        </p>
      ) : (
        <p className="text-sm">No hay otras caras registradas para comparar</p>
      )}
      <p className="text-xs opacity-90">
        {riesgo === 'confusion' && 'Se confundiría con esa persona al fichar'}
        {riesgo === 'parecido' && (listo ? 'Cierto parecido: se puede registrar, conviene vigilarlo' : 'Cierto parecido, mantené la pose un instante...')}
        {riesgo === 'ok' && (listo ? 'Captura buena' : hayMuestras ? 'Cambiá un poco el ángulo y mantené la pose...' : 'Mantené la pose un instante...')}
      </p>
    </div>
  );
}

function FichajeRegistrarInner({ esDev }: { esDev: boolean }) {
  const queryClient = useQueryClient();
  const empleadosQ = useApiQuery<Empleado[]>(['fichaje-empleados'], '/api/fichaje-empleados');
  const resumenQ = useApiQuery<CaraResumen[]>(['fichaje-caras-resumen'], '/api/fichaje-caras?resumen=1');
  // Los vectores de los ya registrados: se necesitan para avisar cuando una cara nueva se parece a alguna existente.
  const carasQ = useApiQuery<CaraRegistrada[]>(['fichaje-caras'], '/api/fichaje-caras');
  const empleados = empleadosQ.data ?? [];
  const registrados = new Map((resumenQ.data ?? []).map((r) => [r.empleadoId, r]));

  const { videoRef, camaraActiva, estado, error, setError, iniciar, detener, detectar } = useFichajeCamara(false);
  const { pantallaCompleta, contenedorRef, entrar, salir } = usePantallaCompleta();

  const [empleadoId, setEmpleadoId] = useState<number | ''>('');
  const [busqueda, setBusqueda] = useState('');
  const [muestras, setMuestras] = useState<Muestra[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState<string | null>(null);
  const [vivo, setVivo] = useState<Vivo | null>(null);
  const [listo, setListo] = useState(false);

  const personas = useMemo(() => agruparPersonas(carasQ.data ?? []), [carasQ.data]);
  const personasRef = useRef(personas);
  personasRef.current = personas;
  /** Última captura que cumplió todo: es exactamente lo que se guarda al apretar "Confirmar". */
  const ultimaBuenaRef = useRef<Muestra | null>(null);
  const rachaRef = useRef(0);

  const emp = empleados.find((e) => e.id === empleadoId);
  const completas = muestras.length >= MUESTRAS_REGISTRO;

  const texto = busqueda.trim().toLowerCase();
  const empleadosFiltrados = empleados.filter((e) => !texto || e.nombre.toLowerCase().includes(texto));
  const yaRegistrado = empleadoId !== '' && registrados.has(empleadoId);

  // Detección en vivo: evalúa cada cuadro (¿se ve bien? ¿a quién se parece?) y decide si se puede confirmar.
  useEffect(() => {
    if (!camaraActiva || empleadoId === '' || completas) {
      setVivo(null);
      setListo(false);
      ultimaBuenaRef.current = null;
      return;
    }
    let cancelado = false;

    async function tick() {
      if (cancelado) return;
      const video = videoRef.current;
      const det = await detectar();
      if (cancelado || !video) return;

      if (!det) {
        rachaRef.current = Math.min(rachaRef.current, 0);
        ultimaBuenaRef.current = null;
        setVivo({ calidad: 'sin-cara', cercano: null, riesgo: 'ok' });
        setListo(false);
      } else {
        const anchoRelativo = det.detection.box.width / (video.videoWidth || 1);
        const calidad: Calidad = det.detection.score < SCORE_MIN ? 'borrosa' : anchoRelativo < ANCHO_MIN ? 'lejos' : 'ok';

        // Misma métrica que el reconocimiento (promedio de las 2 muestras más cercanas de cada persona).
        const [masParecida] = rankingPersonas(det.descriptor, personasRef.current, empleadoId === '' ? undefined : empleadoId);
        const cercano: Muestra['cercano'] = masParecida ? { nombre: masParecida.nombre, distancia: masParecida.distancia } : null;
        const riesgo = riesgoDe(cercano?.distancia);

        // Una cara que se confundiría con otra persona no se puede confirmar, salvo que sea un admin.
        const buena = calidad === 'ok' && (riesgo !== 'confusion' || esDev);
        rachaRef.current = buena ? rachaRef.current + 1 : Math.min(rachaRef.current, 0);
        const lista = rachaRef.current >= RACHA_MIN;
        ultimaBuenaRef.current = lista ? { descriptor: Array.from(det.descriptor), cercano } : null;
        setVivo({ calidad, cercano, riesgo });
        setListo(lista);
      }
      setTimeout(tick, INTERVALO_MS);
    }
    void tick();
    return () => {
      cancelado = true;
    };
  }, [camaraActiva, empleadoId, completas, detectar, videoRef, esDev]);

  function confirmarMuestra() {
    const m = ultimaBuenaRef.current;
    if (!m) return;
    setError(null);
    setGuardadoOk(null);
    setMuestras((prev) => [...prev, m]);
    // Obliga a tener unos cuadros buenos más (≈ 2 segundos) antes de la próxima: da tiempo a cambiar el ángulo.
    rachaRef.current = RACHA_TRAS_CONFIRMAR;
    ultimaBuenaRef.current = null;
    setListo(false);
  }

  const peorDistancia = muestras.reduce<number | undefined>((peor, m) => {
    if (!m.cercano) return peor;
    return peor === undefined ? m.cercano.distancia : Math.min(peor, m.cercano.distancia);
  }, undefined);
  const riesgoGeneral = riesgoDe(peorDistancia);
  const peorMuestra = muestras.find((m) => m.cercano && m.cercano.distancia === peorDistancia);

  async function guardarRegistro() {
    if (!emp) return;
    if (
      riesgoGeneral === 'confusion' &&
      !window.confirm(`La cara de ${emp.nombre} se parece a la de ${peorMuestra?.cercano?.nombre} (distancia ${peorDistancia?.toFixed(2)}) y se podrían confundir al fichar. ¿Guardar igual?`)
    ) {
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await registrarCaras(
        emp.id,
        emp.nombre,
        muestras.map((m) => m.descriptor)
      );
      setMuestras([]);
      setGuardadoOk(`Cara de ${emp.nombre} registrada.`);
      salir();
      await queryClient.invalidateQueries({ queryKey: ['fichaje-caras-resumen'] });
      await queryClient.invalidateQueries({ queryKey: ['fichaje-caras'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  function abrirPantallaCompleta() {
    if (!camaraActiva) void iniciar();
    entrar();
  }

  const botonConfirmar = completas ? (
    <button
      type="button"
      disabled={guardando}
      onClick={() => void guardarRegistro()}
      className={`rounded bg-emerald-600 font-semibold text-white disabled:opacity-40 ${pantallaCompleta ? 'w-full px-6 py-4 text-lg' : 'px-3 py-1.5 text-sm font-medium'}`}
    >
      {guardando ? 'Guardando...' : 'Guardar registro'}
    </button>
  ) : (
    <button
      type="button"
      disabled={!listo}
      onClick={confirmarMuestra}
      className={`rounded font-semibold text-white transition-colors ${
        listo ? 'bg-emerald-600' : 'bg-slate-600 opacity-60'
      } ${pantallaCompleta ? 'w-full px-6 py-4 text-lg' : 'px-3 py-1.5 text-sm font-medium'}`}
    >
      Confirmar muestra ({muestras.length + 1}/{MUESTRAS_REGISTRO})
    </button>
  );

  const puntos = (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: MUESTRAS_REGISTRO }, (_, i) => {
        const m = muestras[i];
        return (
          <span
            key={i}
            className={`h-3 w-3 rounded-full border border-white/40 ${m ? COLOR_PUNTO[riesgoDe(m.cercano?.distancia)] : 'bg-transparent'}`}
          />
        );
      })}
    </div>
  );

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={empleadoId === ''}
          onClick={abrirPantallaCompleta}
          className="rounded bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40"
        >
          Pantalla completa
        </button>
        <button
          type="button"
          onClick={camaraActiva ? detener : iniciar}
          className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
        >
          {camaraActiva ? 'Apagar cámara' : 'Abrir cámara'}
        </button>
      </div>

      {/* El mismo <video> sirve para los dos modos: solo cambian las clases, así la cámara no se reinicia al entrar/salir. */}
      <div
        ref={contenedorRef}
        className={pantallaCompleta ? 'fixed inset-0 z-[200] bg-black' : 'relative mx-auto aspect-[4/3] w-full max-w-xl overflow-hidden rounded-lg bg-black'}
      >
        <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />

        {pantallaCompleta && (
          <>
            <div className="absolute inset-x-0 top-0 flex flex-col gap-2 bg-gradient-to-b from-black/80 to-transparent p-3 pr-16">
              <p className="text-center text-sm font-semibold text-white">{emp ? `Registrando a ${emp.nombre}` : 'Elegí un empleado'}</p>
              {puntos}
              {camaraActiva ? <Semaforo vivo={vivo} listo={listo} hayMuestras={muestras.length > 0} /> : <p className="text-center text-sm text-slate-200">{estado}</p>}
              {error && <p className="rounded bg-red-950/90 p-2 text-center text-sm text-red-300">{error}</p>}
            </div>
            <button
              type="button"
              onClick={salir}
              aria-label="Salir de pantalla completa"
              className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-xl text-white/80 hover:bg-black/70"
            >
              ✕
            </button>
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/80 to-transparent p-4">
              {botonConfirmar}
              {muestras.length > 0 && !completas && (
                <button
                  type="button"
                  onClick={() => setMuestras([])}
                  className="text-center text-xs text-slate-300 underline"
                >
                  Empezar de nuevo
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {!pantallaCompleta && (
        <>
          {camaraActiva && empleadoId !== '' && !completas ? (
            <Semaforo vivo={vivo} listo={listo} hayMuestras={muestras.length > 0} />
          ) : (
            <p className="text-center text-sm text-slate-400">{empleadoId === '' ? 'Elegí un empleado para empezar.' : estado}</p>
          )}
          {error && <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}
          {guardadoOk && <p className="rounded border border-emerald-900 bg-emerald-950/50 p-3 text-sm text-emerald-300">{guardadoOk}</p>}

          <div className="flex flex-col gap-3 border-t border-slate-800 pt-4">
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Empleado de Odoo
              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre..."
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
              />
              <select
                value={empleadoId}
                onChange={(e) => {
                  setEmpleadoId(e.target.value ? Number(e.target.value) : '');
                  setMuestras([]);
                  setGuardadoOk(null);
                }}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
              >
                <option value="">{empleadosQ.isLoading ? 'Cargando...' : 'Elegí un empleado'}</option>
                {empleadosFiltrados.map((e) => {
                  const registrado = registrados.has(e.id);
                  return (
                    <option key={e.id} value={e.id} disabled={registrado && !esDev}>
                      {e.nombre}
                      {registrado ? ' ✓ ya registrado' : ''}
                    </option>
                  );
                })}
              </select>
            </label>

            {yaRegistrado && esDev && (
              <p className="text-sm text-amber-300">Este empleado ya tiene la cara registrada: al guardar se reemplaza por las muestras nuevas.</p>
            )}
            {!esDev && (
              <p className="text-xs text-slate-500">
                Los empleados ya registrados no se pueden modificar desde acá. Si hay que cambiar o eliminar una cara, lo hace el administrador.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {botonConfirmar}
              <span className="text-sm text-slate-400">
                {muestras.length} / {MUESTRAS_REGISTRO} — el botón se habilita cuando la captura es buena
              </span>
              {muestras.length > 0 && (
                <button type="button" onClick={() => setMuestras([])} className="ml-auto text-xs text-slate-400 underline hover:text-slate-200">
                  Empezar de nuevo
                </button>
              )}
            </div>

            {muestras.length > 0 && (
              <div className="flex flex-col gap-1 rounded border border-slate-800 bg-slate-950/50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Parecido con los ya registrados (distancia)</p>
                {muestras.map((m, i) => (
                  <p key={i} className="text-sm text-slate-300">
                    Muestra {i + 1}:{' '}
                    {m.cercano ? (
                      <>
                        más parecida a <span className="font-medium text-slate-100">{m.cercano.nombre}</span>{' '}
                        <span className={`font-mono ${COLOR_TEXTO[riesgoDe(m.cercano.distancia)]}`}>{m.cercano.distancia.toFixed(2)}</span>
                      </>
                    ) : (
                      <span className="text-slate-500">no hay otras caras registradas para comparar</span>
                    )}
                  </p>
                ))}
                {riesgoGeneral === 'confusion' && (
                  <p className="mt-1 text-sm text-red-400">
                    Se parece demasiado a {peorMuestra?.cercano?.nombre} (menos de {UMBRAL_RECONOCIMIENTO.toFixed(2)}): al fichar los podría confundir.
                    {esDev ? ' Podés guardar igual confirmando.' : ''}
                  </p>
                )}
                {riesgoGeneral === 'parecido' && (
                  <p className="mt-1 text-sm text-amber-300">
                    Hay cierto parecido con {peorMuestra?.cercano?.nombre}: se puede guardar, pero conviene vigilar los fichajes de ambos.
                  </p>
                )}
                {riesgoGeneral === 'ok' && peorDistancia !== undefined && (
                  <p className="mt-1 text-sm text-emerald-400">No se parece a ninguna cara ya registrada.</p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Entry point mounted as an Astro client island (`client:only="react"`), same pattern as the other tabs. */
export default function FichajeRegistrarApp({ esDev }: { esDev: boolean }) {
  return (
    <QueryProvider>
      <FichajeRegistrarInner esDev={esDev} />
    </QueryProvider>
  );
}

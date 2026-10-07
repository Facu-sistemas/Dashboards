import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import type { ApiEnvelope } from '../dashboard/types';

interface Empleado {
  id: number;
  nombre: string;
  departamento: string | null;
}

interface CaraRegistrada {
  id: string;
  empleadoId: number;
  empleadoNombre: string;
  descriptor: number[];
}

type FaceApi = typeof import('@vladmandic/face-api');

const MODELS_URL = '/models/face';
const MUESTRAS_REGISTRO = 5;
/** Distancia euclídea máxima para considerar que dos descriptores son la misma persona (menor = más estricto). */
const UMBRAL = 0.5;
/** Cuadros consecutivos con el mismo empleado antes de confirmar el reconocimiento. */
const CONFIRMACIONES = 3;
const INTERVALO_MS = 400;

let faceApiPromise: Promise<FaceApi> | null = null;

/** Carga la librería y los modelos una sola vez — recién cuando se abre la cámara. */
function loadFaceApi(): Promise<FaceApi> {
  faceApiPromise ??= (async () => {
    const faceapi = await import('@vladmandic/face-api');
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODELS_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
    ]);
    return faceapi;
  })();
  faceApiPromise.catch(() => {
    faceApiPromise = null;
  });
  return faceApiPromise;
}

async function apiSend(method: 'POST' | 'DELETE', body: unknown): Promise<void> {
  const res = await fetch('/api/fichaje-caras', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ApiEnvelope<unknown>;
  if (!res.ok || !json.ok) throw new Error(json.error ?? 'Error al guardar');
}

type Modo = 'reconocer' | 'registrar';

function FichajeInner() {
  const queryClient = useQueryClient();
  const empleadosQ = useApiQuery<Empleado[]>(['fichaje-empleados'], '/api/fichaje-empleados');
  const carasQ = useApiQuery<CaraRegistrada[]>(['fichaje-caras'], '/api/fichaje-caras');
  const empleados = empleadosQ.data ?? [];
  const caras = carasQ.data ?? [];

  const [modo, setModo] = useState<Modo>('reconocer');
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [estado, setEstado] = useState('Cámara apagada.');
  const [error, setError] = useState<string | null>(null);
  const [empleadoId, setEmpleadoId] = useState<number | ''>('');
  const [busqueda, setBusqueda] = useState('');
  const [muestras, setMuestras] = useState<number[][]>([]);
  const [guardando, setGuardando] = useState(false);
  const [reconocido, setReconocido] = useState<{ nombre: string; distancia: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceapiRef = useRef<FaceApi | null>(null);
  const carasRef = useRef(caras);
  carasRef.current = caras;

  const detenerCamara = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamaraActiva(false);
    setReconocido(null);
    setEstado('Cámara apagada.');
  }, []);

  useEffect(() => detenerCamara, [detenerCamara]);

  async function iniciarCamara() {
    setError(null);
    setEstado('Cargando modelos...');
    try {
      faceapiRef.current = await loadFaceApi();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setCamaraActiva(true);
      setEstado('Buscando cara...');
    } catch (err) {
      setError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Habilitalo en el navegador.'
          : `No se pudo abrir la cámara: ${(err as Error).message}`
      );
      detenerCamara();
    }
  }

  const detectar = useCallback(async () => {
    const faceapi = faceapiRef.current;
    const video = videoRef.current;
    if (!faceapi || !video || video.readyState < 2) return null;
    return faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
      .withFaceLandmarks(true)
      .withFaceDescriptor();
  }, []);

  // Bucle de reconocimiento: solo corre en modo "reconocer" con la cámara abierta.
  useEffect(() => {
    if (!camaraActiva || modo !== 'reconocer') {
      setReconocido(null);
      return;
    }
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
            setReconocido({ nombre: mejor.nombre, distancia: mejor.distancia });
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
  }, [camaraActiva, modo, detectar]);

  async function capturarMuestra() {
    setError(null);
    const det = await detectar();
    if (!det) {
      setError('No se detecta ninguna cara. Acercate y mirá a la cámara.');
      return;
    }
    setMuestras((m) => [...m, Array.from(det.descriptor)]);
  }

  async function guardarRegistro() {
    const emp = empleados.find((e) => e.id === empleadoId);
    if (!emp) return;
    setGuardando(true);
    setError(null);
    try {
      await apiSend('POST', { empleadoId: emp.id, empleadoNombre: emp.nombre, descriptores: muestras });
      setMuestras([]);
      await queryClient.invalidateQueries({ queryKey: ['fichaje-caras'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrarRegistro(id: number, nombre: string) {
    if (!window.confirm(`¿Eliminar el registro facial de ${nombre}?`)) return;
    try {
      await apiSend('DELETE', { empleadoId: id });
      await queryClient.invalidateQueries({ queryKey: ['fichaje-caras'] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const registrados = new Map<number, { nombre: string; cantidad: number }>();
  for (const c of caras) {
    const prev = registrados.get(c.empleadoId);
    registrados.set(c.empleadoId, { nombre: c.empleadoNombre, cantidad: (prev?.cantidad ?? 0) + 1 });
  }

  const texto = busqueda.trim().toLowerCase();
  const empleadosFiltrados = empleados.filter((e) => !texto || e.nombre.toLowerCase().includes(texto));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(['reconocer', 'registrar'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                modo === m ? 'bg-brand-500 text-white' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {m === 'reconocer' ? 'Reconocer' : 'Registrar cara'}
            </button>
          ))}
          <button
            type="button"
            onClick={camaraActiva ? detenerCamara : iniciarCamara}
            className="ml-auto rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            {camaraActiva ? 'Apagar cámara' : 'Abrir cámara'}
          </button>
        </div>

        <div className="relative mx-auto aspect-[4/3] w-full max-w-xl overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
          {reconocido && modo === 'reconocer' && (
            <div className="absolute inset-x-0 bottom-0 bg-emerald-600/90 px-4 py-3 text-center">
              <p className="text-lg font-semibold text-white">Hola, {reconocido.nombre}</p>
              <p className="text-xs text-emerald-100">distancia {reconocido.distancia.toFixed(2)}</p>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-slate-400">{estado}</p>
        {error && <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}

        {modo === 'registrar' && (
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
                }}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
              >
                <option value="">{empleadosQ.isLoading ? 'Cargando...' : 'Elegí un empleado'}</option>
                {empleadosFiltrados.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                    {registrados.has(e.id) ? ' ✓' : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!camaraActiva || empleadoId === '' || muestras.length >= MUESTRAS_REGISTRO}
                onClick={capturarMuestra}
                className="rounded bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                Capturar muestra
              </button>
              <span className="text-sm text-slate-400">
                {muestras.length} / {MUESTRAS_REGISTRO} — variá un poco el ángulo entre muestras
              </span>
              <button
                type="button"
                disabled={muestras.length < MUESTRAS_REGISTRO || guardando}
                onClick={guardarRegistro}
                className="ml-auto rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {guardando ? 'Guardando...' : 'Guardar registro'}
              </button>
            </div>
          </div>
        )}
      </section>

      <aside className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Caras registradas ({registrados.size})</h3>
        {carasQ.isError && <p className="text-sm text-red-300">{(carasQ.error as Error).message}</p>}
        {registrados.size === 0 && !carasQ.isLoading && <p className="text-sm text-slate-500">Todavía no hay nadie registrado.</p>}
        <ul className="flex flex-col divide-y divide-slate-800">
          {[...registrados.entries()].map(([id, r]) => (
            <li key={id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p className="text-sm text-slate-100">{r.nombre}</p>
                <p className="text-xs text-slate-500">{r.cantidad} muestras</p>
              </div>
              <button type="button" onClick={() => borrarRegistro(id, r.nombre)} className="text-xs text-red-400 hover:text-red-300">
                Eliminar
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:only="react"`), same pattern as the other tabs. */
export default function FichajeApp() {
  return (
    <QueryProvider>
      <FichajeInner />
    </QueryProvider>
  );
}

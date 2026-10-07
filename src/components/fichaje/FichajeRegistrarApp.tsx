import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '../dashboard/useApiQuery';
import QueryProvider from '../QueryProvider';
import {
  registrarCaras,
  UMBRAL_PARECIDO,
  UMBRAL_RECONOCIMIENTO,
  type CaraRegistrada,
  type CaraResumen,
  type Empleado,
} from './fichaje-shared';
import { useFichajeCamara } from './useFichajeCamara';

const MUESTRAS_REGISTRO = 5;

interface Muestra {
  descriptor: number[];
  /** El empleado ya registrado (distinto del que se está registrando) con la cara más parecida a esta muestra. */
  cercano: { nombre: string; distancia: number } | null;
}

type Riesgo = 'confusion' | 'parecido' | 'ok';

function riesgoDe(distancia: number | undefined): Riesgo {
  if (distancia === undefined) return 'ok';
  if (distancia <= UMBRAL_RECONOCIMIENTO) return 'confusion';
  if (distancia <= UMBRAL_PARECIDO) return 'parecido';
  return 'ok';
}

const COLOR_RIESGO: Record<Riesgo, string> = {
  confusion: 'text-red-400',
  parecido: 'text-amber-300',
  ok: 'text-emerald-400',
};

function FichajeRegistrarInner({ esDev }: { esDev: boolean }) {
  const queryClient = useQueryClient();
  const empleadosQ = useApiQuery<Empleado[]>(['fichaje-empleados'], '/api/fichaje-empleados');
  const resumenQ = useApiQuery<CaraResumen[]>(['fichaje-caras-resumen'], '/api/fichaje-caras?resumen=1');
  // Los vectores de los ya registrados: se necesitan para avisar cuando una cara nueva se parece a alguna existente.
  const carasQ = useApiQuery<CaraRegistrada[]>(['fichaje-caras'], '/api/fichaje-caras');
  const empleados = empleadosQ.data ?? [];
  const registrados = new Map((resumenQ.data ?? []).map((r) => [r.empleadoId, r]));

  const { videoRef, faceapiRef, camaraActiva, estado, error, setError, iniciar, detener, detectar } = useFichajeCamara(false);

  const [empleadoId, setEmpleadoId] = useState<number | ''>('');
  const [busqueda, setBusqueda] = useState('');
  const [muestras, setMuestras] = useState<Muestra[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState<string | null>(null);

  const texto = busqueda.trim().toLowerCase();
  const empleadosFiltrados = empleados.filter((e) => !texto || e.nombre.toLowerCase().includes(texto));
  const yaRegistrado = empleadoId !== '' && registrados.has(empleadoId);

  const peorDistancia = muestras.reduce<number | undefined>((peor, m) => {
    if (!m.cercano) return peor;
    return peor === undefined ? m.cercano.distancia : Math.min(peor, m.cercano.distancia);
  }, undefined);
  const riesgoGeneral = riesgoDe(peorDistancia);
  const peorMuestra = muestras.find((m) => m.cercano && m.cercano.distancia === peorDistancia);
  // Una cara que se confunde con otra persona no se puede guardar salvo que lo confirme un admin.
  const bloqueado = riesgoGeneral === 'confusion' && !esDev;

  async function capturarMuestra() {
    setError(null);
    setGuardadoOk(null);
    const det = await detectar();
    const faceapi = faceapiRef.current;
    if (!det || !faceapi) {
      setError('No se detecta ninguna cara. Acercate y mirá a la cámara.');
      return;
    }
    let cercano: Muestra['cercano'] = null;
    for (const c of carasQ.data ?? []) {
      if (c.empleadoId === empleadoId) continue;
      const d = faceapi.euclideanDistance(det.descriptor, c.descriptor);
      if (!cercano || d < cercano.distancia) cercano = { nombre: c.empleadoNombre, distancia: d };
    }
    setMuestras((m) => [...m, { descriptor: Array.from(det.descriptor), cercano }]);
  }

  async function guardarRegistro() {
    const emp = empleados.find((e) => e.id === empleadoId);
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
      await queryClient.invalidateQueries({ queryKey: ['fichaje-caras-resumen'] });
      await queryClient.invalidateQueries({ queryKey: ['fichaje-caras'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={camaraActiva ? detener : iniciar}
          className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
        >
          {camaraActiva ? 'Apagar cámara' : 'Abrir cámara'}
        </button>
      </div>

      <div className="relative mx-auto aspect-[4/3] w-full max-w-xl overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
      </div>

      <p className="text-center text-sm text-slate-400">{estado}</p>
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
            disabled={muestras.length < MUESTRAS_REGISTRO || guardando || bloqueado}
            onClick={guardarRegistro}
            className="ml-auto rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : 'Guardar registro'}
          </button>
        </div>

        {muestras.length > 0 && (
          <div className="flex flex-col gap-1 rounded border border-slate-800 bg-slate-950/50 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Parecido con los ya registrados (distancia)</p>
            {muestras.map((m, i) => {
              const riesgo = riesgoDe(m.cercano?.distancia);
              return (
                <p key={i} className="text-sm text-slate-300">
                  Muestra {i + 1}:{' '}
                  {m.cercano ? (
                    <>
                      más parecida a <span className="font-medium text-slate-100">{m.cercano.nombre}</span>{' '}
                      <span className={`font-mono ${COLOR_RIESGO[riesgo]}`}>{m.cercano.distancia.toFixed(2)}</span>
                    </>
                  ) : (
                    <span className="text-slate-500">no hay otras caras registradas para comparar</span>
                  )}
                </p>
              );
            })}
            {riesgoGeneral === 'confusion' && (
              <p className="mt-1 text-sm text-red-400">
                Se parece demasiado a {peorMuestra?.cercano?.nombre} (menos de {UMBRAL_RECONOCIMIENTO.toFixed(2)}): al fichar los podría confundir.
                {esDev ? ' Podés guardar igual confirmando.' : ' Probá de nuevo con otra luz o ángulo; si persiste, avisá al administrador.'}
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

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '../dashboard/useApiQuery';
import QueryProvider from '../QueryProvider';
import { registrarCaras, type CaraResumen, type Empleado } from './fichaje-shared';
import { useFichajeCamara } from './useFichajeCamara';

const MUESTRAS_REGISTRO = 5;

function FichajeRegistrarInner({ esDev }: { esDev: boolean }) {
  const queryClient = useQueryClient();
  const empleadosQ = useApiQuery<Empleado[]>(['fichaje-empleados'], '/api/fichaje-empleados');
  const resumenQ = useApiQuery<CaraResumen[]>(['fichaje-caras-resumen'], '/api/fichaje-caras?resumen=1');
  const empleados = empleadosQ.data ?? [];
  const registrados = new Map((resumenQ.data ?? []).map((r) => [r.empleadoId, r]));

  const { videoRef, camaraActiva, estado, error, setError, iniciar, detener, detectar } = useFichajeCamara(false);

  const [empleadoId, setEmpleadoId] = useState<number | ''>('');
  const [busqueda, setBusqueda] = useState('');
  const [muestras, setMuestras] = useState<number[][]>([]);
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState<string | null>(null);

  const texto = busqueda.trim().toLowerCase();
  const empleadosFiltrados = empleados.filter((e) => !texto || e.nombre.toLowerCase().includes(texto));
  const yaRegistrado = empleadoId !== '' && registrados.has(empleadoId);

  async function capturarMuestra() {
    setError(null);
    setGuardadoOk(null);
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
      await registrarCaras(emp.id, emp.nombre, muestras);
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
            disabled={muestras.length < MUESTRAS_REGISTRO || guardando}
            onClick={guardarRegistro}
            className="ml-auto rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : 'Guardar registro'}
          </button>
        </div>
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

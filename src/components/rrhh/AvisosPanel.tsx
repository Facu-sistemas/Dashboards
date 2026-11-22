import { useEffect, useState } from 'react';
import {
  activarAudio,
  activarPush,
  audioActivo,
  desactivarPush,
  estadoPushInicial,
  guardarSonidoPreferido,
  sonidoPreferido,
  timbre,
  type EstadoPush,
} from './solicitudes-avisos';

/** Panel de la pestaña Solicitudes: cómo se entera RRHH de las solicitudes nuevas (timbre en la web y notificaciones en el dispositivo). */
export default function AvisosPanel() {
  const [sonido, setSonido] = useState(true);
  const [audioListo, setAudioListo] = useState(false);
  const [push, setPush] = useState<EstadoPush>('cargando');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSonido(sonidoPreferido());
    void estadoPushInicial().then(setPush);
    const revisar = () => setAudioListo(audioActivo());
    const intentar = () => void activarAudio().then(revisar);
    intentar();
    document.addEventListener('pointerdown', intentar, true);
    return () => document.removeEventListener('pointerdown', intentar, true);
  }, []);

  function alternarSonido() {
    const nuevo = !sonido;
    setSonido(nuevo);
    guardarSonidoPreferido(nuevo);
    // Al activarlo (es un toque) se desbloquea el audio y se prueba con el timbre.
    if (nuevo) void activarAudio().then((ok) => {
      setAudioListo(ok);
      if (ok) timbre();
    });
  }

  async function alternarPush() {
    setTrabajando(true);
    setError(null);
    try {
      setPush(push === 'activo' ? await desactivarPush() : await activarPush());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar.');
    } finally {
      setTrabajando(false);
    }
  }

  const boton = 'rounded-full border px-4 py-1.5 text-sm font-medium disabled:opacity-60';
  const on = 'border-emerald-700 bg-emerald-500/10 text-emerald-300';
  const off = 'border-slate-700 text-slate-300 hover:bg-slate-800';

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Avisos de solicitudes nuevas</h3>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:gap-8">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-200">Timbre en la web</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Suena y muestra un cartel cuando llega una solicitud, en cualquier pestaña de RRHH con la web abierta.
            {sonido && !audioListo && ' El navegador lo tiene bloqueado: tocá en cualquier parte de la página para habilitarlo.'}
          </p>
          <button type="button" onClick={alternarSonido} className={`${boton} mt-2 ${sonido ? on : off}`}>
            {sonido ? 'Timbre activado' : 'Timbre apagado'}
          </button>
        </div>

        <div className="flex-1">
          <p className="text-sm font-medium text-slate-200">Notificaciones en este dispositivo</p>
          <p className="mt-0.5 text-xs text-slate-400">Llegan al celular o la compu aunque la web esté cerrada.</p>
          {push === 'ios-sin-instalar' && (
            <p className="mt-2 text-xs text-amber-300">
              En iPhone hace falta instalar la web: abrila en Safari, tocá Compartir, "Agregar a pantalla de inicio" y abrila desde ahí.
            </p>
          )}
          {push === 'no-soportado' && <p className="mt-2 text-xs text-amber-300">Este navegador no admite notificaciones.</p>}
          {push === 'denegado' && (
            <p className="mt-2 text-xs text-amber-300">Las notificaciones están bloqueadas. Habilitalas en los ajustes del sitio (candado junto a la dirección) y recargá.</p>
          )}
          {(push === 'inactivo' || push === 'activo') && (
            <button type="button" disabled={trabajando} onClick={() => void alternarPush()} className={`${boton} mt-2 ${push === 'activo' ? on : off}`}>
              {trabajando ? 'Un momento...' : push === 'activo' ? 'Activadas en este dispositivo' : 'Activar en este dispositivo'}
            </button>
          )}
          {push === 'activo' && <p className="mt-1 text-xs text-slate-500">Tocá el botón para apagarlas.</p>}
          {error && <p className="mt-2 rounded border border-red-900 bg-red-950/50 px-3 py-1.5 text-xs text-red-300">{error}</p>}
        </div>
      </div>
    </section>
  );
}

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
  const [probando, setProbando] = useState(false);
  const [resultadoPrueba, setResultadoPrueba] = useState<{ ok: boolean; texto: string } | null>(null);

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

  // Diagnóstico: el servidor manda una notificación de prueba a todos los dispositivos suscriptos y cuenta qué pasó.
  async function probar() {
    setProbando(true);
    setResultadoPrueba(null);
    try {
      const res = await fetch('/api/rrhh-push', { method: 'PUT', headers: { Accept: 'application/json' } });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        data?: { configurado: boolean; dispositivos: number; enviados: number; fallidos: { codigo: number | null; mensaje: string }[] };
      };
      if (!json.ok || !json.data) throw new Error(json.error ?? 'No se pudo hacer la prueba.');
      const d = json.data;
      if (!d.configurado) setResultadoPrueba({ ok: false, texto: 'El servidor no tiene las claves de notificaciones (VAPID). Revisá las variables de entorno en Vercel y redeployá.' });
      else if (d.dispositivos === 0) setResultadoPrueba({ ok: false, texto: 'No hay ningún dispositivo suscripto en el servidor. Apagá y volvé a activar las notificaciones.' });
      else if (d.fallidos.length > 0)
        setResultadoPrueba({
          ok: false,
          texto: `Enviadas ${d.enviados} de ${d.dispositivos}. Fallaron: ${d.fallidos.map((f) => `${f.codigo ?? 'sin código'}: ${f.mensaje}`).join(' | ')}`,
        });
      else setResultadoPrueba({ ok: true, texto: `El servidor envió la prueba a ${d.enviados} dispositivo${d.enviados === 1 ? '' : 's'}. Si no la ves, el problema está en el sistema o el navegador de ese dispositivo (modo No molestar de Windows, notificaciones de Chrome bloqueadas).` });
    } catch (err) {
      setResultadoPrueba({ ok: false, texto: err instanceof Error ? err.message : 'No se pudo hacer la prueba.' });
    } finally {
      setProbando(false);
    }
  }

  const boton = 'rounded-full border px-4 py-1.5 text-sm font-medium disabled:opacity-60';
  const on = 'border-emerald-700 bg-emerald-500/10 text-emerald-300';
  const off = 'border-slate-700 text-slate-300 hover:bg-slate-800';

  return (
    <details className="rounded-lg border border-slate-800 bg-slate-900 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Avisos de solicitudes nuevas</span>
        <span className="text-xs text-slate-400">
          Timbre {sonido ? 'activado' : 'apagado'} · Notificaciones {push === 'activo' ? 'activadas' : 'sin activar'} · <span className="text-brand-400">Configurar</span>
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-slate-800 p-4 sm:flex-row sm:gap-8">
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
          {(push === 'activo' || push === 'inactivo') && (
            <button type="button" disabled={probando} onClick={() => void probar()} className={`${boton} ${off} mt-2 block`}>
              {probando ? 'Enviando prueba...' : 'Enviar notificación de prueba'}
            </button>
          )}
          {resultadoPrueba && (
            <p className={`mt-2 rounded border px-3 py-1.5 text-xs ${resultadoPrueba.ok ? 'border-emerald-900 bg-emerald-950/50 text-emerald-300' : 'border-red-900 bg-red-950/50 text-red-300'}`}>
              {resultadoPrueba.texto}
            </p>
          )}
          {error && <p className="mt-2 rounded border border-red-900 bg-red-950/50 px-3 py-1.5 text-xs text-red-300">{error}</p>}
        </div>
      </div>
    </details>
  );
}

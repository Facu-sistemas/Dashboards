import { useCallback, useEffect, useRef, useState } from 'react';
import { loadFaceApi, type FaceApi } from './fichaje-shared';

/**
 * Cámara frontal + modelos de reconocimiento, compartido por Reconocer y Registrar.
 *
 * Con `autoStart` (celular de quiosco) abre la cámara sola al montar, evita que la pantalla se apague
 * (Wake Lock) y la vuelve a abrir si el navegador la cortó al pasar a segundo plano.
 */
export function useFichajeCamara(autoStart: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceapiRef = useRef<FaceApi | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  /** true entre "abrir" y "apagar": distingue una cámara cortada por el sistema de una apagada a propósito. */
  const deseadaRef = useRef(false);

  const [camaraActiva, setCamaraActiva] = useState(false);
  const [estado, setEstado] = useState('Cámara apagada.');
  const [error, setError] = useState<string | null>(null);

  const pedirWakeLock = useCallback(async () => {
    try {
      wakeLockRef.current = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      // Sin Wake Lock (navegador viejo o ahorro de batería): la cámara anda igual, la pantalla puede apagarse.
    }
  }, []);

  const detener = useCallback(() => {
    deseadaRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    setCamaraActiva(false);
    setEstado('Cámara apagada.');
  }, []);

  const iniciar = useCallback(async () => {
    deseadaRef.current = true;
    setError(null);
    setEstado('Cargando modelos...');
    try {
      faceapiRef.current = await loadFaceApi();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (!deseadaRef.current) {
        // Se apagó (o se desmontó el componente) mientras cargaba: no dejar la cámara prendida.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setCamaraActiva(true);
      setEstado('Buscando cara...');
      void pedirWakeLock();
    } catch (err) {
      setError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Habilitalo en el navegador.'
          : `No se pudo abrir la cámara: ${(err as Error).message}`
      );
      detener();
    }
  }, [detener, pedirWakeLock]);

  useEffect(() => {
    if (autoStart) void iniciar();
    return detener;
    // Solo al montar/desmontar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al volver a la pestaña: el Wake Lock se libera solo al pasar a segundo plano, y algunos navegadores
  // cortan la cámara. Se recupera sin que nadie tenga que tocar nada.
  useEffect(() => {
    function alVolver() {
      if (document.visibilityState !== 'visible' || !deseadaRef.current) return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') {
        void iniciar();
        return;
      }
      void videoRef.current?.play().catch(() => {});
      void pedirWakeLock();
    }
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [iniciar, pedirWakeLock]);

  const detectar = useCallback(async () => {
    const faceapi = faceapiRef.current;
    const video = videoRef.current;
    if (!faceapi || !video || video.readyState < 2) return null;
    return faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
      .withFaceLandmarks(true)
      .withFaceDescriptor();
  }, []);

  return { videoRef, faceapiRef, camaraActiva, estado, setEstado, error, setError, iniciar, detener, detectar };
}

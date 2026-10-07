import { useEffect, useRef, useState } from 'react';

function leerPreferencia(clave: string): boolean {
  try {
    return localStorage.getItem(clave) === '1';
  } catch {
    return false;
  }
}

function guardarPreferencia(clave: string, valor: boolean) {
  try {
    localStorage.setItem(clave, valor ? '1' : '0');
  } catch {
    // Sin localStorage (modo privado): simplemente no se recuerda.
  }
}

/**
 * Modo "pantalla completa" para las pantallas de cámara. Hace dos cosas a la vez: tapa toda la página con
 * `fixed inset-0` (única opción en iPhone, que no tiene Fullscreen API para elementos) y además pide pantalla
 * completa real al navegador cuando existe. El contenedor que recibe `contenedorRef` es el que se agranda.
 *
 * Con `claveRecordar` el modo se recuerda en el dispositivo (celular de quiosco); sin ella arranca siempre apagado.
 */
export function usePantallaCompleta(claveRecordar?: string) {
  const [pantallaCompleta, setPantallaCompleta] = useState(() => (claveRecordar ? leerPreferencia(claveRecordar) : false));
  const contenedorRef = useRef<HTMLDivElement>(null);
  /** true si el navegador entró en pantalla completa real. */
  const fsRealRef = useRef(false);

  function recordar(valor: boolean) {
    if (claveRecordar) guardarPreferencia(claveRecordar, valor);
  }

  // Si el navegador sale de pantalla completa real (ej. gesto de volver o ESC), salimos también del modo.
  useEffect(() => {
    function alCambiar() {
      if (document.fullscreenElement) {
        fsRealRef.current = true;
      } else if (fsRealRef.current) {
        fsRealRef.current = false;
        setPantallaCompleta(false);
        recordar(false);
      }
    }
    document.addEventListener('fullscreenchange', alCambiar);
    return () => document.removeEventListener('fullscreenchange', alCambiar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pedirFullscreenReal() {
    if (document.fullscreenElement) return;
    void contenedorRef.current?.requestFullscreen?.().catch(() => {});
  }

  function entrar() {
    setPantallaCompleta(true);
    recordar(true);
    pedirFullscreenReal();
  }

  function salir() {
    setPantallaCompleta(false);
    recordar(false);
    fsRealRef.current = false;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }

  /** Para el onClick del contenedor: si quedó el modo recordado pero sin pantalla completa real, un toque la pide. */
  function alTocar() {
    if (pantallaCompleta) pedirFullscreenReal();
  }

  return { pantallaCompleta, contenedorRef, entrar, salir, alTocar };
}

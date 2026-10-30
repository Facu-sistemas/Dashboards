// Sonidos del quiosco de Fichaje, generados con WebAudio (sin archivos de audio ni licencias).
//   reconocido: un bip corto y suave ("te vi").
//   entrada:    dos tonos que suben.   salida: dos tonos que bajan (igual que el verde y el rojo, pero sin mirar la pantalla).
//   error:      un tono grave y corto, solo cuando falla un fichaje.
export type Sonido = 'reconocido' | 'entrada' | 'salida' | 'error';

const PREF_SILENCIO = 'fichaje-silencio';

function leerSilencio(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PREF_SILENCIO) === '1';
  } catch {
    return false;
  }
}

// Se guarda también en memoria: si localStorage no está disponible (modo privado), el botón de silenciar igual funciona en la sesión.
let silenciado = leerSilencio();

export function estaSilenciado(): boolean {
  return silenciado;
}

export function silenciar(valor: boolean): void {
  silenciado = valor;
  try {
    localStorage.setItem(PREF_SILENCIO, valor ? '1' : '0');
  } catch {
    // Sin localStorage: no se recuerda entre cargas de la página.
  }
}

let contexto: AudioContext | null = null;

function obtenerContexto(): AudioContext | null {
  if (contexto) return contexto;
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  contexto = new Ctor();
  return contexto;
}

/**
 * Los navegadores no dejan sonar audio hasta que la persona toca la pantalla una vez: hay que llamarla desde un toque
 * (o intentarla al cargar, por si el navegador ya lo permite). Devuelve si el audio quedó funcionando.
 */
export async function activarAudio(): Promise<boolean> {
  const c = obtenerContexto();
  if (!c) return false;
  if (c.state === 'suspended') {
    try {
      await c.resume();
    } catch {
      // Sigue bloqueado hasta el próximo toque.
    }
  }
  return c.state === 'running';
}

export function audioActivo(): boolean {
  return contexto?.state === 'running';
}

function tono(c: AudioContext, frecuencia: number, inicio: number, duracion: number, tipo: OscillatorType, volumen: number): void {
  const osc = c.createOscillator();
  const ganancia = c.createGain();
  osc.type = tipo;
  osc.frequency.setValueAtTime(frecuencia, inicio);
  // Subida y bajada rápidas del volumen: sin esto el tono empieza y termina con un "clic".
  ganancia.gain.setValueAtTime(0.0001, inicio);
  ganancia.gain.exponentialRampToValueAtTime(volumen, inicio + 0.015);
  ganancia.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
  osc.connect(ganancia).connect(c.destination);
  osc.start(inicio);
  osc.stop(inicio + duracion + 0.03);
}

export function sonar(sonido: Sonido): void {
  if (silenciado) return;
  const c = contexto;
  if (!c || c.state !== 'running') return;
  const t = c.currentTime + 0.02;
  switch (sonido) {
    case 'reconocido':
      tono(c, 880, t, 0.09, 'sine', 0.2);
      break;
    case 'entrada':
      tono(c, 660, t, 0.12, 'sine', 0.32);
      tono(c, 990, t + 0.14, 0.2, 'sine', 0.32);
      break;
    case 'salida':
      tono(c, 990, t, 0.12, 'sine', 0.32);
      tono(c, 660, t + 0.14, 0.2, 'sine', 0.32);
      break;
    case 'error':
      tono(c, 200, t, 0.3, 'triangle', 0.35);
      break;
  }
}

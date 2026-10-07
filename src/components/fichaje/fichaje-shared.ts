import type { ApiEnvelope } from '../dashboard/types';

export interface Empleado {
  id: number;
  nombre: string;
  departamento: string | null;
}

export interface CaraRegistrada {
  id: string;
  empleadoId: number;
  empleadoNombre: string;
  descriptor: number[];
}

export interface CaraResumen {
  empleadoId: number;
  empleadoNombre: string;
  cantidad: number;
  creadoEn: string;
}

export interface ResultadoFichaje {
  empleado: string;
  accion: 'entrada' | 'salida';
  hora: string | null;
}

/** Distancia euclídea máxima para considerar que dos descriptores son la misma persona (menor = más estricto). */
export const UMBRAL_RECONOCIMIENTO = 0.5;
/** Entre el umbral y este valor dos personas distintas ya se parecen lo suficiente como para vigilarlas. */
export const UMBRAL_PARECIDO = 0.6;

export type FaceApi = typeof import('@vladmandic/face-api');

const MODELS_URL = '/models/face';

let faceApiPromise: Promise<FaceApi> | null = null;

/** Carga la librería y los modelos una sola vez — recién cuando se abre la cámara. */
export function loadFaceApi(): Promise<FaceApi> {
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

export async function marcarEnOdoo(empleadoId: number): Promise<ResultadoFichaje> {
  const res = await fetch('/api/fichaje-marcar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ empleadoId }),
  });
  const json = (await res.json()) as ApiEnvelope<ResultadoFichaje>;
  if (!res.ok || !json.ok || !json.data) throw new Error(json.error ?? 'No se pudo fichar');
  return json.data;
}

export async function registrarCaras(empleadoId: number, empleadoNombre: string, descriptores: number[][]): Promise<void> {
  const res = await fetch('/api/fichaje-caras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ empleadoId, empleadoNombre, descriptores }),
  });
  const json = (await res.json()) as ApiEnvelope<unknown>;
  if (!res.ok || !json.ok) throw new Error(json.error ?? 'Error al guardar');
}

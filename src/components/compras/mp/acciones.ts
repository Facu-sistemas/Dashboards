// Llamadas de escritura de Compras MP (solo las usa el perfil de Compras). Devuelven los datos o lanzan un Error con el mensaje del servidor.
export async function postJson<T = unknown>(url: string, cuerpo: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo ?? {}) });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null;
  if (!res.ok || !body?.ok) throw new Error(body?.error ?? `El servidor respondió ${res.status}`);
  return body.data as T;
}

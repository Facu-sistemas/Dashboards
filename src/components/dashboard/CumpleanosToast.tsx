import { useEffect, useState } from 'react';

interface UpcomingBirthday {
  id: number;
  nombre: string;
  departamento: string | null;
  esHoy: boolean;
}

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dismissedIds(): number[] {
  try {
    const raw = localStorage.getItem(`cumple-dismissed-${todayKey()}`);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

function dismiss(id: number) {
  try {
    const ids = dismissedIds();
    if (!ids.includes(id)) ids.push(id);
    localStorage.setItem(`cumple-dismissed-${todayKey()}`, JSON.stringify(ids));
  } catch {
    // best-effort only — worst case the toast reappears on next reload
  }
}

/**
 * Small, self-dismissing heads-up for today's birthdays — deliberately NOT
 * built on useApiQuery/QueryProvider: this is a one-shot fire-and-forget
 * widget (fetch once, show, let the user dismiss), not a filter-driven panel
 * that needs caching/refetch semantics.
 */
export default function CumpleanosToast() {
  const [personas, setPersonas] = useState<UpcomingBirthday[] | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/cumpleanos', { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((body: { ok: boolean; data?: UpcomingBirthday[] }) => {
        if (cancelled || !body.ok || !body.data) return;
        const yaVistos = new Set(dismissedIds());
        const hoy = body.data.filter((e) => e.esHoy && !yaVistos.has(e.id));
        if (hoy.length > 0) {
          setPersonas(hoy);
          // Small delay so it slides in after the page has settled, instead
          // of competing with everything else appearing on first paint.
          window.setTimeout(() => setVisible(true), 600);
        }
      })
      .catch(() => {
        // Silently skip — a failed background check shouldn't surface an error to the user.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!personas || personas.length === 0) return null;

  function handleDismiss(id: number) {
    dismiss(id);
    setPersonas((prev) => {
      const next = (prev ?? []).filter((p) => p.id !== id);
      return next.length > 0 ? next : null;
    });
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2">
      {personas.slice(0, 3).map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => handleDismiss(p.id)}
          className={`pointer-events-auto flex max-w-xs items-start gap-3 rounded-lg border border-amber-500/30 bg-slate-900/95 p-3 text-left shadow-lg shadow-black/20 backdrop-blur transition-all duration-300 ease-out hover:border-amber-500/60 ${
            visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
        >
          <span className="text-xl leading-none">🎂</span>
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-slate-100">Hoy cumple {p.nombre}</span>
            {p.departamento && <span className="text-xs text-slate-400">{p.departamento}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

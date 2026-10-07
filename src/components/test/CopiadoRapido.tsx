import { useEffect, useState } from 'react';

const STORAGE_KEY = 'copiado-rapido:tags';

type Tag = { id: string; nombre: string; texto: string };

function cargarTags(): Tag[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Tag[]) : [];
  } catch {
    return [];
  }
}

function guardarTags(tags: Tag[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
  } catch {
    // sin storage disponible: los tags quedan solo en memoria
  }
}

export default function CopiadoRapido() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [cargado, setCargado] = useState(false);
  const [nombre, setNombre] = useState('');
  const [texto, setTexto] = useState('');
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    setTags(cargarTags());
    setCargado(true);
  }, []);

  useEffect(() => {
    if (cargado) guardarTags(tags);
  }, [tags, cargado]);

  const handleAgregar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!texto.trim()) return;
    const nuevo: Tag = { id: crypto.randomUUID(), nombre: nombre.trim() || texto.trim(), texto };
    setTags((prev) => [...prev, nuevo]);
    setNombre('');
    setTexto('');
  };

  const handleCopiar = async (tag: Tag) => {
    try {
      await navigator.clipboard.writeText(tag.texto);
      setCopiado(tag.id);
      setTimeout(() => setCopiado((actual) => (actual === tag.id ? null : actual)), 1200);
    } catch (err) {
      console.error('No se pudo copiar al portapapeles', err);
    }
  };

  const handleBorrar = (id: string) => {
    setTags((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="max-w-2xl">
      <form onSubmit={handleAgregar} className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre (opcional)"
          className="w-40 rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-sm text-slate-200 focus:border-brand-500/50 focus:outline-none"
        />
        <input
          type="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Texto a copiar, ej: ?debug=1"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 font-mono text-sm text-slate-200 focus:border-brand-500/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!texto.trim()}
          className="rounded-lg bg-brand-500/10 px-4 py-1.5 text-sm text-brand-400 ring-1 ring-brand-500/30 transition hover:bg-brand-500/20 disabled:opacity-50"
        >
          Agregar
        </button>
      </form>

      {cargado && tags.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">Todavía no guardaste ningún tag.</p>
      )}

      {tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="group flex items-center overflow-hidden rounded-lg ring-1 ring-slate-700 transition hover:ring-brand-500/40"
            >
              <button
                type="button"
                onClick={() => handleCopiar(tag)}
                title={tag.texto}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm transition ${
                  copiado === tag.id ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-900/40 text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {copiado === tag.id ? (
                  '¡Copiado!'
                ) : (
                  <>
                    {tag.nombre !== tag.texto.trim() && (
                      <>
                        <span className="font-medium">{tag.nombre}</span>
                        <span className="text-slate-600">|</span>
                      </>
                    )}
                    <span className="max-w-xs truncate font-mono text-slate-400">{tag.texto}</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleBorrar(tag.id)}
                title="Borrar"
                className="border-l border-slate-700 bg-slate-900/40 px-2 py-1.5 text-sm text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

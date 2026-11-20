import { useMemo, useState } from 'react';
import bwipjs from 'bwip-js/browser';

type Correccion = 'L' | 'M' | 'Q' | 'H';

const CORRECCIONES: { v: Correccion; label: string }[] = [
  { v: 'L', label: 'L · 7 % (más liviano)' },
  { v: 'M', label: 'M · 15 % (recomendado)' },
  { v: 'Q', label: 'Q · 25 %' },
  { v: 'H', label: 'H · 30 % (más robusto)' },
];

type OpcionesBwip = Parameters<typeof bwipjs.toSVG>[0];

/** `eclevel` (nivel de corrección) es una opción de BWIPP que los tipos de bwip-js no declaran; se pasa vía variable para evitar el chequeo de propiedades extra. */
function opcionesQr(text: string, eclevel: Correccion, extra: Record<string, unknown>): OpcionesBwip {
  const o = { bcid: 'qrcode', text, eclevel, ...extra };
  return o as OpcionesBwip;
}

function generar(texto: string, ec: Correccion): { svg: string; error: string } {
  if (!texto) return { svg: '', error: '' };
  try {
    const svg = bwipjs.toSVG(opcionesQr(texto, ec, { scale: 1, paddingwidth: 0, paddingheight: 0 }));
    return { svg, error: '' };
  } catch (e) {
    return { svg: '', error: e instanceof Error ? e.message : String(e) };
  }
}

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export default function QrGenerador() {
  const [texto, setTexto] = useState('https://');
  const [ec, setEc] = useState<Correccion>('M');
  const [porLinea, setPorLinea] = useState(false);

  const valores = useMemo(() => (porLinea ? texto.split('\n').map((l) => l.trim()).filter(Boolean) : texto.trim() ? [texto.trim()] : []), [texto, porLinea]);
  const resultados = useMemo(() => valores.map((v) => ({ valor: v, ...generar(v, ec) })), [valores, ec]);

  const nombre = (v: string) => `qr-${v.replace(/^https?:\/\//, '').replace(/[^\w-]+/g, '_').slice(0, 40) || 'codigo'}`;

  const descargarPng = (v: string) => {
    try {
      const canvas = document.createElement('canvas');
      bwipjs.toCanvas(canvas, opcionesQr(v, ec, { scale: 10, paddingwidth: 4, paddingheight: 4, backgroundcolor: 'FFFFFF' }));
      canvas.toBlob((b) => b && descargar(b, `${nombre(v)}.png`), 'image/png');
    } catch {
      /* el error ya se muestra en la vista previa */
    }
  };

  return (
    <div className="grid items-start gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <label className="text-sm font-medium text-slate-300" htmlFor="qr-data">
          Texto o enlace
        </label>
        <textarea
          id="qr-data"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 font-mono text-sm text-slate-100 focus:border-purple-500 focus:outline-none"
          placeholder="Escribí o pegá el texto, enlace, Wi-Fi, etc."
        />
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Corrección de errores
          <select value={ec} onChange={(e) => setEc(e.target.value as Correccion)} className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100">
            {CORRECCIONES.map((c) => (
              <option key={c.v} value={c.v}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={porLinea} onChange={(e) => setPorLinea(e.target.checked)} />
          Generar un QR por línea
        </label>
      </div>

      <div className="flex flex-col gap-4">
        {resultados.length === 0 && <p className="text-sm text-slate-400">Escribí algo para generar el QR.</p>}
        {resultados.map((r, i) => (
          <div key={`${i}-${r.valor}`} className="flex flex-col items-start gap-2">
            {r.error ? (
              <p className="text-sm text-red-400">No se pudo generar «{r.valor.slice(0, 40)}»: {r.error}</p>
            ) : (
              <>
                {/* Fondo blanco fijo: el QR necesita contraste y margen claro para leerse, también en tema oscuro. */}
                <div
                  className="rounded-lg bg-white p-3"
                  style={{ width: 200, height: 200 }}
                  role="img"
                  aria-label={`Código QR de ${r.valor.slice(0, 60)}`}
                  dangerouslySetInnerHTML={{ __html: r.svg.replace('<svg ', '<svg style="display:block;width:100%;height:100%" ') }}
                />
                {porLinea && <p className="max-w-full break-all text-xs text-slate-400">{r.valor}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => descargar(new Blob([r.svg], { type: 'image/svg+xml' }), `${nombre(r.valor)}.svg`)} className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">
                    Descargar SVG
                  </button>
                  <button type="button" onClick={() => descargarPng(r.valor)} className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">
                    Descargar PNG
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

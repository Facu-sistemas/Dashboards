import { useMemo, useState } from 'react';
import bwipjs from 'bwip-js/browser';

function generar(texto: string, mostrarTexto: boolean): { svg: string; error: string } {
  if (!texto) return { svg: '', error: '' };
  try {
    const svg = bwipjs.toSVG({
      bcid: 'code128',
      text: texto,
      scale: 2,
      height: 14,
      includetext: mostrarTexto,
      textxalign: 'center',
      paddingwidth: 10,
      paddingheight: 10,
    });
    // bwip-js no pone width/height: sin esto el SVG colapsa a un punto en un contenedor sin ancho fijo.
    const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const conTamano = vb ? svg.replace('<svg ', `<svg width="${vb[1]}" height="${vb[2]}" `) : svg;
    return { svg: conTamano, error: '' };
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

export default function BarcodeCode128() {
  const [texto, setTexto] = useState('ABC-abc-1234');
  const [mostrarTexto, setMostrarTexto] = useState(true);
  const [porLinea, setPorLinea] = useState(false);

  const valores = useMemo(() => (porLinea ? texto.split('\n').map((l) => l.trim()).filter(Boolean) : texto ? [texto] : []), [texto, porLinea]);
  const resultados = useMemo(() => valores.map((v) => ({ valor: v, ...generar(v, mostrarTexto) })), [valores, mostrarTexto]);

  const nombreArchivo = (v: string) => `code128-${v.replace(/[^\w-]+/g, '_').slice(0, 40) || 'codigo'}`;

  const descargarSvg = (v: string, svg: string) => descargar(new Blob([svg], { type: 'image/svg+xml' }), `${nombreArchivo(v)}.svg`);

  const descargarPng = (v: string) => {
    try {
      const canvas = document.createElement('canvas');
      bwipjs.toCanvas(canvas, {
        bcid: 'code128',
        text: v,
        scale: 3,
        height: 14,
        includetext: mostrarTexto,
        textxalign: 'center',
        paddingwidth: 10,
        paddingheight: 10,
        backgroundcolor: 'FFFFFF',
      });
      canvas.toBlob((b) => b && descargar(b, `${nombreArchivo(v)}.png`), 'image/png');
    } catch {
      /* el error ya se muestra en la vista previa */
    }
  };

  return (
    <div className="grid items-start gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <label className="text-sm font-medium text-slate-300" htmlFor="barcode-data">
          Datos (Code-128)
        </label>
        <textarea
          id="barcode-data"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 font-mono text-sm text-slate-100 focus:border-purple-500 focus:outline-none"
          placeholder="Escribí o pegá el texto a convertir"
        />
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={porLinea} onChange={(e) => setPorLinea(e.target.checked)} />
          Generar un código por línea
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={mostrarTexto} onChange={(e) => setMostrarTexto(e.target.checked)} />
          Mostrar el texto debajo de las barras
        </label>
      </div>

      <div className="flex flex-col gap-4">
        {resultados.length === 0 && <p className="text-sm text-slate-400">Escribí algo para generar el código de barras.</p>}
        {resultados.map((r, i) => (
          <div key={`${i}-${r.valor}`} className="flex flex-col items-start gap-2">
            {r.error ? (
              <p className="text-sm text-red-400">No se pudo generar «{r.valor}»: {r.error}</p>
            ) : (
              <>
                {/* Fondo blanco fijo: el código necesita contraste y margen claro para leerse, también en tema oscuro. */}
                <div
                  className="max-w-full overflow-x-auto rounded-lg bg-white p-2"
                  role="img"
                  aria-label={`Código de barras Code-128 de ${r.valor}`}
                  dangerouslySetInnerHTML={{ __html: r.svg }}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => descargarSvg(r.valor, r.svg)}
                    className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                  >
                    Descargar SVG
                  </button>
                  <button
                    type="button"
                    onClick={() => descargarPng(r.valor)}
                    className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                  >
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

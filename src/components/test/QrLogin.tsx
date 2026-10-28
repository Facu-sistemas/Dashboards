import { useEffect, useState } from 'react';
import bwipjs from 'bwip-js/browser';

function generarQr(url: string): string {
  return bwipjs.toSVG({ bcid: 'qrcode', text: url, scale: 1, paddingwidth: 0, paddingheight: 0 });
}

export default function QrLogin() {
  const [url, setUrl] = useState('');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const destino = `${window.location.origin}/login`;
    setUrl(destino);
    try {
      setSvg(generarQr(destino));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const esLocal = /^https?:\/\/(localhost|127\.|192\.168\.|10\.)/.test(url);

  return (
    <div className="flex flex-col items-start gap-3">
      {error ? (
        <p className="text-sm text-red-400">No se pudo generar el QR: {error}</p>
      ) : (
        // Fondo blanco fijo: el QR necesita contraste y margen blanco para leerse, también en tema oscuro.
        <div
          className="rounded-lg bg-white p-4"
          style={{ width: 220, height: 220 }}
          role="img"
          aria-label={`Código QR que abre ${url}`}
          dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', '<svg style="display:block;width:100%;height:100%" ') }}
        />
      )}
      <p className="break-all text-xs text-slate-400">{url}</p>
      {esLocal && (
        <p className="max-w-md text-xs text-amber-400">
          Estás en una dirección local: el celular solo podrá abrirla si está en la misma red. Desde la web publicada el QR apunta a la
          dirección pública.
        </p>
      )}
    </div>
  );
}

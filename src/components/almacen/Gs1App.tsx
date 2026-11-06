import { useEffect, useMemo, useState } from 'react';
import bwipjs from 'bwip-js/browser';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import type { EtiquetaProducto } from '@/lib/odoo/etiquetas';

const inputClasses =
  'w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none';

/** Dígito verificador GS1 (módulo 10) de los primeros 13 dígitos de un GTIN-14. */
function digitoGs1(base13: string): number {
  let suma = 0;
  for (let i = 0; i < 13; i++) suma += Number(base13[base13.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (suma % 10)) % 10;
}

/** Normaliza un código (EAN-8/UPC/EAN-13/GTIN-14) a GTIN-14 rellenando con ceros. Devuelve null si no es numérico o tiene un largo inválido. */
function aGtin14(raw: string): { gtin: string; ok: boolean } | null {
  const d = raw.replace(/\s+/g, '');
  if (!/^\d{8,14}$/.test(d)) return null;
  const gtin = d.padStart(14, '0');
  return { gtin, ok: digitoGs1(gtin.slice(0, 13)) === Number(gtin[13]) };
}

function ProductPicker({ selected, onSelect }: { selected: EtiquetaProducto | null; onSelect: (p: EtiquetaProducto) => void }) {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const query = useApiQuery<EtiquetaProducto[]>(
    ['etiquetas-productos', q],
    `/api/etiquetas-productos?${new URLSearchParams({ q, limit: '15' })}`,
    { enabled: q.length >= 2 },
  );
  const items = q.length >= 2 ? (query.data ?? []) : [];

  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor="gs1-producto" className="text-xs text-slate-400">
        Producto de Odoo (opcional)
      </label>
      <input
        id="gs1-producto"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={selected ? selected.name : 'Buscar por nombre o código…'}
        className={inputClasses}
      />
      {open && q.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded border border-slate-700 bg-slate-900 shadow-lg shadow-black/40">
          {query.isError ? (
            <p className="p-3 text-sm text-red-300">No se pudo consultar Odoo.</p>
          ) : query.isLoading ? (
            <p className="p-3 text-sm text-slate-500">Buscando…</p>
          ) : items.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">Sin resultados.</p>
          ) : (
            items.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => {
                  onSelect(p);
                  setInput('');
                  setQ('');
                  setOpen(false);
                }}
                className="flex w-full flex-col gap-0.5 border-b border-slate-800 px-3 py-2 text-left last:border-0 hover:bg-slate-800"
              >
                <span className="text-sm text-slate-100">{p.name}</span>
                <span className="text-xs text-slate-400">
                  {p.barcode ?? 'sin código de barras'} · {p.uom ?? '—'}
                </span>
              </button>
            ))
          )}
        </div>
      )}
      {selected && <p className="text-xs text-emerald-400">Seleccionado: {selected.name}</p>}
    </div>
  );
}

type Unidad = 'kg' | 'g' | 'lb' | 'm' | 'cm' | 'm2' | 'l' | 'm3';

/**
 * AIs GS1 de cantidad neta, todos con 3 decimales (6 dígitos): 3103 kg, 3203 lb, 3113 largo en m,
 * 3143 área en m², 3153 volumen en l, 3163 volumen en m³. g y cm se codifican en kg y m (1 g = 0,001 kg; 1 cm = 0,01 m).
 */
const UNIDADES: Record<Unidad, { ai: string; factor: number; label: string; max: string }> = {
  kg: { ai: '3103', factor: 1000, label: 'kg (peso)', max: '1000 kg' },
  g: { ai: '3103', factor: 1, label: 'g (peso)', max: '1.000.000 g' },
  lb: { ai: '3203', factor: 1000, label: 'lb (peso)', max: '1000 lb' },
  m: { ai: '3113', factor: 1000, label: 'm (largo)', max: '1000 m' },
  cm: { ai: '3113', factor: 10, label: 'cm (largo)', max: '100.000 cm' },
  m2: { ai: '3143', factor: 1000, label: 'm² (área)', max: '1000 m²' },
  l: { ai: '3153', factor: 1000, label: 'l (volumen)', max: '1000 l' },
  m3: { ai: '3163', factor: 1000, label: 'm³ (volumen)', max: '1000 m³' },
};

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

function Gs1Inner() {
  const [producto, setProducto] = useState<EtiquetaProducto | null>(null);
  const [gtin, setGtin] = useState('');
  const [lote, setLote] = useState('');
  const [peso, setPeso] = useState('');
  const [unidad, setUnidad] = useState<Unidad>('kg');

  const elegir = (p: EtiquetaProducto) => {
    setProducto(p);
    setGtin(p.barcode ?? '');
  };

  const g = aGtin14(gtin);
  const pesoNum = Number(peso.replace(',', '.'));
  const pesoCod = Math.round(pesoNum * UNIDADES[unidad].factor);
  const pesoOk = peso.trim() !== '' && Number.isFinite(pesoNum) && pesoCod > 0 && pesoCod <= 999999;
  const loteLimpio = lote.trim();

  const errores: string[] = [];
  if (!gtin.trim()) errores.push('Falta el GTIN.');
  else if (!g) errores.push('El GTIN debe tener entre 8 y 14 dígitos, solo números.');
  if (!loteLimpio) errores.push('Falta el lote.');
  else if (loteLimpio.length > 20) errores.push('El lote admite hasta 20 caracteres.');
  else if (/[()]/.test(loteLimpio)) errores.push('El lote no puede llevar paréntesis.');
  if (!peso.trim()) errores.push('Falta la cantidad neta.');
  else if (!pesoOk) errores.push(`La cantidad neta debe ser un número mayor a 0 y menor a ${UNIDADES[unidad].max} (máx. 3 decimales).`);

  // AI de cantidad neta según la unidad elegida (ver UNIDADES), 6 dígitos. Orden: AIs de largo fijo primero, lote (variable) al final → no hace falta separador FNC1 extra.
  const texto = useMemo(() => {
    if (errores.length > 0 || !g) return '';
    return `(01)${g.gtin}(${UNIDADES[unidad].ai})${String(pesoCod).padStart(6, '0')}(10)${loteLimpio}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gtin, lote, peso, unidad]);

  const { svg, error } = useMemo(() => {
    if (!texto) return { svg: '', error: '' };
    try {
      const raw = bwipjs.toSVG({ bcid: 'gs1-128', text: texto, scale: 2, height: 16, includetext: true, textxalign: 'center', paddingwidth: 10, paddingheight: 10 });
      const vb = raw.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      return { svg: vb ? raw.replace('<svg ', `<svg width="${vb[1]}" height="${vb[2]}" `) : raw, error: '' };
    } catch (e) {
      return { svg: '', error: e instanceof Error ? e.message : String(e) };
    }
  }, [texto]);

  const nombre = `gs1-${loteLimpio.replace(/[^\w-]+/g, '_').slice(0, 30) || 'codigo'}`;

  const descargarPng = () => {
    try {
      const canvas = document.createElement('canvas');
      bwipjs.toCanvas(canvas, { bcid: 'gs1-128', text: texto, scale: 3, height: 16, includetext: true, textxalign: 'center', paddingwidth: 10, paddingheight: 10, backgroundcolor: 'FFFFFF' });
      canvas.toBlob((b) => b && descargar(b, `${nombre}.png`), 'image/png');
    } catch {
      /* el error ya se muestra */
    }
  };

  return (
    <div className="grid items-start gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <ProductPicker selected={producto} onSelect={elegir} />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">GTIN del producto (se completa solo desde Odoo, se puede editar)</span>
          <input value={gtin} onChange={(e) => setGtin(e.target.value)} inputMode="numeric" placeholder="ej. 7790001234567" className={inputClasses} />
          {g && !g.ok && <span className="text-xs text-amber-400">El dígito verificador no coincide: revisá que el GTIN sea correcto.</span>}
          {g && g.ok && g.gtin !== gtin.trim() && <span className="text-xs text-slate-500">Se usa como GTIN-14: {g.gtin}</span>}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Lote</span>
          <input value={lote} onChange={(e) => setLote(e.target.value)} maxLength={20} placeholder="ej. L2406-A" className={inputClasses} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Cantidad neta</span>
          <div className="flex gap-2">
            <input value={peso} onChange={(e) => setPeso(e.target.value)} inputMode="decimal" placeholder="ej. 25,5" className={inputClasses} />
            <select value={unidad} onChange={(e) => setUnidad(e.target.value as Unidad)} aria-label="Unidad" className={`${inputClasses} w-36`}>
              {(Object.keys(UNIDADES) as Unidad[]).map((u) => (
                <option key={u} value={u}>
                  {UNIDADES[u].label}
                </option>
              ))}
            </select>
          </div>
        </label>
        <p className="text-xs text-slate-500">Se genera un GS1-128 con (01) GTIN, la cantidad neta (peso, largo, área o volumen según la unidad) y (10) lote. No escribe nada en Odoo.</p>
      </div>

      <div className="flex flex-col items-start gap-3">
        {error ? (
          <p className="text-sm text-red-400">No se pudo generar el código: {error}</p>
        ) : !svg ? (
          <p className="text-sm text-slate-400">{errores[0] ?? 'Completá los datos para ver el código.'}</p>
        ) : (
          <>
            {/* Fondo blanco fijo: el código necesita contraste y margen claro para leerse, también en tema oscuro. */}
            <div
              className="max-w-full overflow-x-auto rounded-lg bg-white p-2"
              role="img"
              aria-label={`Código GS1-128 ${texto}`}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <p className="break-all font-mono text-xs text-slate-400">{texto}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => descargar(new Blob([svg], { type: 'image/svg+xml' }), `${nombre}.svg`)} className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">
                Descargar SVG
              </button>
              <button type="button" onClick={descargarPng} className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">
                Descargar PNG
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Gs1App() {
  return (
    <QueryProvider>
      <Gs1Inner />
    </QueryProvider>
  );
}

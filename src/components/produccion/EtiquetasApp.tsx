import { useEffect, useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import type { EtiquetaProducto } from '../../lib/odoo/etiquetas';
import {
  ETIQUETA_CSS,
  etiquetaCajaHtml,
  etiquetaRolloHtml,
  imprimirEtiquetas,
  type EtiquetaData,
} from './etiquetas-print';

const STORAGE_KEY = 'etiquetas-proveedor-v1';

/** Form state kept as strings so inputs can be edited freely (numbers parsed on render). */
interface FormState {
  codigo: string;
  descripcion: string;
  color: string;
  ancho: string;
  composicion: string;
  origen: string;
  fecha: string;
  empresa: string;
  importador: string;
  lote: string;
  mRollo: string;
  kgRollo: string;
  rollosCaja: string;
  kgCaja: string;
  medidasCaja: string;
  bcCaja: string;
  bcRollo: string;
}

const DEFAULTS: FormState = {
  codigo: 'A033',
  descripcion: 'Cincha elástica',
  color: 'Verde y negro',
  ancho: '48 ± 3 mm',
  composicion: '60% polipropileno 40% caucho',
  origen: 'China',
  fecha: 'Ago. 2026',
  empresa: 'FRONTERA LIVING',
  importador:
    'Importador: FRONTERA LIVING SA · CUIT 30707884300 · Marcos Nicolini 1435, San Francisco, Córdoba',
  lote: '2026082102',
  mRollo: '50',
  kgRollo: '2',
  rollosCaja: '10',
  kgCaja: '21',
  medidasCaja: '64 × 32 × 26,5 cm',
  bcCaja: 'MP02D05-CJ',
  bcRollo: 'MP02D05-RL',
};

const num = (v: string) => parseFloat(v.replace(',', '.')) || 0;

function loadForm(): FormState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<FormState>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const inputClasses =
  'w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none';

function Field({
  id,
  label,
  value,
  onChange,
  className = '',
  readOnly = false,
  inputMode,
  list,
}: {
  id: string;
  label: string;
  value: string;
  onChange?: (v: string) => void;
  className?: string;
  readOnly?: boolean;
  inputMode?: 'decimal' | 'numeric';
  list?: string;
}) {
  return (
    <label htmlFor={id} className={`flex flex-col gap-1 text-xs text-slate-400 ${className}`}>
      {label}
      <input
        id={id}
        value={value}
        readOnly={readOnly}
        inputMode={inputMode}
        list={list}
        onChange={(e) => onChange?.(e.target.value)}
        className={`${inputClasses} ${readOnly ? 'opacity-70' : ''}`}
      />
    </label>
  );
}

/** Live Odoo product search: picking one fills the description and the packaging barcodes. */
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
      <label htmlFor="etq-producto" className="text-xs text-slate-400">
        Producto de Odoo
      </label>
      <input
        id="etq-producto"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={selected ? selected.name : 'Buscar por nombre o código (ej. cincha)…'}
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
                  {p.barcode ?? 'sin código de barras'} · {p.uom ?? '—'} ·{' '}
                  {p.packagings.length > 0 ? `${p.packagings.length} empaquetado(s)` : 'sin empaquetados'}
                </span>
              </button>
            ))
          )}
        </div>
      )}
      {selected && (
        <p className="text-xs text-emerald-400">
          Seleccionado: {selected.name} ({selected.barcode ?? 'sin código de barras'}, en {selected.uom ?? '—'})
        </p>
      )}
    </div>
  );
}

type PackagingCheck = { ok: boolean; msg: string };

/** Checks a label's barcode against the selected product's packagings (what Odoo will actually do on scan). */
function checkPackaging(producto: EtiquetaProducto | null, barcode: string, qtyEsperada: number): PackagingCheck | null {
  if (!producto) return null;
  if (!barcode) return { ok: false, msg: 'Falta el código.' };
  const pk = producto.packagings.find((x) => x.barcode === barcode);
  if (pk) {
    return Math.abs(pk.qty - qtyEsperada) < 1e-6
      ? { ok: true, msg: `Odoo lo reconoce: empaquetado "${pk.name}", suma ${pk.qty} ${producto.uom ?? ''}.` }
      : { ok: false, msg: `El empaquetado "${pk.name}" en Odoo suma ${pk.qty}, y la etiqueta dice ${qtyEsperada}.` };
  }
  if (producto.barcode === barcode)
    return { ok: false, msg: `Ese es el código del producto: Odoo sumaría 1, no ${qtyEsperada}. Creá un empaquetado.` };
  return { ok: false, msg: `Ese código no existe como empaquetado de ${producto.name} en Odoo.` };
}

/** The preview lives in an iframe so the label's own CSS (class names like .grid/.code) can't collide with the dashboard's Tailwind styles. */
function LabelPreview({ html, title }: { html: string; title: string }) {
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}${ETIQUETA_CSS}</style></head><body>${html}</body></html>`;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-slate-400">{title}</span>
      <iframe
        title={title}
        srcDoc={srcDoc}
        scrolling="no"
        style={{ width: '100mm', height: '100mm', border: 0, background: '#fff' }}
        className="rounded shadow-lg shadow-black/40"
      />
    </div>
  );
}

function EtiquetasInner() {
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [producto, setProducto] = useState<EtiquetaProducto | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setForm(loadForm());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      // localStorage unavailable (private mode): the form simply doesn't persist.
    }
  }, [form, loaded]);

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const data: EtiquetaData = useMemo(
    () => ({
      codigo: form.codigo.trim().toUpperCase(),
      descripcion: form.descripcion.trim(),
      color: form.color.trim(),
      ancho: form.ancho.trim(),
      composicion: form.composicion.trim(),
      origen: form.origen.trim(),
      fecha: form.fecha.trim(),
      empresa: form.empresa.trim(),
      importador: form.importador.trim(),
      lote: form.lote.trim(),
      mRollo: num(form.mRollo),
      kgRollo: num(form.kgRollo),
      rollosCaja: Math.round(num(form.rollosCaja)),
      kgCaja: num(form.kgCaja),
      medidasCaja: form.medidasCaja.trim(),
      bcCaja: form.bcCaja.trim(),
      bcRollo: form.bcRollo.trim(),
    }),
    [form],
  );

  const mCaja = data.mRollo * data.rollosCaja;

  function elegirProducto(p: EtiquetaProducto) {
    setProducto(p);
    const cajaPk = p.packagings.find((x) => x.barcode && Math.abs(x.qty - mCaja) < 1e-6);
    const rolloPk = p.packagings.find((x) => x.barcode && Math.abs(x.qty - data.mRollo) < 1e-6);
    setForm((f) => ({
      ...f,
      descripcion: p.name,
      bcCaja: cajaPk?.barcode ?? f.bcCaja,
      bcRollo: rolloPk?.barcode ?? f.bcRollo,
    }));
  }

  const checkCaja = checkPackaging(producto, data.bcCaja, mCaja);
  const checkRollo = checkPackaging(producto, data.bcRollo, data.mRollo);
  const sinEmpaquetados = producto !== null && producto.packagings.length === 0;

  const cajaHtml = useMemo(() => etiquetaCajaHtml(data), [data]);
  const rolloHtml = useMemo(() => etiquetaRolloHtml(data), [data]);

  const warnings: string[] = [];
  if (data.kgCaja > 0 && data.kgCaja < data.kgRollo * data.rollosCaja)
    warnings.push(
      `El peso bruto de la caja (${data.kgCaja} kg) es menor que ${data.rollosCaja} rollos × ${data.kgRollo} kg.`,
    );
  if (!data.bcCaja || !data.bcRollo) warnings.push('Falta cargar el código de barras del empaquetado de caja y/o de rollo.');
  if (data.bcCaja && data.bcCaja === data.bcRollo) warnings.push('El código de caja y el de rollo no pueden ser iguales.');

  const sectionTitle = 'text-xs font-semibold uppercase tracking-wider text-slate-400';

  return (
    <div className="flex flex-col gap-6">
      <form
        className="grid gap-x-8 gap-y-5 rounded-lg border border-slate-800 bg-slate-900/60 p-4 md:grid-cols-2 xl:grid-cols-4"
        onSubmit={(e) => e.preventDefault()}
        autoComplete="off"
      >
        <section className="flex flex-col gap-3">
          <h3 className={sectionTitle}>Producto</h3>
          <ProductPicker selected={producto} onSelect={elegirProducto} />
          <div className="grid grid-cols-2 gap-3">
            <Field id="etq-codigo" label="Código" value={form.codigo} onChange={set('codigo')} />
            <Field id="etq-lote" label="Lote" value={form.lote} onChange={set('lote')} inputMode="numeric" />
            <Field id="etq-desc" label="Descripción" value={form.descripcion} onChange={set('descripcion')} className="col-span-2" />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className={sectionTitle}>Características</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field id="etq-color" label="Color" value={form.color} onChange={set('color')} />
            <Field id="etq-ancho" label="Ancho" value={form.ancho} onChange={set('ancho')} />
            <Field id="etq-comp" label="Composición" value={form.composicion} onChange={set('composicion')} className="col-span-2" />
            <Field id="etq-origen" label="Origen" value={form.origen} onChange={set('origen')} />
            <Field id="etq-fecha" label="Fecha" value={form.fecha} onChange={set('fecha')} />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className={sectionTitle}>Rollo y caja master</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field id="etq-mrollo" label="Metros por rollo" value={form.mRollo} onChange={set('mRollo')} inputMode="decimal" />
            <Field id="etq-kgrollo" label="Kg por rollo" value={form.kgRollo} onChange={set('kgRollo')} inputMode="decimal" />
            <Field id="etq-rollos" label="Rollos por caja" value={form.rollosCaja} onChange={set('rollosCaja')} inputMode="numeric" />
            <Field id="etq-kgcaja" label="Peso bruto caja (kg)" value={form.kgCaja} onChange={set('kgCaja')} inputMode="decimal" />
            <Field id="etq-mcaja" label="Metros por caja" value={`${mCaja.toLocaleString('es-AR')} m`} readOnly />
            <Field id="etq-medidas" label="Medidas caja" value={form.medidasCaja} onChange={set('medidasCaja')} />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className={sectionTitle}>Código de barras (Odoo)</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field id="etq-bccaja" label="Empaquetado caja" value={form.bcCaja} onChange={set('bcCaja')} list="etq-pk-list" />
            <Field id="etq-bcrollo" label="Empaquetado rollo" value={form.bcRollo} onChange={set('bcRollo')} list="etq-pk-list" />
          </div>
          <datalist id="etq-pk-list">
            {(producto?.packagings ?? [])
              .filter((x) => x.barcode)
              .map((x) => (
                <option key={x.id} value={x.barcode ?? ''}>{`${x.name} · ${x.qty} ${producto?.uom ?? ''}`}</option>
              ))}
          </datalist>
          {[
            { k: 'caja', label: 'Caja', check: checkCaja },
            { k: 'rollo', label: 'Rollo', check: checkRollo },
          ].map(({ k, label, check }) =>
            check ? (
              <p key={k} className={`text-xs ${check.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                {check.ok ? '✓' : '⚠'} {label}: {check.msg}
              </p>
            ) : null,
          )}
          {!producto && (
            <p className="text-xs text-slate-500">
              Elegí un producto para verificar que cada código coincida con un empaquetado de {mCaja} m (caja) o {data.mRollo} m (rollo).
            </p>
          )}
          {sinEmpaquetados && (
            <p className="text-xs text-amber-400">
              Este producto no tiene empaquetados en Odoo. Creá "Caja master" ({mCaja}) y "Rollo" ({data.mRollo}) en Inventario → Productos → Inventario → Empaquetado, con estos mismos códigos, y volvé a elegir el producto.
            </p>
          )}
          {warnings.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-amber-400">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </section>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => imprimirEtiquetas(data, { caja: true, rollo: true })}
          className="rounded bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500"
        >
          Imprimir las 2 etiquetas
        </button>
        <button
          type="button"
          onClick={() => imprimirEtiquetas(data, { caja: true, rollo: false })}
          className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Solo caja
        </button>
        <button
          type="button"
          onClick={() => imprimirEtiquetas(data, { caja: false, rollo: true })}
          className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Solo rollo
        </button>
        <span className="text-xs text-slate-500">
          En el diálogo elegí "Guardar como PDF", márgenes Ninguno, escala 100 %. Los datos quedan guardados en este navegador.
        </span>
      </div>

      <div className="flex flex-wrap gap-6">
        <LabelPreview html={cajaHtml} title="Etiqueta caja master" />
        <LabelPreview html={rolloHtml} title="Etiqueta rollo" />
      </div>
    </div>
  );
}

interface Props {
  dehydratedState?: DehydratedState;
}

export default function EtiquetasApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <EtiquetasInner />
    </QueryProvider>
  );
}

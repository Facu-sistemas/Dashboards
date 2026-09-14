import { useState } from 'react';
import type { PresupuestoDinamicoInputs, BusinessUnit } from './types';

interface Props {
  year: number;
  months: string[];
  inputs: PresupuestoDinamicoInputs;
  onSaved: () => void;
}

const UNIT_LABELS: Record<BusinessUnit, string> = { colchones: 'Colchones', living: 'Living' };

const numberFmt = new Intl.NumberFormat('es-AR');

async function postInput(body: unknown): Promise<string | null> {
  try {
    const res = await fetch('/api/presupuesto-dinamico-inputs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return data.error ?? 'No se pudo guardar';
    return null;
  } catch {
    return 'Error de red al guardar';
  }
}

/**
 * Consenso mensual de unidades (Colchones/Living) y TC futuro asumido —
 * inputs de negocio que no viven en Odoo (sección 6 del doc), editables
 * acá y guardados en Supabase vía /api/presupuesto-dinamico-inputs.
 */
export default function ConsensoInputsForm({ year, months, inputs, onSaved }: Props) {
  const [mesConsenso, setMesConsenso] = useState(months[0] ?? `${year}-01`);
  const [unidadNegocio, setUnidadNegocio] = useState<BusinessUnit>('colchones');
  const [unidades, setUnidades] = useState('');
  const [savingConsenso, setSavingConsenso] = useState(false);
  const [errorConsenso, setErrorConsenso] = useState<string | null>(null);

  const [mesTc, setMesTc] = useState(months[0] ?? `${year}-01`);
  const [tc, setTc] = useState('');
  const [savingTc, setSavingTc] = useState(false);
  const [errorTc, setErrorTc] = useState<string | null>(null);

  async function guardarConsenso() {
    const value = Number(unidades);
    if (!Number.isFinite(value) || value < 0) {
      setErrorConsenso('Ingresá un número de unidades válido');
      return;
    }
    setSavingConsenso(true);
    setErrorConsenso(null);
    const error = await postInput({ type: 'consenso', mes: mesConsenso, unidadNegocio, unidades: value });
    setSavingConsenso(false);
    if (error) setErrorConsenso(error);
    else {
      setUnidades('');
      onSaved();
    }
  }

  async function guardarTc() {
    const value = Number(tc);
    if (!Number.isFinite(value) || value <= 0) {
      setErrorTc('Ingresá un tipo de cambio válido');
      return;
    }
    setSavingTc(true);
    setErrorTc(null);
    const error = await postInput({ type: 'tc', mes: mesTc, tc: value });
    setSavingTc(false);
    if (error) setErrorTc(error);
    else {
      setTc('');
      onSaved();
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h4 className="text-sm font-medium text-slate-300">Consenso de unidades</h4>
        <div className="flex flex-wrap items-end gap-2">
          <select value={mesConsenso} onChange={(e) => setMesConsenso(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100">
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select value={unidadNegocio} onChange={(e) => setUnidadNegocio(e.target.value as BusinessUnit)} className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100">
            <option value="colchones">Colchones</option>
            <option value="living">Living</option>
          </select>
          <input
            type="number"
            min="0"
            value={unidades}
            onChange={(e) => setUnidades(e.target.value)}
            placeholder="Unidades"
            className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
          <button
            type="button"
            onClick={guardarConsenso}
            disabled={savingConsenso}
            className="rounded bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
        {errorConsenso && <p className="text-xs text-red-400">{errorConsenso}</p>}

        <ul className="mt-1 flex flex-col gap-1 text-xs text-slate-400">
          {inputs.consenso.length === 0 && <li className="text-slate-600">Sin consenso cargado para {year}.</li>}
          {inputs.consenso.map((c) => (
            <li key={`${c.mes}-${c.unidadNegocio}`}>
              {c.mes} · {UNIT_LABELS[c.unidadNegocio]}: {numberFmt.format(c.unidades)} u.
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h4 className="text-sm font-medium text-slate-300">TC asumido (meses futuros)</h4>
        <div className="flex flex-wrap items-end gap-2">
          <select value={mesTc} onChange={(e) => setMesTc(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100">
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            step="0.01"
            value={tc}
            onChange={(e) => setTc(e.target.value)}
            placeholder="$ por USD"
            className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
          <button
            type="button"
            onClick={guardarTc}
            disabled={savingTc}
            className="rounded bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
        {errorTc && <p className="text-xs text-red-400">{errorTc}</p>}

        <ul className="mt-1 flex flex-col gap-1 text-xs text-slate-400">
          {inputs.tc.length === 0 && <li className="text-slate-600">Sin TC asumido cargado para {year}.</li>}
          {inputs.tc.map((t) => (
            <li key={t.mes}>{t.mes}: ${numberFmt.format(t.tc)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

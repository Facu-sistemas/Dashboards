import { MESES } from '@/lib/rentabilidad/format';
import type { FiltrosRentabilidad } from '@/lib/rentabilidad/types';

interface Props {
  value: FiltrosRentabilidad;
  onChange: (f: FiltrosRentabilidad) => void;
  anios: number[];
  /** Si viene, muestra el filtro Categoría. */
  categorias?: string[];
  /** Si viene, muestra el filtro Cliente. */
  clientes?: { id: number; nombre: string }[];
  /** Opciones del filtro Empresa (compañías de Odoo). */
  empresas?: { id: number; nombre: string }[];
}

const SELECT = 'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none';

export default function RentabilidadFiltros({ value, onChange, anios, categorias, clientes, empresas }: Props) {
  const set = (parcial: Partial<FiltrosRentabilidad>) => onChange({ ...value, ...parcial });
  const num = (v: string): number | null => (v === '' ? null : Number(v));

  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Año
        <select className={`${SELECT} min-w-[6rem]`} value={value.anio} onChange={(e) => set({ anio: Number(e.target.value) })}>
          {(anios.includes(value.anio) ? anios : [value.anio, ...anios]).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Empresa
        <select className={`${SELECT} min-w-[11rem]`} value={value.empresaId ?? ''} onChange={(e) => set({ empresaId: num(e.target.value) })}>
          <option value="">Ambas</option>
          {(empresas ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Costos
        <select className={`${SELECT} min-w-[14rem]`} value={value.costos} onChange={(e) => set({ costos: e.target.value === 'odoo' ? 'odoo' : 'planilla' })}>
          <option value="planilla">Planilla (coincide con el Excel)</option>
          <option value="odoo">Odoo (dinámico)</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Mes desde
        <select
          className={`${SELECT} min-w-[9rem]`}
          value={value.mesIni ?? ''}
          onChange={(e) => {
            const mesIni = num(e.target.value);
            set({ mesIni, mesFin: mesIni !== null && value.mesFin !== null && value.mesFin < mesIni ? mesIni : value.mesFin });
          }}
        >
          <option value="">Enero</option>
          {MESES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Mes hasta
        <select
          className={`${SELECT} min-w-[9rem]`}
          value={value.mesFin ?? ''}
          onChange={(e) => {
            const mesFin = num(e.target.value);
            set({ mesFin, mesIni: mesFin !== null && value.mesIni !== null && value.mesIni > mesFin ? mesFin : value.mesIni });
          }}
        >
          <option value="">Diciembre</option>
          {MESES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>

      {categorias && (
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Categoría
          <select className={`${SELECT} min-w-[11rem]`} value={value.categoria ?? ''} onChange={(e) => set({ categoria: e.target.value || null })}>
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}

      {clientes && (
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Cliente
          <select className={`${SELECT} w-64`} value={value.clienteId ?? ''} onChange={(e) => set({ clienteId: num(e.target.value) })}>
            <option value="">Todos los clientes</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

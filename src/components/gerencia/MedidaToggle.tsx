export type Medida = 'ue' | 'cant';

const OPTIONS: { value: Medida; label: string }[] = [
  { value: 'ue', label: 'Unidad equivalente' },
  { value: 'cant', label: 'Cantidad' },
];

interface Props {
  medida: Medida;
  onChange: (m: Medida) => void;
}

/**
 * La planilla de objetivos carga sillones en UE y colchones en unidades —
 * en la medida que no coincide, las tarjetas muestran solo el real (sin
 * objetivo inventado). El total equivalente no depende del toggle: usa
 * siempre el criterio de la planilla para poder compararse contra su objetivo.
 */
export default function MedidaToggle({ medida, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Medida</span>
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              medida === o.value
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="text-[10px] text-slate-500">
        Objetivo cargado en UE para sillones y en unidades para colchones · el total equivalente usa siempre ese criterio.
      </span>
    </div>
  );
}

/** Etiqueta de la tarjeta/gráfico según la medida elegida. */
export function etiquetaMedida(producto: string, medida: Medida): string {
  return `${producto} · ${medida === 'ue' ? 'UE' : 'unidades'}`;
}

export interface RealUeYCantidad {
  sillonesUE: number[];
  sillonesCant: number[];
  colchonesUE: number[];
  colchonesCant: number[];
}

export interface SerieMedida {
  label: string;
  real: number[];
  /** Solo presente cuando la medida elegida es la misma en la que la planilla carga el objetivo. */
  objetivo?: number[];
  objetivoAnual?: number;
  nota?: string;
}

/**
 * Serie de sillones y colchones en la medida elegida. Sillones tiene objetivo
 * solo en UE y colchones solo en unidades (así los carga la planilla); en la
 * otra medida se devuelve únicamente el real.
 */
export function seriesPorMedida(
  medida: Medida,
  real: RealUeYCantidad,
  objetivo: { sillones: number[]; colchones: number[] },
  objetivoAnual: { sillones: number; colchones: number },
): { sillones: SerieMedida; colchones: SerieMedida } {
  const sillonesNativo = medida === 'ue';
  const colchonesNativo = medida === 'cant';
  return {
    sillones: {
      label: etiquetaMedida('Sillones', medida),
      real: sillonesNativo ? real.sillonesUE : real.sillonesCant,
      objetivo: sillonesNativo ? objetivo.sillones : undefined,
      objetivoAnual: sillonesNativo ? objetivoAnual.sillones : undefined,
      nota: sillonesNativo ? undefined : 'El objetivo de sillones está cargado en UE.',
    },
    colchones: {
      label: etiquetaMedida('Colchones', medida),
      real: colchonesNativo ? real.colchonesCant : real.colchonesUE,
      objetivo: colchonesNativo ? objetivo.colchones : undefined,
      objetivoAnual: colchonesNativo ? objetivoAnual.colchones : undefined,
      nota: colchonesNativo ? undefined : 'El objetivo de colchones está cargado en unidades.',
    },
  };
}

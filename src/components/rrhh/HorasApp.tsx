import { useState } from 'react';
import NovedadesApp from './NovedadesApp';
import QuincenaApp from './QuincenaApp';

interface Props {
  /** Fecha de hoy (ISO) calculada en el servidor, para no depender de la zona horaria del navegador. */
  hoy: string;
  /** Dev y cuenta rrhh: pueden clasificar novedades y cargarlas en Odoo. */
  puedeCargar?: boolean;
}

type Vista = 'dia' | 'empleado';

const VISTAS: { id: Vista; label: string; ayuda: string }[] = [
  { id: 'dia', label: 'Por día (novedades)', ayuda: 'Lo que se salió de la jornada, día por día, para decidir qué fue.' },
  { id: 'empleado', label: 'Por empleado (quincena)', ayuda: 'Totales de horas, licencias y banco de horas de cada empleado, para controlar el cierre.' },
];

/**
 * Pestaña Horas: dos vistas del mismo período. El período que elige el usuario en una se hereda en la otra; mientras no
 * lo toque, cada vista arranca en el suyo (novedades: desde la quincena anterior hasta hoy; empleado: la última cerrada).
 */
export default function HorasApp({ hoy, puedeCargar }: Props) {
  const [vista, setVista] = useState<Vista>('dia');
  const [rango, setRango] = useState<{ desde: string; hasta: string } | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="Vista de horas" className="inline-flex w-fit rounded-lg border border-slate-800 bg-slate-900 p-1 text-sm">
        {VISTAS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={vista === v.id}
            title={v.ayuda}
            onClick={() => setVista(v.id)}
            className={`rounded-md px-3 py-1.5 ${vista === v.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {vista === 'dia' ? (
        <NovedadesApp hoy={hoy} rangoInicial={rango} onRango={setRango} puedeCargar={puedeCargar} />
      ) : (
        <QuincenaApp hoy={hoy} rangoInicial={rango} onRango={setRango} />
      )}
    </div>
  );
}

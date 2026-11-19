import { useEffect, useState } from 'react';
import HistorialApp from './HistorialApp';
import NovedadesApp from './NovedadesApp';
import QuincenaApp from './QuincenaApp';

interface Props {
  /** Fecha de hoy (ISO) calculada en el servidor, para no depender de la zona horaria del navegador. */
  hoy: string;
  /** Dev y cuenta rrhh: pueden clasificar novedades y cargarlas en Odoo. */
  puedeCargar?: boolean;
}

type Vista = 'dia' | 'empleado' | 'historial';

const VISTAS: { id: Vista; label: string; ayuda: string }[] = [
  { id: 'dia', label: 'Por día (novedades)', ayuda: 'Lo que se salió de la jornada, día por día, para decidir qué fue.' },
  { id: 'empleado', label: 'Por empleado (quincena)', ayuda: 'Totales de horas, licencias y banco de horas de cada empleado, para controlar el cierre.' },
  { id: 'historial', label: 'Historial de fichadas', ayuda: 'Todos los empleados mes a mes, filtrables por anormalidad, y el calendario de fichadas de cada uno.' },
];

/**
 * Pestaña Horas: tres vistas. El período que elige el usuario en novedades/quincena se hereda entre ellas; mientras no lo
 * toque, cada una arranca en el suyo (novedades: desde la quincena anterior hasta hoy; empleado: la última cerrada).
 */
export default function HorasApp({ hoy, puedeCargar }: Props) {
  const [vista, setVista] = useState<Vista>('dia');
  const [rango, setRango] = useState<{ desde: string; hasta: string } | null>(null);
  // Empleado a abrir en el historial cuando se llega desde la bandeja (clic en un nombre). La clave fuerza a re-montar la vista.
  const [historialDe, setHistorialDe] = useState<{ id: number | null; n: number }>({ id: null, n: 0 });

  const verHistorial = (id: number) => {
    setHistorialDe((h) => ({ id, n: h.n + 1 }));
    setVista('historial');
  };

  // Llegada desde la tarjeta del Resumen (/rrhh/horas?historial=ID): abre directo el calendario de esa persona.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const id = Number(url.searchParams.get('historial'));
      if (Number.isInteger(id) && id > 0) {
        verHistorial(id);
        url.searchParams.delete('historial');
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
    } catch {
      // sin acceso a la URL: queda en la vista por defecto
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="Vista de horas" className="inline-flex w-fit flex-wrap rounded-lg border border-slate-800 bg-slate-900 p-1 text-sm">
        {VISTAS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={vista === v.id}
            title={v.ayuda}
            onClick={() => {
              if (v.id === 'historial') setHistorialDe((h) => ({ id: null, n: h.n + 1 }));
              setVista(v.id);
            }}
            className={`rounded-md px-3 py-1.5 ${vista === v.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {vista === 'dia' ? (
        <NovedadesApp hoy={hoy} rangoInicial={rango} onRango={setRango} puedeCargar={puedeCargar} onVerHistorial={verHistorial} />
      ) : vista === 'empleado' ? (
        <QuincenaApp hoy={hoy} rangoInicial={rango} onRango={setRango} />
      ) : (
        <HistorialApp key={historialDe.n} hoy={hoy} empleadoInicial={historialDe.id} />
      )}
    </div>
  );
}

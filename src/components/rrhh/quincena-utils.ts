export interface Quincena {
  key: string; // "2026-10-1" | "2026-10-2"
  desde: string;
  hasta: string;
  label: string;
  enCurso: boolean;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function ultimoDiaMes(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Las últimas `cantidad` quincenas (1–15 y 16–fin de mes), la más reciente primero; `hoyIso` viene del servidor para no depender de la zona horaria del navegador. */
export function ultimasQuincenas(hoyIso: string, cantidad: number): Quincena[] {
  const [y, m, d] = hoyIso.split('-').map(Number);
  let year = y!;
  let month = m!;
  let mitad: 1 | 2 = d! <= 15 ? 1 : 2;
  const result: Quincena[] = [];
  for (let i = 0; i < cantidad; i++) {
    const mm = String(month).padStart(2, '0');
    const desde = mitad === 1 ? `${year}-${mm}-01` : `${year}-${mm}-16`;
    const hasta = mitad === 1 ? `${year}-${mm}-15` : `${year}-${mm}-${String(ultimoDiaMes(year, month)).padStart(2, '0')}`;
    result.push({
      key: `${year}-${mm}-${mitad}`,
      desde,
      hasta,
      label: `${mitad === 1 ? '1ª' : '2ª'} quincena de ${MESES[month - 1]} ${year} (${desde.slice(8)}–${hasta.slice(8)})`,
      enCurso: hoyIso >= desde && hoyIso <= hasta,
    });
    if (mitad === 2) {
      mitad = 1;
    } else {
      mitad = 2;
      month -= 1;
      if (month === 0) {
        month = 12;
        year -= 1;
      }
    }
  }
  return result;
}

/** Coincidencia mínima por empleado que fijó RRHH para dar por bueno el paralelo reloj vs Odoo. */
export const META_COINCIDENCIA = 0.97;

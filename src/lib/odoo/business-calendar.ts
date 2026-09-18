import { searchRead } from './client';
import { withTtlCache } from '../cache';
import { getFronteraCompany } from './reference';
import { getArgentinaTodayIso } from './oee';
import { monthBounds, addDaysIso } from '../date';
import { OdooError } from './types';

/**
 * Días hábiles transcurridos/totales, calculados dinámicamente desde el
 * calendario laboral oficial de la compañía en Odoo ("Jornada de Frontera
 * Living S.A" — `resource.calendar` en `res.company.resource_calendar_id`),
 * en vez de leerlos de la fila cargada a mano en el tablero de objetivos
 * (gerencia-objetivos.ts). Confirmado en vivo (2026-09-18) que esa fila
 * manual puede estar desactualizada — el propio día en que se congeló el
 * tablero, decía 10 días transcurridos de septiembre cuando en realidad
 * ya habían pasado 14 según el calendario real (lunes a viernes, feriados
 * nacionales incluidos vía `global_leave_ids`).
 */

const REFERENCE_TTL_MS = 60 * 60 * 1000; // el calendario/feriados no cambian durante el proceso

interface CompanyCalendar {
  /** Días de la semana laborables, en convención JS `Date#getUTCDay()` (0=domingo..6=sábado). */
  workingDaysOfWeek: Set<number>;
  /** Feriados, como fechas ISO "YYYY-MM-DD". */
  holidays: Set<string>;
}

async function getCompanyCalendar(): Promise<CompanyCalendar> {
  return withTtlCache('ref:calendar:frontera', REFERENCE_TTL_MS, async () => {
    const { companyId } = await getFronteraCompany();

    type CompanyRow = { resource_calendar_id: [number, string] | false };
    const companyRows = await searchRead<CompanyRow>({
      model: 'res.company',
      domain: [['id', '=', companyId]],
      fields: ['resource_calendar_id'],
      limit: 1,
    });
    const calendarId = companyRows[0]?.resource_calendar_id;
    if (!calendarId) {
      throw new OdooError('La compañía Frontera Living S.A no tiene un calendario laboral (resource_calendar_id) configurado en Odoo');
    }

    type CalendarRow = { attendance_ids: number[]; global_leave_ids: number[] };
    const calendarRows = await searchRead<CalendarRow>({
      model: 'resource.calendar',
      domain: [['id', '=', calendarId[0]]],
      fields: ['attendance_ids', 'global_leave_ids'],
      limit: 1,
    });
    const calendar = calendarRows[0];
    if (!calendar) {
      throw new OdooError(`No se encontró el calendario laboral id=${calendarId[0]} en Odoo`);
    }

    type AttendanceRow = { dayofweek: string };
    const attendances = calendar.attendance_ids.length
      ? await searchRead<AttendanceRow>({
          model: 'resource.calendar.attendance',
          domain: [['id', 'in', calendar.attendance_ids]],
          fields: ['dayofweek'],
        })
      : [];
    // Odoo's dayofweek: '0'=lunes .. '6'=domingo. JS Date#getUTCDay(): 0=domingo..6=sábado.
    const workingDaysOfWeek = new Set(attendances.map((a) => (Number(a.dayofweek) + 1) % 7));

    type LeaveRow = { date_from: string };
    const leaves = calendar.global_leave_ids.length
      ? await searchRead<LeaveRow>({
          model: 'resource.calendar.leaves',
          domain: [['id', 'in', calendar.global_leave_ids]],
          fields: ['date_from'],
        })
      : [];
    // Cada feriado global cubre exactamente un día calendario de Argentina
    // (confirmado en vivo: "date_from" viene como "YYYY-MM-DD 03:00:00" UTC,
    // que es medianoche hora Argentina — el primer segmento de 10
    // caracteres ya es la fecha local correcta, sin conversión de timezone).
    const holidays = new Set(leaves.map((l) => l.date_from.slice(0, 10)));

    return { workingDaysOfWeek, holidays };
  });
}

function countBusinessDays(start: string, endExclusive: string, calendar: CompanyCalendar): number {
  let count = 0;
  for (let d = start; d < endExclusive; d = addDaysIso(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (calendar.workingDaysOfWeek.has(dow) && !calendar.holidays.has(d)) count++;
  }
  return count;
}

export interface DiasHabiles {
  /** 12 entries, Ene..Dic. Días hábiles totales de cada mes del año. */
  diasTotal: number[];
  /**
   * 12 entries, Ene..Dic. Días hábiles ya transcurridos: el total para
   * meses ya terminados, 0 para meses futuros, y el conteo real hasta hoy
   * (inclusive) para el mes en curso.
   */
  diasTranscurridos: number[];
}

/** Calcula días hábiles transcurridos/totales por mes para `year`, en vivo desde el calendario laboral de Odoo — ver el comentario de arriba del archivo. */
export async function getDiasHabiles(year: number): Promise<DiasHabiles> {
  const calendar = await getCompanyCalendar();
  const today = getArgentinaTodayIso();

  const diasTotal: number[] = [];
  const diasTranscurridos: number[] = [];

  for (let month = 1; month <= 12; month++) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const { start, endExclusive } = monthBounds(monthKey);
    const total = countBusinessDays(start, endExclusive, calendar);
    diasTotal.push(total);

    let transcurridos: number;
    if (endExclusive <= today) {
      transcurridos = total; // mes ya terminado
    } else if (start > today) {
      transcurridos = 0; // mes futuro, todavía no empezó
    } else {
      transcurridos = countBusinessDays(start, addDaysIso(today, 1), calendar); // mes en curso, hasta hoy inclusive
    }
    diasTranscurridos.push(transcurridos);
  }

  return { diasTotal, diasTranscurridos };
}

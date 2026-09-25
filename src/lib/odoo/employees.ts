import { searchReadAll } from './client';

export interface UpcomingBirthday {
  id: number;
  nombre: string;
  departamento: string | null;
  puesto: string | null;
  /** Next occurrence of the birthday, ISO date (this year or next). */
  proximaFecha: string;
  /** Original birth date as stored in Odoo, ISO. */
  fechaNacimiento: string;
  diasRestantes: number;
  edadQueCumple: number;
  esHoy: boolean;
}

interface EmployeeRow {
  [key: string]: unknown;
  id: number;
  name: string;
  birthday: string | false;
  department_id: [number, string] | false;
  job_title: string | false;
}

/** Days from `today` (UTC midnight) to the next occurrence of `monthDay` ("MM-DD"), 0 if it's today. */
function daysUntilNextOccurrence(today: Date, month: number, day: number): { date: Date; days: number } {
  const year = today.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate < today) {
    candidate = new Date(Date.UTC(year + 1, month - 1, day));
  }
  const days = Math.round((candidate.getTime() - today.getTime()) / 86_400_000);
  return { date: candidate, days };
}

/**
 * Every active employee with a `birthday` set on `hr.employee`, sorted by how
 * soon their next birthday falls (today first, then ascending). Odoo's
 * `birthday` field only stores month/day/year of birth — there's no
 * recurrence concept in the model, so "next occurrence" is computed here by
 * comparing month/day against today and rolling over to next year when
 * this year's date has already passed.
 */
export async function getUpcomingBirthdays(): Promise<UpcomingBirthday[]> {
  const rows = await searchReadAll<EmployeeRow>({
    model: 'hr.employee',
    domain: [['birthday', '!=', false]],
    fields: ['name', 'birthday', 'department_id', 'job_title'],
    order: 'name asc',
  });

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const result: UpcomingBirthday[] = rows
    .filter((r): r is EmployeeRow & { birthday: string } => r.birthday !== false)
    .map((r) => {
      const [birthYear, month, day] = r.birthday.split('-').map(Number);
      const { date: proxima, days } = daysUntilNextOccurrence(today, month!, day!);
      return {
        id: r.id,
        nombre: r.name,
        // Odoo's display name is the full parent chain ("Gerencia / Producción /
        // Living") — only the last segment is meaningful to show in a table row.
        departamento: r.department_id ? r.department_id[1].split('/').pop()!.trim() : null,
        puesto: r.job_title || null,
        proximaFecha: proxima.toISOString().slice(0, 10),
        fechaNacimiento: r.birthday,
        diasRestantes: days,
        edadQueCumple: proxima.getUTCFullYear() - birthYear!,
        esHoy: days === 0,
      };
    });

  return result.sort((a, b) => a.diasRestantes - b.diasRestantes || a.nombre.localeCompare(b.nombre));
}

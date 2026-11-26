import { describe, expect, it } from 'vitest';
import { extraRedondeadaHs, horasDeLicenciaEnDia, horasExtraCrudasHs, JORNADA_FICHADA_HS, minutosTxt, type LeaveRow } from './rrhh-novedades';
import { HORAS_DIA } from './rrhh-quincena';

describe('extraRedondeadaHs (horas extra de un día, al cuarto de hora, desde 30 min)', () => {
  it('no marca nada si trabajó la jornada justa o menos', () => {
    expect(extraRedondeadaHs(JORNADA_FICHADA_HS)).toBe(0);
    expect(extraRedondeadaHs(JORNADA_FICHADA_HS - 1)).toBe(0);
    expect(extraRedondeadaHs(0)).toBe(0);
  });

  it('no marca por debajo de 30 min de más (22 min redondea a 15)', () => {
    expect(extraRedondeadaHs(JORNADA_FICHADA_HS + 0.37)).toBe(0);
    expect(extraRedondeadaHs(JORNADA_FICHADA_HS + 0.1)).toBe(0);
  });

  it('desde 29 min de más cuenta como 30 (lo pidió RRHH)', () => {
    expect(extraRedondeadaHs(JORNADA_FICHADA_HS + 29 / 60)).toBe(0.5);
    expect(extraRedondeadaHs(JORNADA_FICHADA_HS + 0.5)).toBe(0.5);
  });

  it('redondea al cuarto de hora más cercano', () => {
    expect(extraRedondeadaHs(JORNADA_FICHADA_HS + 1)).toBe(1);
    expect(extraRedondeadaHs(JORNADA_FICHADA_HS + 1.1)).toBe(1);
    expect(extraRedondeadaHs(JORNADA_FICHADA_HS + 1.13)).toBe(1.25);
    expect(extraRedondeadaHs(JORNADA_FICHADA_HS + 2)).toBe(2);
  });
});

/** Horas fichadas entre dos "HH:MM" (como las calcula Odoo y las redondea la bandeja, a 2 decimales). */
const fichado = (desde: string, hasta: string) => {
  const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.round(((min(hasta) - min(desde)) / 60) * 100) / 100;
};

describe('horasExtraCrudasHs (se cuentan desde el cierre del turno, 14:18)', () => {
  it('llegar antes no suma: Usandivares 05:37–15:20 → 1 h 2 min, se marca 1 h', () => {
    const cruda = horasExtraCrudasHs(fichado('05:37', '15:20'), '15:20');
    expect(minutosTxt(cruda)).toBe('1 h 2 min');
    expect(extraRedondeadaHs(fichado('05:37', '15:20'), '15:20')).toBe(1);
  });

  it('Luna 05:41–16:29 y Dotta 05:38–16:30 → 2 h 11/12 min, se marcan 2,25 h', () => {
    expect(minutosTxt(horasExtraCrudasHs(fichado('05:41', '16:29'), '16:29'))).toBe('2 h 11 min');
    expect(extraRedondeadaHs(fichado('05:41', '16:29'), '16:29')).toBe(2.25);
    expect(minutosTxt(horasExtraCrudasHs(fichado('05:38', '16:30'), '16:30'))).toBe('2 h 12 min');
    expect(extraRedondeadaHs(fichado('05:38', '16:30'), '16:30')).toBe(2.25);
    expect(extraRedondeadaHs(fichado('05:50', '16:29'), '16:29')).toBe(2.25); // Luque
  });

  it('quien llegó tarde no cobra extra por quedarse a compensar: 07:00–15:20 → 0', () => {
    expect(horasExtraCrudasHs(fichado('07:00', '15:20'), '15:20')).toBeLessThan(0.05);
    expect(extraRedondeadaHs(fichado('07:00', '15:20'), '15:20')).toBe(0);
  });

  it('nunca es negativo', () => {
    expect(horasExtraCrudasHs(fichado('06:00', '13:00'), '13:00')).toBe(0);
    expect(horasExtraCrudasHs(fichado('05:00', '14:00'), '14:00')).toBe(0);
  });

  it('acepta la salida como datetime UTC de Odoo (Argentina es UTC-3)', () => {
    expect(minutosTxt(horasExtraCrudasHs(fichado('05:37', '15:20'), '2026-11-20 18:20:00'))).toBe('1 h 2 min');
  });

  it('con varias fichadas cuenta desde la última salida cerrada', () => {
    // 05:40–10:00 y 10:30–16:00: fichó 9 h 50 min (1 h 32 min sobre la jornada), pero después de las 14:18 solo 1 h 42 min:
    // manda lo fichado de más, porque la media hora que salió no se cuenta.
    const fichadoDia = fichado('05:40', '10:00') + fichado('10:30', '16:00');
    expect(minutosTxt(horasExtraCrudasHs(fichadoDia, '16:00'))).toBe('1 h 32 min');
    expect(extraRedondeadaHs(fichadoDia, '16:00')).toBe(1.5);
    // 06:00–09:00 y 09:15–15:30: fichó 9 h 15 min (sobre la jornada: 57 min), después de las 14:18: 1 h 12 min → 57 min.
    const otroDia = fichado('06:00', '09:00') + fichado('09:15', '15:30');
    expect(minutosTxt(horasExtraCrudasHs(otroDia, '15:30'))).toBe('57 min');
    expect(extraRedondeadaHs(otroDia, '15:30')).toBe(1);
  });

  it('sin salida conocida solo cuenta lo fichado de más', () => {
    expect(horasExtraCrudasHs(JORNADA_FICHADA_HS + 1, null)).toBeCloseTo(1);
  });
});

describe('minutosTxt', () => {
  it('menos de una hora va en minutos', () => {
    expect(minutosTxt(0.5)).toBe('30 min');
    expect(minutosTxt(0.25)).toBe('15 min');
  });

  it('una hora o más va en horas y minutos', () => {
    expect(minutosTxt(1)).toBe('1 h');
    expect(minutosTxt(65 / 60)).toBe('1 h 5 min');
    expect(minutosTxt(7 + 2 / 60)).toBe('7 h 2 min');
  });
});

describe('horasDeLicenciaEnDia', () => {
  const licencia = (extra: Partial<LeaveRow>): LeaveRow => ({
    id: 1,
    employee_id: [10, 'Empleado de prueba'],
    holiday_status_id: [6, 'Banco de horas'],
    request_date_from: '2026-11-10',
    request_date_to: '2026-11-10',
    number_of_hours_display: 0,
    number_of_days: 1,
    request_unit_hours: false,
    state: 'validate',
    ...extra,
  });

  it('un día fuera del rango de la licencia no tiene horas', () => {
    expect(horasDeLicenciaEnDia(licencia({}), '2026-11-09')).toBe(0);
    expect(horasDeLicenciaEnDia(licencia({}), '2026-11-11')).toBe(0);
  });

  it('una licencia por horas suma las horas que dice Odoo', () => {
    expect(horasDeLicenciaEnDia(licencia({ request_unit_hours: true, number_of_hours_display: 3.85 }), '2026-11-10')).toBe(3.85);
  });

  it('un día completo cubre la jornada entera', () => {
    expect(horasDeLicenciaEnDia(licencia({ number_of_days: 1 }), '2026-11-10')).toBe(HORAS_DIA);
  });

  it('medio día cubre la mitad de la jornada y nunca más que la jornada', () => {
    expect(horasDeLicenciaEnDia(licencia({ number_of_days: 0.5 }), '2026-11-10')).toBe(HORAS_DIA / 2);
    expect(horasDeLicenciaEnDia(licencia({ number_of_days: 3 }), '2026-11-10')).toBe(HORAS_DIA);
  });

  it('una licencia de varios días cubre la jornada completa cada día', () => {
    const vacaciones = licencia({ request_date_from: '2026-11-10', request_date_to: '2026-11-13', number_of_days: 4 });
    expect(horasDeLicenciaEnDia(vacaciones, '2026-11-10')).toBe(HORAS_DIA);
    expect(horasDeLicenciaEnDia(vacaciones, '2026-11-12')).toBe(HORAS_DIA);
    expect(horasDeLicenciaEnDia(vacaciones, '2026-11-13')).toBe(HORAS_DIA);
    expect(horasDeLicenciaEnDia(vacaciones, '2026-11-14')).toBe(0);
  });
});

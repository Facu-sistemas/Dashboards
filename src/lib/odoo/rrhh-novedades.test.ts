import { describe, expect, it } from 'vitest';
import { extraRedondeadaHs, horasDeLicenciaEnDia, JORNADA_FICHADA_HS, minutosTxt, type LeaveRow } from './rrhh-novedades';
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

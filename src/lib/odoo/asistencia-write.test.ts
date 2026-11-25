import { describe, expect, it } from 'vitest';
import { diaLocalUtc, esPrimeraFichadaTardia } from './asistencia-write';

// Odoo guarda las fichadas en UTC y Argentina es UTC-3: las 10:30 argentinas son las 13:30 UTC.
describe('esPrimeraFichadaTardia (corte de las 10:30)', () => {
  it('la entrada de las 6:00 (09:00 UTC) no es tardía', () => {
    expect(esPrimeraFichadaTardia('2026-11-25 09:00:00')).toBe(false);
  });

  it('un minuto antes del corte no es tardía', () => {
    expect(esPrimeraFichadaTardia('2026-11-25 13:29:59')).toBe(false);
  });

  it('a las 10:30 en punto ya es tardía', () => {
    expect(esPrimeraFichadaTardia('2026-11-25 13:30:00')).toBe(true);
  });

  it('la salida de las 14:18 (17:18 UTC) es tardía', () => {
    expect(esPrimeraFichadaTardia('2026-11-25 17:18:00')).toBe(true);
  });

  it('la medianoche de Argentina (03:00 UTC) arranca el día: no es tardía', () => {
    expect(esPrimeraFichadaTardia('2026-11-25 03:00:00')).toBe(false);
  });
});

describe('diaLocalUtc (ventana UTC del día argentino de una fichada)', () => {
  it('una fichada de la mañana argentina cae en el día de esa fecha', () => {
    expect(diaLocalUtc('2026-11-25 09:00:00')).toEqual({ inicio: '2026-11-25 03:00:00', fin: '2026-11-26 03:00:00' });
  });

  it('una fichada antes de las 03:00 UTC es del día anterior en Argentina', () => {
    expect(diaLocalUtc('2026-11-25 02:00:00')).toEqual({ inicio: '2026-11-24 03:00:00', fin: '2026-11-25 03:00:00' });
  });

  it('a las 03:00 UTC en punto arranca el día nuevo', () => {
    expect(diaLocalUtc('2026-11-25 03:00:00')).toEqual({ inicio: '2026-11-25 03:00:00', fin: '2026-11-26 03:00:00' });
  });

  it('cruza fin de mes y de año', () => {
    expect(diaLocalUtc('2026-12-31 15:00:00')).toEqual({ inicio: '2026-12-31 03:00:00', fin: '2027-01-01 03:00:00' });
  });
});

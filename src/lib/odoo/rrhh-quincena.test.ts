import { describe, expect, it } from 'vitest';
import { esFinDeSemana, fechaArgentina } from './rrhh-quincena';

describe('esFinDeSemana', () => {
  it('sábado y domingo sí; lunes a viernes no', () => {
    expect(esFinDeSemana('2026-11-21')).toBe(true); // sábado
    expect(esFinDeSemana('2026-11-22')).toBe(true); // domingo
    expect(esFinDeSemana('2026-11-23')).toBe(false); // lunes
    expect(esFinDeSemana('2026-11-20')).toBe(false); // viernes
  });
});

describe('fechaArgentina (Odoo guarda en UTC; Argentina es UTC-3)', () => {
  it('antes de las 03:00 UTC todavía es el día anterior en Argentina', () => {
    expect(fechaArgentina('2026-11-25 02:59:59')).toBe('2026-11-24');
  });

  it('desde las 03:00 UTC ya es el día siguiente', () => {
    expect(fechaArgentina('2026-11-25 03:00:00')).toBe('2026-11-25');
  });

  it('una entrada a las 6:00 argentinas (09:00 UTC) es del mismo día', () => {
    expect(fechaArgentina('2026-11-25 09:00:00')).toBe('2026-11-25');
  });

  it('la salida a las 14:18 argentinas (17:18 UTC) es del mismo día', () => {
    expect(fechaArgentina('2026-11-25 17:18:00')).toBe('2026-11-25');
  });
});

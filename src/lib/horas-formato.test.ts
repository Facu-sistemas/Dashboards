import { describe, expect, it } from 'vitest';
import { horasMinTxt } from './horas-formato';

describe('horasMinTxt', () => {
  it('pasa horas decimales a horas y minutos', () => {
    expect(horasMinTxt(0.73)).toBe('44 min');
    expect(horasMinTxt(14.1)).toBe('14 h 6 min');
    expect(horasMinTxt(1)).toBe('1 h');
    expect(horasMinTxt(1 + 5 / 60)).toBe('1 h 5 min');
    expect(horasMinTxt(0)).toBe('0 min');
  });

  it('muestra los negativos con signo', () => {
    expect(horasMinTxt(-2.5)).toBe('\u22122 h 30 min');
    expect(horasMinTxt(-0.25)).toBe('\u221215 min');
  });

  it('redondea al minuto sin dar "60 min"', () => {
    expect(horasMinTxt(0.999)).toBe('1 h');
    expect(horasMinTxt(1.9999)).toBe('2 h');
    expect(horasMinTxt(59.6 / 60)).toBe('1 h');
    expect(horasMinTxt(-0.9999)).toBe('\u22121 h');
  });

  it('un negativo que redondea a cero no lleva signo', () => {
    expect(horasMinTxt(-0.001)).toBe('0 min');
  });
});

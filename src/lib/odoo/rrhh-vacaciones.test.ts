import { describe, expect, it } from 'vitest';
import { diasHabilesEntre, saldoVigente } from './rrhh-vacaciones';

type Asignaciones = Parameters<typeof saldoVigente>[0];
type Licencias = Parameters<typeof saldoVigente>[1];

const asignacion = (dias: number, desde: string | null, hasta: string | null): Asignaciones[number] => ({
  employee_id: [1, 'Empleado de prueba'],
  number_of_days: dias,
  date_from: desde ?? false,
  date_to: hasta ?? false,
  name: 'Vacaciones',
});

const licencia = (dias: number, desde: string, estado = 'validate'): Licencias[number] => ({
  employee_id: [1, 'Empleado de prueba'],
  number_of_days: dias,
  date_from: `${desde} 09:00:00`,
  date_to: `${desde} 17:18:00`,
  state: estado,
});

const HOY = '2026-11-25';

describe('saldoVigente (saldo de vacaciones como lo calcula Odoo)', () => {
  it('caso Braian: dos asignaciones de 5 vencidas, una de 10 vigente y 5 días pedidos sin aprobar = saldo 5', () => {
    const asignaciones = [asignacion(5, '2025-08-01', '2025-12-31'), asignacion(5, '2026-02-09', '2026-02-13'), asignacion(10, '2026-10-01', null)];
    const licencias = [licencia(5, '2027-01-11', 'confirm')];
    expect(saldoVigente(asignaciones, licencias, HOY)).toEqual({ asignado: 10, saldo: 5 });
  });

  it('las asignaciones vencidas no suman', () => {
    expect(saldoVigente([asignacion(10, '2025-01-01', '2025-12-31')], [], HOY)).toEqual({ asignado: 0, saldo: 0 });
  });

  it('las asignaciones que todavía no empezaron no suman', () => {
    expect(saldoVigente([asignacion(10, '2027-01-01', null)], [], HOY)).toEqual({ asignado: 0, saldo: 0 });
  });

  it('una asignación sin fecha de fin está vigente', () => {
    expect(saldoVigente([asignacion(14, '2026-01-01', null)], [], HOY)).toEqual({ asignado: 14, saldo: 14 });
  });

  it('sin asignaciones ni licencias el saldo es 0', () => {
    expect(saldoVigente([], [], HOY)).toEqual({ asignado: 0, saldo: 0 });
  });

  it('una licencia aprobada descuenta del saldo vigente', () => {
    expect(saldoVigente([asignacion(10, '2026-01-01', null)], [licencia(3, '2026-11-10')], HOY)).toEqual({ asignado: 10, saldo: 7 });
  });

  it('una licencia que ninguna asignación cubre deja el saldo vigente en negativo cuando se pasa', () => {
    // Pidió 8 días en una fecha que ninguna asignación cubre: se resta del saldo vigente (5), queda en -3.
    const saldo = saldoVigente([asignacion(5, '2026-10-01', null)], [licencia(8, '2026-03-02')], HOY);
    expect(saldo.saldo).toBe(-3);
  });

  it('la licencia descuenta primero de la asignación que vence antes', () => {
    // A vence el 31/12 (3 días), B no vence (10). Una licencia de 2 días en diciembre sale de A: quedan 1 + 10.
    const asignaciones = [asignacion(10, '2026-01-01', null), asignacion(3, '2026-01-01', '2026-12-31')];
    expect(saldoVigente(asignaciones, [licencia(2, '2026-12-01')], HOY).saldo).toBe(11);
  });

  it('una licencia posterior al vencimiento de A solo puede salir de B', () => {
    // La licencia es del 10/01/2027, cuando A ya venció: descuenta de B (10 → 8) y A sigue entera hoy (3): total 11.
    const asignaciones = [asignacion(10, '2026-01-01', null), asignacion(3, '2026-01-01', '2026-12-31')];
    expect(saldoVigente(asignaciones, [licencia(2, '2027-01-10')], HOY).saldo).toBe(11);
  });

  it('una licencia más grande que la asignación que la cubre pasa a la siguiente', () => {
    const asignaciones = [asignacion(3, '2026-01-01', '2026-12-31'), asignacion(10, '2026-01-01', null)];
    // 5 días: 3 salen de la que vence antes y 2 de la otra → queda 0 + 8.
    expect(saldoVigente(asignaciones, [licencia(5, '2026-12-01')], HOY).saldo).toBe(8);
  });
});

describe('diasHabilesEntre (lunes a viernes sin feriados, ambos extremos incluidos)', () => {
  it('cuenta una semana completa', () => {
    expect(diasHabilesEntre('2026-11-02', '2026-11-06')).toBe(5);
  });

  it('descuenta los feriados', () => {
    expect(diasHabilesEntre('2026-11-02', '2026-11-06', { '2026-11-03': 'Feriado de prueba' })).toBe(4);
  });

  it('un fin de semana no suma nada', () => {
    expect(diasHabilesEntre('2026-11-21', '2026-11-22')).toBe(0);
  });

  it('un solo día hábil cuenta 1', () => {
    expect(diasHabilesEntre('2026-11-25', '2026-11-25')).toBe(1);
  });

  it('si "desde" es posterior a "hasta" no hay días', () => {
    expect(diasHabilesEntre('2026-11-10', '2026-11-02')).toBe(0);
  });
});

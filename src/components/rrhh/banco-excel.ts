import type { RrhhBancoResult } from '@/lib/odoo/rrhh-banco';

const fechaAr = (iso: string) => iso.split('-').reverse().join('/');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

const COLOR_TITULO = 'FF1F3A5F';
const COLOR_ENCABEZADO = 'FFE8EEF6';

/**
 * Arma el Excel del banco de horas en el navegador (exceljs se carga recién al apretar el botón).
 * `ocultarNombres`: reemplaza los nombres por "Empleado 001…" para poder compartirlo afuera de la empresa.
 */
export async function descargarExcelBanco(data: RrhhBancoResult, ocultarNombres: boolean) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Frontera Living';
  wb.created = new Date();

  // Nombres anónimos estables: por orden alfabético del nombre real.
  const anonimo = new Map<number, string>();
  if (ocultarNombres) {
    [...data.empleados].sort((a, b) => a.empleado.localeCompare(b.empleado, 'es')).forEach((e, i) => anonimo.set(e.empleadoId, `Empleado ${String(i + 1).padStart(3, '0')}`));
    for (const m of data.movimientos) if (!anonimo.has(m.empleadoId)) anonimo.set(m.empleadoId, `Empleado ${String(anonimo.size + 1).padStart(3, '0')}`);
  }
  const nombre = (id: number, real: string) => (ocultarNombres ? (anonimo.get(id) ?? 'Empleado') : real);
  // En el concepto a veces queda "(cargada desde la web por <usuario>)": al ocultar nombres se saca.
  const concepto = (c: string) => (ocultarNombres ? c.replace(/\s*\(cargada desde la web por[^)]*\)/i, '').trim() : c);

  const encabezado = (ws: import('exceljs').Worksheet, fila: number) => {
    const r = ws.getRow(fila);
    r.font = { bold: true };
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ENCABEZADO } };
    r.alignment = { vertical: 'middle', wrapText: true };
  };
  const titulo = (ws: import('exceljs').Worksheet, texto: string, sub: string) => {
    ws.getCell('A1').value = texto;
    ws.getCell('A1').font = { bold: true, size: 14, color: { argb: COLOR_TITULO } };
    ws.getCell('A2').value = sub;
    ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };
  };
  const periodo = `Período: ${fechaAr(data.desde)} al ${fechaAr(data.hasta)} · generado el ${fechaAr(data.generatedAt)}`;

  // 1) Cómo funciona -----------------------------------------------------------------------------------------------
  const ws1 = wb.addWorksheet('Cómo funciona');
  titulo(ws1, 'Banco de horas · Frontera Living', periodo);
  ws1.getColumn(1).width = 110;
  const texto: [string, boolean][] = [
    ['¿Qué es?', true],
    ['Es una cuenta de horas de cada empleado. Las horas trabajadas de más se guardan ahí y después se pueden tomar como tiempo libre.', false],
    ['', false],
    ['¿Cómo entran horas? (altas, +)', true],
    ['RRHH las acredita en Odoo cuando el empleado trabajó de más (horas extra, inventario) o canjea otro beneficio (vacaciones, día del gremio) por horas.', false],
    ['Cada alta queda como una asignación del tipo "Banco de horas", con fecha y motivo.', false],
    ['', false],
    ['¿Cómo salen horas? (usos, −)', true],
    ['Cuando el empleado se va antes, llega tarde o toma un día, RRHH carga una ausencia del tipo "Banco de horas" por esas horas.', false],
    ['Una jornada fichada es de 8,3 hs; la liquidación cuenta 8,8 hs por día (la media hora de descanso se paga).', false],
    ['', false],
    ['¿Cómo se calcula el saldo?', true],
    ['Saldo = altas aprobadas − usos aprobados. Los movimientos pendientes de aprobación se listan pero no suman al saldo.', false],
    ['La hoja "Saldo por empleado" compara ese cálculo con el saldo que muestra Odoo hoy; si no coinciden se marca la diferencia.', false],
    ['', false],
    ['Hojas de este archivo', true],
    ['Resumen mensual: horas acreditadas y usadas mes a mes.', false],
    ['Movimientos: cada alta y cada uso, en orden, con el saldo acumulado del empleado.', false],
    ['Saldo por empleado: altas, usos y saldo de cada uno.', false],
  ];
  texto.forEach(([t, negrita], i) => {
    const c = ws1.getCell(4 + i, 1);
    c.value = t;
    c.alignment = { wrapText: true, vertical: 'top' };
    if (negrita) c.font = { bold: true, color: { argb: COLOR_TITULO } };
  });
  if (ocultarNombres) {
    const c = ws1.getCell(4 + texto.length + 1, 1);
    c.value = 'Los nombres de los empleados fueron reemplazados por números ("Empleado 001…") para proteger su identidad.';
    c.font = { italic: true };
  }

  // 2) Resumen mensual ---------------------------------------------------------------------------------------------
  const ws2 = wb.addWorksheet('Resumen mensual');
  titulo(ws2, 'Resumen mensual del banco de horas', `${periodo} · solo movimientos aprobados`);
  ws2.columns = [{ width: 22 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  ws2.getRow(4).values = ['Mes', 'Horas acreditadas', 'Horas usadas', 'Neto del mes', 'Movimientos'];
  encabezado(ws2, 4);
  const porMes = new Map<string, { altas: number; usos: number; n: number }>();
  for (const m of data.movimientos) {
    if (m.estado !== 'aprobado') continue;
    const k = m.fecha.slice(0, 7);
    const f = porMes.get(k) ?? { altas: 0, usos: 0, n: 0 };
    if (m.horas > 0) f.altas += m.horas;
    else f.usos -= m.horas;
    f.n += 1;
    porMes.set(k, f);
  }
  let fila = 5;
  for (const [k, f] of [...porMes.entries()].sort()) {
    ws2.getRow(fila++).values = [nombreMes(k), Math.round(f.altas * 100) / 100, Math.round(f.usos * 100) / 100, Math.round((f.altas - f.usos) * 100) / 100, f.n];
  }
  ws2.getRow(fila).values = ['Total', data.totales.altas, data.totales.usos, data.totales.neto, data.movimientos.filter((m) => m.estado === 'aprobado').length];
  ws2.getRow(fila).font = { bold: true };
  for (let r = 5; r <= fila; r++) for (const c of [2, 3, 4]) ws2.getCell(r, c).numFmt = '#,##0.00';

  // 3) Movimientos -------------------------------------------------------------------------------------------------
  const ws3 = wb.addWorksheet('Movimientos');
  titulo(ws3, 'Movimientos del banco de horas', periodo);
  ws3.columns = [{ width: 12 }, { width: 30 }, { width: 34 }, { width: 10 }, { width: 44 }, { width: 10 }, { width: 12 }, { width: 14 }];
  ws3.getRow(4).values = ['Fecha', 'Empleado', 'Departamento', 'Tipo', 'Concepto', 'Horas', 'Estado', 'Saldo después'];
  encabezado(ws3, 4);
  data.movimientos.forEach((m, i) => {
    const r = ws3.getRow(5 + i);
    r.values = [fechaAr(m.fecha), nombre(m.empleadoId, m.empleado), m.departamento ?? '', m.tipo === 'alta' ? 'Alta' : 'Uso', concepto(m.concepto), m.horas, m.estado === 'aprobado' ? 'Aprobado' : 'Pendiente', m.saldo];
    r.getCell(6).numFmt = '+#,##0.00;-#,##0.00';
    r.getCell(8).numFmt = '#,##0.00';
    r.getCell(6).font = { color: { argb: m.horas >= 0 ? 'FF1B7F3B' : 'FFB42318' } };
    if (m.estado === 'pendiente') r.font = { italic: true, color: { argb: 'FF8A6D00' } };
  });
  ws3.views = [{ state: 'frozen', ySplit: 4 }];
  ws3.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 8 } };

  // 4) Saldo por empleado ------------------------------------------------------------------------------------------
  const ws4 = wb.addWorksheet('Saldo por empleado');
  titulo(ws4, 'Saldo del banco de horas por empleado', `${periodo} · altas y usos del período (aprobados)`);
  ws4.columns = [{ width: 30 }, { width: 34 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 14 }];
  ws4.getRow(4).values = ['Empleado', 'Departamento', 'Horas acreditadas', 'Horas usadas', 'Neto', 'Saldo calculado', 'Saldo en Odoo hoy', 'Diferencia'];
  encabezado(ws4, 4);
  const emps = ocultarNombres ? [...data.empleados].sort((a, b) => (anonimo.get(a.empleadoId) ?? '').localeCompare(anonimo.get(b.empleadoId) ?? '')) : data.empleados;
  emps.forEach((e, i) => {
    const dif = Math.round((e.saldoCalculado - e.saldoOdoo) * 100) / 100;
    const r = ws4.getRow(5 + i);
    r.values = [nombre(e.empleadoId, e.empleado), e.departamento ?? '', e.altas, e.usos, e.neto, e.saldoCalculado, e.saldoOdoo, dif];
    for (const c of [3, 4, 5, 6, 7, 8]) r.getCell(c).numFmt = '#,##0.00';
    if (Math.abs(dif) > 0.1) r.getCell(8).font = { bold: true, color: { argb: 'FFB42318' } };
  });
  const nota = ws4.getCell(5 + emps.length + 1, 1);
  nota.value = 'Diferencia ≠ 0: el saldo que muestra Odoo no coincide con altas − usos del historial (por ejemplo, ajustes manuales o movimientos anteriores al historial cargado).';
  nota.font = { italic: true, color: { argb: 'FF666666' } };
  ws4.views = [{ state: 'frozen', ySplit: 4 }];

  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `banco-de-horas_${data.desde}_${data.hasta}${ocultarNombres ? '_anonimo' : ''}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

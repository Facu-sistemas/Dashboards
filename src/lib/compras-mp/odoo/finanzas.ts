// Conectores de solo lectura para los desembolsos: condiciones de pago, facturas abiertas, pagos,
// impuestos por factura y gastos de importación. Misma lógica que scripts/build-desembolsos-mp.mjs
// (el archivo que Compras usó para el libro), pero tipada y filtrada por la compañía operativa.
import { searchReadAll } from '../../odoo/client';
import { getFronteraCompany } from '../../odoo/reference';
import { MATERIA_PRIMA_CATEG_ID } from '../../odoo/raw-material-consumption';
import type {
  CondPagoProveedor,
  FacturaAbierta,
  GastoImportacion,
  ImpuestoFactura,
  Pago,
} from '../desembolsos';

const nm = (m2o: [number, string] | false | undefined) => (m2o ? m2o[1] : '');
const VALUE: Record<string, string> = { balance: 'Saldo', percent: '%', fixed: 'Monto fijo' };

/** Lee registros por id en tandas (search_read con `id in`), incluyendo archivados. */
async function leerPorIds<T extends Record<string, unknown>>(model: string, ids: number[], fields: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 1000) {
    out.push(...(await searchReadAll<T>({ model, domain: [['id', 'in', ids.slice(i, i + 1000)]], fields, context: { active_test: false } })));
  }
  return out;
}

export interface FinanzasMp {
  condPago: Record<string, CondPagoProveedor>;
  facturas: FacturaAbierta[];
  pagos: Pago[];
  impuestos: ImpuestoFactura[];
  gastos: GastoImportacion[];
}

/** Cuentas contables de gastos de importación. */
export const CUENTAS_IMPORTACION: Record<string, string> = {
  '4.2.0.10.028': 'Gastos de importación',
  '4.2.0.10.029': 'Flete y cargas de importación',
  '4.2.0.10.039': 'Agente / personal transitorio',
  '1.1.0.30.021': 'Aduana - crédito fiscal (impuestos de importación)',
};

export async function getFinanzasMp(desde = `${new Date().getFullYear()}-01-01`): Promise<FinanzasMp> {
  const { companyId } = await getFronteraCompany();

  // --- proveedores de MP: los que tienen líneas de OC confirmadas de productos de MP
  const poLines = await searchReadAll<{ partner_id: [number, string] | false }>({
    model: 'purchase.order.line',
    domain: [['order_id.state', 'in', ['purchase', 'done']], ['order_id.company_id', '=', companyId], ['product_id.categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID]],
    fields: ['partner_id'],
  });
  const partnerIds = [...new Set(poLines.map((l) => (l.partner_id ? l.partner_id[0] : 0)).filter(Boolean))];
  const partners = await leerPorIds<{ id: number; commercial_partner_id: [number, string] }>('res.partner', partnerIds, ['commercial_partner_id']);
  const commercialIds = [...new Set(partners.map((p) => p.commercial_partner_id[0]))];
  const commercials = await leerPorIds<{ id: number; name: string; property_supplier_payment_term_id: [number, string] | false }>(
    'res.partner', commercialIds, ['name', 'property_supplier_payment_term_id']);

  // --- 1. condiciones de pago por proveedor
  const termIds = [...new Set(commercials.map((p) => (p.property_supplier_payment_term_id ? p.property_supplier_payment_term_id[0] : 0)).filter(Boolean))];
  const terms = await leerPorIds<{ id: number; name: string; line_ids: number[] }>('account.payment.term', termIds, ['name', 'line_ids']);
  const termById = new Map(terms.map((t) => [t.id, t]));
  const termLines = await leerPorIds<{ id: number; payment_id: [number, string]; value: string; value_amount: number; nb_days: number }>(
    'account.payment.term.line', terms.flatMap((t) => t.line_ids), ['payment_id', 'value', 'value_amount', 'nb_days']);
  const condPago: Record<string, CondPagoProveedor> = {};
  for (const p of commercials) {
    const t = p.property_supplier_payment_term_id ? termById.get(p.property_supplier_payment_term_id[0]) : undefined;
    const ls = t ? termLines.filter((l) => l.payment_id[0] === t.id) : [];
    condPago[p.name.trim()] = {
      cond: t ? t.name : '(sin condición cargada)',
      resumen: ls.map((l) => `${l.value === 'percent' ? l.value_amount + '%' : VALUE[l.value] ?? l.value} a ${l.nb_days} d`).join(' + '),
    };
  }

  // --- 2. facturas abiertas (una fila por vencimiento)
  type Move = {
    id: number; name: string; commercial_partner_id: [number, string]; move_type: string; invoice_date: string | false; invoice_date_due: string | false;
    currency_id: [number, string]; amount_untaxed: number; amount_total: number; amount_residual: number; payment_state: string;
  };
  const moves = await searchReadAll<Move>({
    model: 'account.move',
    domain: [['company_id', '=', companyId], ['move_type', 'in', ['in_invoice', 'in_refund']], ['state', '=', 'posted'],
      ['payment_state', 'in', ['not_paid', 'partial']], ['commercial_partner_id', 'in', commercialIds]],
    fields: ['name', 'commercial_partner_id', 'move_type', 'invoice_date', 'invoice_date_due', 'currency_id', 'amount_untaxed', 'amount_total', 'amount_residual', 'payment_state'],
    order: 'invoice_date asc, id asc',
  });
  type PayLine = { move_id: [number, string]; date_maturity: string | false; amount_residual: number; amount_residual_currency: number; currency_id: [number, string] | false };
  const payLines: PayLine[] = [];
  const moveIds = moves.map((m) => m.id);
  for (let i = 0; i < moveIds.length; i += 1000) {
    payLines.push(...(await searchReadAll<PayLine>({
      model: 'account.move.line',
      domain: [['move_id', 'in', moveIds.slice(i, i + 1000)], ['account_id.account_type', '=', 'liability_payable'], ['reconciled', '=', false]],
      fields: ['move_id', 'date_maturity', 'amount_residual', 'amount_residual_currency', 'currency_id'],
    })));
  }
  const porMove = new Map<number, PayLine[]>();
  for (const l of payLines) porMove.set(l.move_id[0], [...(porMove.get(l.move_id[0]) ?? []), l]);
  const facturas: FacturaAbierta[] = [];
  for (const m of moves) {
    const sign = m.move_type === 'in_refund' ? -1 : 1;
    const base = { proveedor: nm(m.commercial_partner_id), numero: m.name, moneda: nm(m.currency_id), neto: sign * m.amount_untaxed, total: sign * m.amount_total };
    const ls = porMove.get(m.id) ?? [];
    if (!ls.length) facturas.push({ ...base, vencimiento: m.invoice_date_due || null, saldo: sign * m.amount_residual });
    for (const l of ls) {
      // el residual de la línea a pagar viene negativo en facturas: se invierte para mostrarlo como saldo a pagar
      const s = l.currency_id ? l.amount_residual_currency : l.amount_residual;
      facturas.push({ ...base, vencimiento: l.date_maturity || m.invoice_date_due || null, saldo: -s });
    }
  }

  // --- 3. pagos a proveedores desde `desde`
  type Payment = { id: number; date: string; amount: number; currency_id: [number, string]; amount_company_currency_signed: number; reconciled_bill_ids: number[] };
  const pagosRaw = await searchReadAll<Payment>({
    model: 'account.payment',
    domain: [['company_id', '=', companyId], ['payment_type', '=', 'outbound'], ['partner_type', '=', 'supplier'], ['state', 'in', ['posted', 'paid']],
      ['date', '>=', desde], ['partner_id', 'in', [...new Set([...commercialIds, ...partnerIds])]]],
    fields: ['date', 'amount', 'currency_id', 'amount_company_currency_signed', 'reconciled_bill_ids'],
    order: 'date asc, id asc',
  });
  const billIds = [...new Set(pagosRaw.flatMap((p) => p.reconciled_bill_ids))];
  const bills = await leerPorIds<{ id: number; name: string }>('account.move', billIds, ['name']);
  const billName = new Map(bills.map((b) => [b.id, b.name]));
  const pagos: Pago[] = pagosRaw.map((p) => ({
    fecha: p.date, moneda: nm(p.currency_id), importeOriginal: p.amount, importeArs: Math.abs(p.amount_company_currency_signed),
    facturas: p.reconciled_bill_ids.map((i) => billName.get(i)).filter(Boolean).join(', '),
  }));

  // --- 5. impuestos por factura (abiertas + pagadas con pago desde `desde`)
  const todasIds = [...new Set([...moveIds, ...billIds])];
  type MoveImp = Move & { state: string };
  const factsImp = (await leerPorIds<MoveImp>('account.move', todasIds,
    ['name', 'commercial_partner_id', 'move_type', 'invoice_date', 'currency_id', 'amount_untaxed', 'amount_total', 'state', 'payment_state']))
    .filter((m) => m.state === 'posted' && ['in_invoice', 'in_refund'].includes(m.move_type));
  type TaxLine = { move_id: [number, string]; tax_line_id: [number, string]; amount_currency: number };
  const taxLines: TaxLine[] = [];
  for (let i = 0; i < todasIds.length; i += 1000) {
    taxLines.push(...(await searchReadAll<TaxLine>({
      model: 'account.move.line',
      domain: [['move_id', 'in', todasIds.slice(i, i + 1000)], ['tax_line_id', '!=', false]],
      fields: ['move_id', 'tax_line_id', 'amount_currency'],
    })));
  }
  const ivaPorMove = new Map<number, number>();
  const percPorMove = new Map<number, number>();
  for (const t of taxLines) {
    const mapa = /^IVA/i.test(t.tax_line_id[1]) ? ivaPorMove : percPorMove;
    mapa.set(t.move_id[0], (mapa.get(t.move_id[0]) ?? 0) + t.amount_currency);
  }
  const impuestos: ImpuestoFactura[] = factsImp.map((m) => {
    const sign = m.move_type === 'in_refund' ? -1 : 1;
    return {
      proveedor: nm(m.commercial_partner_id), numero: m.name, moneda: nm(m.currency_id), neto: sign * m.amount_untaxed,
      iva: ivaPorMove.get(m.id) ?? 0, percepciones: percPorMove.get(m.id) ?? 0, total: sign * m.amount_total,
    };
  });

  // --- 6. gastos de importación desde `desde`
  type GLine = { date: string; account_id: [number, string]; balance: number };
  const gLines = await searchReadAll<GLine>({
    model: 'account.move.line',
    domain: [['move_id.move_type', 'in', ['in_invoice', 'in_refund']], ['move_id.state', '=', 'posted'], ['company_id', '=', companyId], ['date', '>=', desde],
      ['display_type', '=', 'product'], ['account_id.code', 'in', Object.keys(CUENTAS_IMPORTACION)]],
    fields: ['date', 'account_id', 'balance'],
    order: 'date asc, id asc',
  });
  const gastos: GastoImportacion[] = gLines.map((l) => ({
    fecha: l.date, tipo: CUENTAS_IMPORTACION[l.account_id[1].split(' ')[0] ?? ''] ?? '', importeArs: l.balance,
  }));

  return { condPago, facturas, pagos, impuestos, gastos };
}

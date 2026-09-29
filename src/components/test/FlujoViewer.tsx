import { useEffect, useState } from 'react';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';

interface FlujoProductOption {
  id: number;
  name: string;
}

interface FlujoOrderOption {
  id: number;
  name: string;
  partnerName: string;
  dateOrder: string;
  qty: number;
  state: string;
}

interface FlujoStockMove {
  productName: string;
  qty: number;
  state: string;
}

interface FlujoPicking {
  id: number;
  name: string;
  typeName: string;
  state: string;
  origin: string | null;
  locationFrom: string;
  locationTo: string;
  dateDone: string | null;
  moves: FlujoStockMove[];
}

interface FlujoManufacturingOrder {
  id: number;
  name: string;
  productName: string;
  qty: number;
  state: string;
  dateFinished: string | null;
  children: FlujoManufacturingOrder[];
}

interface FlujoInvoice {
  id: number;
  name: string;
  kind: 'invoice' | 'credit_note';
  state: string;
  amountTotal: number;
  invoiceDate: string | null;
  paymentState: string;
  reversesInvoiceName: string | null;
}

interface FlujoOrderLine {
  productName: string;
  qty: number;
  qtyDelivered: number;
  qtyInvoiced: number;
  priceUnit: number;
}

interface FlujoTrace {
  order: {
    id: number;
    name: string;
    partnerName: string;
    dateOrder: string;
    amountTotal: number;
    state: string;
    lines: FlujoOrderLine[];
  };
  pickings: FlujoPicking[];
  manufacturingOrders: FlujoManufacturingOrder[];
  invoices: FlujoInvoice[];
}

interface FlujoBomNode {
  productName: string;
  qty: number;
  children: FlujoBomNode[];
}

interface FlujoSimulation {
  product: { id: number; name: string; listPrice: number };
  hasBom: boolean;
  bomTree: FlujoBomNode[];
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const DEBOUNCE_MS = 300;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATE_LABELS: Record<string, string> = {
  draft: 'Borrador',
  sale: 'Confirmada',
  done: 'Cerrada',
  cancel: 'Cancelada',
  waiting: 'Esperando',
  confirmed: 'Confirmada',
  assigned: 'Lista',
  posted: 'Contabilizada',
  not_paid: 'Sin pagar',
  paid: 'Pagada',
  in_payment: 'En proceso de pago',
  partial: 'Pago parcial',
  reversed: 'Revertida',
};

function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

function StepArrow() {
  return (
    <div className="flex justify-center py-1 text-slate-600">
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
        <path d="M8 0v16M8 16l-5-5M8 16l5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'green' | 'amber' | 'rose' }) {
  const toneClasses =
    tone === 'green'
      ? 'bg-status-green/10 text-status-green'
      : tone === 'amber'
        ? 'bg-status-yellow/10 text-status-yellow'
        : tone === 'rose'
          ? 'bg-status-red/10 text-status-red'
          : 'bg-slate-800 text-slate-400';
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${toneClasses}`}>{children}</span>;
}

function toneForState(state: string): 'slate' | 'green' | 'amber' | 'rose' {
  if (['done', 'posted', 'paid'].includes(state)) return 'green';
  if (['cancel', 'reversed'].includes(state)) return 'rose';
  if (['waiting', 'draft', 'not_paid', 'partial'].includes(state)) return 'amber';
  return 'slate';
}

function ManufacturingNode({ mo, depth }: { mo: FlujoManufacturingOrder; depth: number }) {
  return (
    <div className={depth > 0 ? 'ml-5 mt-2 border-l border-dashed border-slate-700 pl-4' : ''}>
      <div className="flex flex-wrap items-center gap-2 rounded border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
        <span className="font-mono text-xs text-orange-400">{mo.name}</span>
        <span className="text-slate-200">{mo.productName}</span>
        <span className="text-slate-500">× {mo.qty}</span>
        <Badge tone={toneForState(mo.state)}>{stateLabel(mo.state)}</Badge>
        {mo.dateFinished && <span className="text-xs text-slate-500">fin: {formatDate(mo.dateFinished)}</span>}
      </div>
      {mo.children.map((c) => (
        <ManufacturingNode key={c.id} mo={c} depth={depth + 1} />
      ))}
    </div>
  );
}

function BomNode({ node, depth }: { node: FlujoBomNode; depth: number }) {
  return (
    <div className={depth > 0 ? 'ml-5 mt-2 border-l border-dashed border-slate-700 pl-4' : ''}>
      <div className="flex flex-wrap items-center gap-2 rounded border border-dashed border-slate-700 bg-slate-950/40 px-3 py-2 text-sm">
        <span className="text-slate-300">{node.productName}</span>
        <span className="text-slate-500">× {node.qty}</span>
        {node.children.length > 0 && <Badge>generaría su propia WH/MO</Badge>}
      </div>
      {node.children.map((c, i) => (
        <BomNode key={i} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

/** Small pill used for the interactive branch choices inside the return timeline. */
function ChoicePill({ active, tone, onClick, children }: { active: boolean; tone: 'green' | 'rose' | 'amber'; onClick: () => void; children: React.ReactNode }) {
  const activeClasses =
    tone === 'green'
      ? 'border-status-green/60 bg-status-green/10 text-status-green'
      : tone === 'rose'
        ? 'border-status-red/60 bg-status-red/10 text-status-red'
        : 'border-status-yellow/60 bg-status-yellow/10 text-status-yellow';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? activeClasses : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
      }`}
    >
      {children}
    </button>
  );
}

function AreaTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
      {children}
    </span>
  );
}

function TimelineStep({
  n,
  area,
  title,
  isLast,
  muted,
  children,
}: {
  n: number;
  area: string;
  title: string;
  isLast?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`relative flex gap-3 ${isLast ? '' : 'pb-4'} ${muted ? 'opacity-60' : ''}`}>
      <div className="flex flex-col items-center">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-rose-500/50 bg-slate-950 text-xs font-semibold text-rose-400">
          {n}
        </div>
        {!isLast && <div className="mt-1 w-px flex-1 bg-slate-700" />}
      </div>
      <div className="flex-1 pb-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-200">{title}</span>
          <AreaTag>{area}</AreaTag>
        </div>
        <div className="mt-1 text-xs leading-relaxed text-slate-400">{children}</div>
      </div>
    </div>
  );
}

/**
 * Detailed, interactive walkthrough of "what if it comes back for a
 * warranty return" — always hypothetical (illustrative), since a real
 * return flow is rare enough in this Odoo that most orders won't have
 * one. Mirrors how this actually happens here: a Ticket de Soporte
 * (Gestión de Calidad) → an approve/reject call → a credit note
 * (Finanzas) → the product physically coming back to depósito → either
 * reprocessing it (a new WH/MO) or writing it off as scrap.
 */
function DevolucionTimeline({ productName, orderLabel, invoiceName, referenceAmount }: { productName: string; orderLabel: string; invoiceName: string | null; referenceAmount: number }) {
  const [garantia, setGarantia] = useState<'pendiente' | 'aprobada' | 'rechazada'>('pendiente');
  const [destino, setDestino] = useState<'reparable' | 'merma'>('reparable');

  return (
    <div className="mt-2 flex flex-col border-l-2 border-dashed border-rose-500/40 pl-4">
      <p className="mb-3 text-xs text-slate-500">
        Rama hipotética (no ocurrió realmente) — así seguiría el circuito en Odoo si <span className="text-slate-300">{productName}</span> vuelve por
        garantía. Elegí cómo se resuelve en los pasos 3 y 6 para ver cómo cambia el resto:
      </p>

      <TimelineStep n={1} area="Atención al cliente" title="Reclamo del cliente">
        El cliente contacta a Frontera Living reportando una falla en <span className="text-slate-300">{productName}</span>, de {orderLabel}.
      </TimelineStep>

      <TimelineStep n={2} area="Gestión de Calidad" title="Se abre un Ticket de Soporte">
        Se registra un ticket tipo <span className="text-slate-300">"Garantía"</span>, con prioridad según la gravedad, vinculado a la orden y al
        producto — el mismo circuito que hoy se ve en Gestión de Calidad → Tickets de Soporte.
      </TimelineStep>

      <TimelineStep n={3} area="Gestión de Calidad" title="Evaluación técnica">
        <div className="flex flex-col gap-2">
          <p>Un técnico revisa el reclamo y determina si es una falla de fabricación (cubierta por garantía) o responsabilidad del cliente.</p>
          <div className="flex flex-wrap gap-2">
            <ChoicePill active={garantia === 'aprobada'} tone="green" onClick={() => setGarantia('aprobada')}>
              Se aprueba la garantía
            </ChoicePill>
            <ChoicePill active={garantia === 'rechazada'} tone="rose" onClick={() => setGarantia('rechazada')}>
              Se rechaza (mal uso)
            </ChoicePill>
          </div>
        </div>
      </TimelineStep>

      {garantia === 'rechazada' ? (
        <TimelineStep n={4} area="Gestión de Calidad" title="Reclamo rechazado" isLast>
          No corresponde garantía: se cierra el ticket sin nota de crédito ni reingreso a depósito. El circuito termina acá — el cliente se queda con
          el producto tal como está.
        </TimelineStep>
      ) : (
        <>
          <TimelineStep n={4} area="Finanzas" title="Nota de crédito" muted={garantia === 'pendiente'}>
            {garantia === 'aprobada' ? (
              <>
                Se aprueba la garantía: Finanzas emite una nota de crédito que revierte {invoiceName ?? 'la factura'} por{' '}
                {money.format(referenceAmount)}.
              </>
            ) : (
              <>
                Si se aprueba, Finanzas emitiría una nota de crédito revirtiendo {invoiceName ?? 'la factura'} por {money.format(referenceAmount)}.
              </>
            )}
          </TimelineStep>

          <TimelineStep n={5} area="Almacén" title="Reingreso a depósito" muted={garantia === 'pendiente'}>
            Se genera un traslado interno de entrada: el producto pasa de <span className="text-slate-300">Partners/Customers</span> a{' '}
            <span className="text-slate-300">WH/Existencias</span>, en sentido inverso al WH/OUT original de la entrega.
          </TimelineStep>

          <TimelineStep n={6} area={destino === 'reparable' ? 'Producción' : 'Almacén'} title="¿Qué pasa con el producto físico?" muted={garantia === 'pendiente'}>
            <div className="flex flex-col gap-2">
              <p>Depósito decide el destino según en qué estado vuelve el producto:</p>
              <div className="flex flex-wrap gap-2">
                <ChoicePill active={destino === 'reparable'} tone="green" onClick={() => setDestino('reparable')}>
                  Es reparable
                </ChoicePill>
                <ChoicePill active={destino === 'merma'} tone="amber" onClick={() => setDestino('merma')}>
                  No es reparable (merma)
                </ChoicePill>
              </div>
              {destino === 'reparable' ? (
                <p>
                  Se abre una nueva Orden de Fabricación (WH/MO) de reproceso, que consume los repuestos necesarios según la lista de materiales del
                  producto, y al terminar vuelve a stock vendible.
                </p>
              ) : (
                <p>
                  Se da de baja mediante un ajuste de inventario (merma): el producto sale definitivamente del stock y su costo se imputa como
                  pérdida.
                </p>
              )}
            </div>
          </TimelineStep>

          <TimelineStep n={7} area="Gestión de Calidad" title="Cierre del ticket" isLast muted={garantia === 'pendiente'}>
            Se cierra el ticket de soporte, con el historial completo enlazado: orden → factura → nota de crédito → reingreso a depósito →{' '}
            {destino === 'reparable' ? 'reproceso (nueva WH/MO)' : 'baja por merma'}.
          </TimelineStep>
        </>
      )}
    </div>
  );
}

function ReturnSection({
  productName,
  orderLabel,
  invoiceName,
  referenceAmount,
  realCreditNotes,
}: {
  productName: string;
  orderLabel: string;
  invoiceName: string | null;
  referenceAmount: number;
  realCreditNotes: FlujoInvoice[];
}) {
  const [simularDevolucion, setSimularDevolucion] = useState(false);

  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-rose-400">¿Y si vuelve por una devolución?</h3>
        {realCreditNotes.length === 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={simularDevolucion} onChange={(e) => setSimularDevolucion(e.target.checked)} className="accent-rose-500" />
            Simular
          </label>
        )}
      </div>

      {realCreditNotes.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-slate-500">Esta orden ya tuvo una devolución real, registrada como nota de crédito:</p>
          {realCreditNotes.map((cn) => (
            <div key={cn.id} className="rounded border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-rose-400">{cn.name}</span>
                <Badge tone={toneForState(cn.state)}>{stateLabel(cn.state)}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Revierte {cn.reversesInvoiceName ?? 'factura'} por {money.format(cn.amountTotal)} · {formatDate(cn.invoiceDate)}
              </p>
            </div>
          ))}
        </div>
      ) : simularDevolucion ? (
        <DevolucionTimeline productName={productName} orderLabel={orderLabel} invoiceName={invoiceName} referenceAmount={referenceAmount} />
      ) : (
        <p className="mt-2 text-xs text-slate-500">Activá "Simular" para ver, paso a paso, cómo seguiría el circuito.</p>
      )}
    </div>
  );
}

function ProductPicker({ onSelect }: { onSelect: (p: FlujoProductOption) => void }) {
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  const query = useApiQuery<FlujoProductOption[]>(
    ['flujo-productos', debounced],
    `/api/flujo-productos?${new URLSearchParams({ q: debounced, limit: '20' })}`,
    { enabled: debounced.length >= 2 }
  );

  const items = query.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Buscar producto (ej: Aero Rinconero)..."
        className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
        autoFocus
      />
      {debounced.length > 0 && debounced.length < 2 && (
        <p className="text-xs text-slate-500">Escribí al menos 2 caracteres.</p>
      )}
      {query.isLoading && debounced.length >= 2 && <p className="text-xs text-slate-500">Buscando…</p>}
      {debounced.length >= 2 && !query.isLoading && items.length === 0 && (
        <p className="text-xs text-slate-500">Sin resultados para "{debounced}".</p>
      )}
      {items.length > 0 && (
        <div className="max-h-72 overflow-y-auto rounded border border-slate-800">
          {items.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p)}
              className="block w-full border-b border-slate-800/60 px-3 py-2 text-left text-sm text-slate-200 last:border-0 hover:bg-slate-800/60"
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderPicker({
  product,
  onSelect,
  onSimulate,
  onBack,
}: {
  product: FlujoProductOption;
  onSelect: (o: FlujoOrderOption) => void;
  onSimulate: () => void;
  onBack: () => void;
}) {
  const query = useApiQuery<FlujoOrderOption[]>(
    ['flujo-ordenes', product.id],
    `/api/flujo-ordenes?${new URLSearchParams({ productId: String(product.id), limit: '8' })}`
  );

  const items = query.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-300">
          Producto: <span className="font-medium text-slate-100">{product.name}</span>
        </p>
        <button type="button" onClick={onBack} className="text-xs text-brand-400 hover:underline">
          Cambiar producto
        </button>
      </div>

      {query.isLoading && <p className="text-xs text-slate-500">Buscando órdenes reales de venta con este producto…</p>}
      {!query.isLoading && items.length === 0 && (
        <p className="text-sm text-slate-500">No hay órdenes de venta confirmadas recientes con este producto exacto en Odoo.</p>
      )}
      {items.length > 0 && (
        <>
          <p className="text-xs text-slate-500">Elegí una orden real para trazar su recorrido completo:</p>
          <div className="flex flex-col gap-2">
            {items.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onSelect(o)}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900 px-3 py-2 text-left text-sm hover:border-brand-500/50 hover:bg-slate-800/60"
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-brand-400">{o.name}</span>
                  <span className="text-slate-200">{o.partnerName}</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  <span>{formatDate(o.dateOrder)}</span>
                  <span>× {o.qty}</span>
                  <Badge tone={toneForState(o.state)}>{stateLabel(o.state)}</Badge>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-2 flex items-center gap-3 border-t border-slate-800 pt-3">
        <p className="text-xs text-slate-500">¿No querés depender de una orden real?</p>
        <button
          type="button"
          onClick={onSimulate}
          className="rounded border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-500/20"
        >
          Simular este producto sin una orden real
        </button>
      </div>
    </div>
  );
}

function TraceView({ product, order, onReset }: { product: FlujoProductOption; order: FlujoOrderOption; onReset: () => void }) {
  const query = useApiQuery<FlujoTrace>(['flujo-trazado', order.id], `/api/flujo-trazado?${new URLSearchParams({ orderId: String(order.id) })}`);

  if (query.isLoading || !query.data) {
    return <p className="text-sm text-slate-500">Trazando {order.name}…</p>;
  }

  const trace = query.data;
  const hasMo = trace.manufacturingOrders.length > 0;
  const hasPickings = trace.pickings.length > 0;
  const realCreditNotes = trace.invoices.filter((i) => i.kind === 'credit_note');
  const realInvoices = trace.invoices.filter((i) => i.kind === 'invoice');
  const focusLine = trace.order.lines.find((l) => l.productName === product.name) ?? trace.order.lines[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Recorrido real de una orden de venta existente en Odoo, de punta a punta.</p>
        <button type="button" onClick={onReset} className="text-xs text-brand-400 hover:underline">
          Trazar otra orden
        </button>
      </div>

      {/* Sale order */}
      <div className="rounded-lg border border-brand-500/30 bg-brand-500/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-brand-400">{trace.order.name}</span>
            <span className="text-sm text-slate-200">{trace.order.partnerName}</span>
          </div>
          <Badge tone={toneForState(trace.order.state)}>{stateLabel(trace.order.state)}</Badge>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Orden de venta creada el {formatDate(trace.order.dateOrder)} · total {money.format(trace.order.amountTotal)}
        </p>
        <div className="mt-3 space-y-1 text-xs text-slate-400">
          {trace.order.lines.map((l, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className={`truncate ${l.productName === product.name ? 'font-medium text-brand-300' : 'text-slate-300'}`}>{l.productName}</span>
              <span>
                {l.qty} × {money.format(l.priceUnit)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <StepArrow />

      {/* WH / MO branches */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-cyan-400">Rama depósito (WH)</h3>
          {!hasPickings && <p className="text-xs text-slate-500">Esta orden no generó movimientos de depósito.</p>}
          <div className="flex flex-col gap-2">
            {trace.pickings.map((p) => (
              <div key={p.id} className="rounded border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-cyan-400">{p.name}</span>
                  <span className="text-xs text-slate-400">{p.typeName}</span>
                  <Badge tone={toneForState(p.state)}>{stateLabel(p.state)}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {p.locationFrom} → {p.locationTo}
                  {p.dateDone && <> · {formatDate(p.dateDone)}</>}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-orange-400">Rama fabricación (MO)</h3>
          {!hasMo && <p className="text-xs text-slate-500">Esta orden no generó órdenes de fabricación (el producto ya tenía stock).</p>}
          <div className="flex flex-col gap-2">
            {trace.manufacturingOrders.map((mo) => (
              <ManufacturingNode key={mo.id} mo={mo} depth={0} />
            ))}
          </div>
        </div>
      </div>

      <StepArrow />

      {/* Invoices */}
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
        <h3 className="mb-2 text-sm font-semibold text-emerald-400">Facturación</h3>
        {realInvoices.length === 0 && <p className="text-xs text-slate-500">Todavía no se generó factura para esta orden.</p>}
        <div className="flex flex-col gap-2">
          {realInvoices.map((inv) => (
            <div key={inv.id} className="rounded border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-emerald-400">{inv.name}</span>
                <Badge tone={toneForState(inv.state)}>{stateLabel(inv.state)}</Badge>
                <Badge tone={toneForState(inv.paymentState)}>{stateLabel(inv.paymentState)}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {money.format(inv.amountTotal)} · {formatDate(inv.invoiceDate)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <StepArrow />

      <ReturnSection
        productName={product.name}
        orderLabel={trace.order.name}
        invoiceName={realInvoices[0]?.name ?? null}
        referenceAmount={realInvoices[0]?.amountTotal ?? focusLine?.priceUnit ?? trace.order.amountTotal}
        realCreditNotes={realCreditNotes}
      />
    </div>
  );
}

function SimulationView({ product, onReset }: { product: FlujoProductOption; onReset: () => void }) {
  const query = useApiQuery<FlujoSimulation>(['flujo-simulacion', product.id], `/api/flujo-simulacion?${new URLSearchParams({ productId: String(product.id) })}`);

  if (query.isLoading || !query.data) {
    return <p className="text-sm text-slate-500">Armando la simulación para {product.name}…</p>;
  }

  const sim = query.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Simulación (no ocurrió realmente) armada a partir de la lista de materiales real del producto — no depende de ninguna orden puntual.
        </p>
        <button type="button" onClick={onReset} className="text-xs text-brand-400 hover:underline">
          Elegir otro producto
        </button>
      </div>

      {/* Hypothetical sale order */}
      <div className="rounded-lg border border-dashed border-brand-500/40 bg-brand-500/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-brand-400">Orden de venta (simulada)</span>
            <span className="text-sm text-slate-200">Cliente hipotético</span>
          </div>
          <Badge>Hipotético</Badge>
        </div>
        <p className="mt-1 text-xs text-slate-500">Se crea hoy · total {money.format(sim.product.listPrice)}</p>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-400">
          <span className="font-medium text-brand-300">{sim.product.name}</span>
          <span>1 × {money.format(sim.product.listPrice)}</span>
        </div>
      </div>

      <StepArrow />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-dashed border-cyan-500/40 bg-cyan-500/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-cyan-400">Rama depósito (WH)</h3>
          <p className="text-xs text-slate-500">
            Si hay stock suficiente, depósito genera un <span className="text-slate-300">WH/PICK</span> (recolección interna) seguido de un{' '}
            <span className="text-slate-300">WH/OUT</span> (entrega al cliente) — el mismo circuito que se ve en las órdenes reales.
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-orange-500/40 bg-orange-500/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-orange-400">Rama fabricación (MO)</h3>
          {sim.hasBom ? (
            <>
              <p className="mb-2 text-xs text-slate-500">
                Este producto tiene lista de materiales (BOM): si no hay stock, se generaría una <span className="text-slate-300">WH/MO</span> que a
                su vez dispara una nueva WH/MO por cada componente que también se fabrica (no por cada insumo comprado):
              </p>
              <div className="max-h-96 overflow-y-auto pr-1">
                {sim.bomTree.map((n, i) => (
                  <BomNode key={i} node={n} depth={0} />
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">Este producto no tiene lista de materiales cargada: saldría directo desde stock, sin generar ninguna orden de fabricación.</p>
          )}
        </div>
      </div>

      <StepArrow />

      <div className="rounded-lg border border-dashed border-emerald-500/40 bg-emerald-500/5 p-4">
        <h3 className="mb-2 text-sm font-semibold text-emerald-400">Facturación</h3>
        <p className="text-xs text-slate-500">
          Al entregarse, se facturaría por <span className="text-slate-300">{money.format(sim.product.listPrice)}</span>.
        </p>
      </div>

      <StepArrow />

      <ReturnSection
        productName={sim.product.name}
        orderLabel="una orden de venta hipotética"
        invoiceName={null}
        referenceAmount={sim.product.listPrice}
        realCreditNotes={[]}
      />
    </div>
  );
}

type FlujoMode = 'pick-product' | 'pick-order' | 'trace' | 'simulate';

function FlujoInner() {
  const [mode, setMode] = useState<FlujoMode>('pick-product');
  const [product, setProduct] = useState<FlujoProductOption | null>(null);
  const [order, setOrder] = useState<FlujoOrderOption | null>(null);

  function reset() {
    setMode('pick-product');
    setProduct(null);
    setOrder(null);
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      {mode === 'pick-product' && (
        <ProductPicker
          onSelect={(p) => {
            setProduct(p);
            setMode('pick-order');
          }}
        />
      )}
      {mode === 'pick-order' && product && (
        <OrderPicker
          product={product}
          onSelect={(o) => {
            setOrder(o);
            setMode('trace');
          }}
          onSimulate={() => setMode('simulate')}
          onBack={reset}
        />
      )}
      {mode === 'trace' && product && order && <TraceView product={product} order={order} onReset={() => setMode('pick-order')} />}
      {mode === 'simulate' && product && <SimulationView product={product} onReset={reset} />}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:only="react"`), same pattern as the other tabs. */
export default function FlujoViewer() {
  return (
    <QueryProvider>
      <FlujoInner />
    </QueryProvider>
  );
}

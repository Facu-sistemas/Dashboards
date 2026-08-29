interface Props {
  /** react-query's `dataUpdatedAt` (ms epoch) — 0/undefined means "no successful fetch yet", hides the badge. */
  dataUpdatedAt: number | undefined;
}

// timeZone: 'America/Argentina/Buenos_Aires' is load-bearing — see
// monthOptions.ts for the general reason (UTC-anchored dates render one
// unit off in Argentina), but the reason here is different: this renders
// once during SSR (Node's local timezone, usually UTC) and again on client
// hydration (the browser's local timezone, Argentina) — without pinning
// both passes to the same explicit zone, they'd disagree and React would
// flag a hydration mismatch on every page load.
const fmt = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export default function LastUpdated({ dataUpdatedAt }: Props) {
  if (!dataUpdatedAt) return null;
  return <p className="text-xs text-slate-500">Última actualización: {fmt.format(new Date(dataUpdatedAt))}</p>;
}

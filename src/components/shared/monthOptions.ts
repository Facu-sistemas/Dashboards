export function monthOptions(count = 12): { value: string; label: string }[] {
  const now = new Date();
  // timeZone: 'UTC' is load-bearing — these Date objects are UTC-anchored
  // (Date.UTC below), and Argentina's UTC-3 offset would otherwise push
  // midnight back into the previous month in the formatted label.
  const formatter = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const options: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = formatter.format(d);
    options.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return options;
}

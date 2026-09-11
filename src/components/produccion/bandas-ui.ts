/** Presentation-only helpers for the Bandas calculator (badge colors, bin-packing bar colors) — kept out of bandas-calc.ts, which stays pure business logic. */

export function telaBadgeClasses(tela: string | null): string {
  if (!tela) return 'bg-slate-700/40 text-slate-400';
  const u = tela.toUpperCase();
  if (u === 'NEGRO') return 'bg-slate-600/40 text-slate-200';
  if (u === 'AZUL') return 'bg-blue-500/15 text-blue-300';
  if (u === 'BORDO') return 'bg-rose-500/15 text-rose-300';
  if (u.includes('GRIS')) return 'bg-slate-500/20 text-slate-300';
  if (u === 'MARRON') return 'bg-amber-600/20 text-amber-300';
  if (u.includes('INFANTIL')) return 'bg-emerald-500/15 text-emerald-300';
  return 'bg-purple-500/15 text-purple-300';
}

/** Distinct colors per "alto" value, assigned in first-seen order — reset per render pass so the same alto always gets the same color within one view. */
const BAR_PALETTE = ['#2E86AB', '#E84855', '#F4A261', '#2A9D8F', '#9B5DE5', '#F15BB5', '#FEE440', '#00BBF9', '#8338EC', '#FB5607'];

export function createColorForAlto(): (alto: number) => string {
  const map = new Map<number, string>();
  let idx = 0;
  return (alto: number) => {
    let color = map.get(alto);
    if (!color) {
      color = BAR_PALETTE[idx % BAR_PALETTE.length]!;
      map.set(alto, color);
      idx++;
    }
    return color;
  };
}

export function desperdicioClasses(desp: number): string {
  if (desp === 0) return 'text-brand-400 font-semibold';
  if (desp <= 5) return 'text-emerald-400';
  if (desp <= 20) return 'text-amber-400';
  return 'text-red-400';
}

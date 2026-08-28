/**
 * Central registry of every area on the Home grid and its tabs. Order here
 * is the order cards render in on Home and tabs render in on each area's
 * sub-navbar.
 *
 * Icons/colors are placeholders (pending definition of Frontera Living's
 * institutional palette/iconography) — swap `icon`/`accent` per area once
 * that's defined, nothing else needs to change.
 */

export interface TabConfig {
  slug: string;
  name: string;
}

export type AccentColor = 'brand' | 'purple' | 'amber' | 'emerald' | 'orange' | 'teal' | 'cyan' | 'rose';

export interface AreaConfig {
  slug: string;
  name: string;
  description: string;
  accent: AccentColor;
  /** Inner SVG markup (no outer <svg>), rendered inside a 24x24 viewBox by AreaCard. */
  icon: string;
  tabs: TabConfig[];
}

// Each key maps to complete Tailwind class names (not built from the
// AccentColor string at runtime) so the JIT compiler can find and generate
// them — a dynamic `bg-${accent}-500` template wouldn't be detected.
export const ACCENT_CLASSES: Record<AccentColor, { bg: string; text: string; ring: string }> = {
  brand: { bg: 'bg-brand-500/10', text: 'text-brand-400', ring: 'group-hover:ring-brand-500/30' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-400', ring: 'group-hover:ring-purple-500/30' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', ring: 'group-hover:ring-amber-500/30' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'group-hover:ring-emerald-500/30' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', ring: 'group-hover:ring-orange-500/30' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-400', ring: 'group-hover:ring-teal-500/30' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', ring: 'group-hover:ring-cyan-500/30' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', ring: 'group-hover:ring-rose-500/30' },
};

const ICONS = {
  barChart: '<rect x="4" y="12" width="3" height="8"/><rect x="10.5" y="8" width="3" height="12"/><rect x="17" y="4" width="3" height="16"/>',
  people:
    '<circle cx="8" cy="7" r="2.5"/><rect x="4" y="12" width="8" height="7" rx="2"/><circle cx="16.5" cy="8" r="2"/><rect x="13" y="13" width="7" height="6" rx="2"/>',
  building: '<polygon points="4,10 12,4 20,10"/><rect x="5" y="10" width="14" height="10"/><rect x="10" y="14" width="4" height="6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><polyline points="8,12.5 11,15.5 16,9"/>',
  gear: '<polygon points="12,3 18,7 18,17 12,21 6,17 6,7"/><circle cx="12" cy="12" r="3"/>',
  trendUp: '<polyline points="4,17 10,11 14,15 20,7"/><polyline points="14,7 20,7 20,13"/>',
  box: '<polygon points="4,8 12,4 20,8 12,12"/><line x1="4" y1="8" x2="4" y2="17"/><line x1="20" y1="8" x2="20" y2="17"/><line x1="12" y1="12" x2="12" y2="21"/><polyline points="4,17 12,21 20,17"/>',
  cart: '<rect x="6" y="7" width="12" height="7" rx="1"/><line x1="3" y1="4" x2="6" y2="4"/><line x1="6" y1="4" x2="6" y2="7"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>',
};

export const AREAS: AreaConfig[] = [
  {
    slug: 'finanzas',
    name: 'Finanzas',
    description: 'Presupuesto de compras y facturación',
    accent: 'brand',
    icon: ICONS.barChart,
    tabs: [
      { slug: 'presupuesto-compras', name: 'Presupuesto de Compras' },
      { slug: 'facturacion', name: 'Facturación' },
    ],
  },
  {
    slug: 'rrhh',
    name: 'RRHH',
    description: 'Próximamente',
    accent: 'purple',
    icon: ICONS.people,
    tabs: [{ slug: 'inicio', name: 'Inicio' }],
  },
  {
    slug: 'gerencia-general',
    name: 'Gerencia General',
    description: 'Próximamente',
    accent: 'amber',
    icon: ICONS.building,
    tabs: [{ slug: 'inicio', name: 'Inicio' }],
  },
  {
    slug: 'gestion-calidad',
    name: 'Gestión de Calidad',
    description: 'Próximamente',
    accent: 'emerald',
    icon: ICONS.checkCircle,
    tabs: [{ slug: 'inicio', name: 'Inicio' }],
  },
  {
    slug: 'manufactura',
    name: 'Manufactura',
    description: 'Ventas, eficiencia y consumo de materia prima',
    accent: 'orange',
    icon: ICONS.gear,
    tabs: [
      { slug: 'top-productos', name: 'Top 10 Productos' },
      { slug: 'oee', name: 'Eficiencia (OEE)' },
      { slug: 'consumo-mp', name: 'Consumo MP vs Stock' },
    ],
  },
  {
    slug: 'mejora-continua',
    name: 'Mejora Continua',
    description: 'Próximamente',
    accent: 'teal',
    icon: ICONS.trendUp,
    tabs: [{ slug: 'inicio', name: 'Inicio' }],
  },
  {
    slug: 'almacen',
    name: 'Almacén',
    description: 'Próximamente',
    accent: 'cyan',
    icon: ICONS.box,
    tabs: [{ slug: 'inicio', name: 'Inicio' }],
  },
  {
    slug: 'comercial',
    name: 'Comercial',
    description: 'Tendencia de precios y concentración de clientes',
    accent: 'rose',
    icon: ICONS.cart,
    tabs: [
      { slug: 'tendencia-precios', name: 'Tendencia de Precios' },
      { slug: 'top-clientes', name: 'Top Clientes' },
    ],
  },
];

export function getArea(slug: string): AreaConfig | undefined {
  return AREAS.find((a) => a.slug === slug);
}

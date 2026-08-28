import { useEffect, useState } from 'react';

export interface ChartTheme {
  grid: string;
  axis: string;
  axisSecondary: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  mutedBar: string;
  primary: string;
  secondary: string;
  warn: string;
  danger: string;
}

function readVar(name: string): string {
  if (typeof window === 'undefined') return 'rgb(0 0 0)';
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value ? `rgb(${value})` : 'rgb(0 0 0)';
}

function computeChartTheme(): ChartTheme {
  return {
    grid: readVar('--slate-800'),
    axis: readVar('--slate-500'),
    axisSecondary: readVar('--slate-400'),
    tooltipBg: readVar('--slate-900'),
    tooltipBorder: readVar('--slate-800'),
    tooltipText: readVar('--slate-200'),
    mutedBar: readVar('--slate-700'),
    primary: readVar('--brand-500'),
    secondary: readVar('--status-green'),
    warn: readVar('--status-yellow'),
    danger: readVar('--status-red'),
  };
}

/**
 * Recharts colors are plain SVG/style attributes, not Tailwind classes —
 * they can't react to the `data-theme` flip on <html> by themselves. This
 * reads the same CSS custom properties Tailwind's palette resolves through
 * (tailwind.config.mjs + global.css) and recomputes when the theme toggle
 * button (BaseLayout.astro) fires `themechange` on window.
 */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(() => computeChartTheme());

  useEffect(() => {
    setTheme(computeChartTheme()); // re-sync client-side — SSR has no window/CSS to read
    const handler = () => setTheme(computeChartTheme());
    window.addEventListener('themechange', handler);
    return () => window.removeEventListener('themechange', handler);
  }, []);

  return theme;
}

// Parametros visuales compartidos por los graficos del dashboard (Recharts). Un unico
// lugar para colores, rejilla y ejes: asi las series se leen como un sistema coherente.
// Recharts pinta con atributos SVG (no clases CSS), por lo que estos colores no pueden
// depender de las variables de tema de Tailwind; se resuelven por tema con getChartColors.
// Colores de serie elegidos con separacion suficiente tambien bajo deficiencia de vision del
// color (verde vs naranja, no verde vs rojo). La identidad de cada serie va SIEMPRE acompanada
// de leyenda/etiqueta, nunca solo color.
import { useTheme, type Theme } from '../../context/ThemeContext';

export interface ChartColors {
  income: string;
  expense: string;
  savings: string;
  saved: string;
  invested: string;
  bar: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
}

// Acentos de serie: iguales en ambos temas (saturados, legibles sobre claro y oscuro). Solo
// cambian los tokens neutros (rejilla, ejes, superficie del tooltip) segun el tema.
const SERIES = {
  income: '#10b981', // emerald-500: ingresos (algo mas oscuro que 400 para leer bien en claro)
  expense: '#f97316', // orange-500: gastos
  savings: '#6366f1', // indigo-500: ahorro neto
  // Serie del apartado de ahorro e inversion. Tonos 600 (mas oscuros que los acentos de
  // texto emerald-400/sky-400 del reparto, misma familia): validados juntos con indigo-500
  // para banda de luminosidad, croma, separacion CVD y contraste >= 3:1 en ambos temas.
  saved: '#059669', // emerald-600: aportado a ahorro
  invested: '#0284c7', // sky-600: aportado a inversion
  bar: '#6366f1', // indigo-500: barras de serie unica (gasto por categoria)
} as const;

const NEUTRALS: Record<Theme, Pick<ChartColors, 'grid' | 'axis' | 'tooltipBg' | 'tooltipBorder'>> = {
  dark: {
    grid: '#1e293b', // slate-800
    axis: '#64748b', // slate-500
    tooltipBg: '#0f172a', // slate-900
    tooltipBorder: '#334155', // slate-700
  },
  light: {
    grid: '#e2e8f0', // slate-200
    axis: '#64748b', // slate-500 (mismo mid, legible en ambos)
    tooltipBg: '#ffffff',
    tooltipBorder: '#cbd5e1', // slate-300
  },
};

export function getChartColors(theme: Theme): ChartColors {
  return { ...SERIES, ...NEUTRALS[theme] };
}

// Hook de conveniencia: colores de grafico segun el tema activo.
export function useChartColors(): ChartColors {
  return getChartColors(useTheme().theme);
}

// Formato compacto de euros para ticks de eje (corto, sin decimales innecesarios).
// Solo presentacion; el valor real sigue en centimos enteros.
export function formatCompactEuros(cents: number): string {
  const euros = cents / 100;
  const abs = Math.abs(euros);
  if (abs >= 1000) {
    const k = euros / 1000;
    return `${k.toFixed(abs >= 10000 ? 0 : 1)}k`;
  }
  return `${Math.round(euros)}`;
}

// Etiqueta de un mes YYYY-MM en formato largo localizado (p. ej. "julio 2026").
export function longMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Etiqueta de un mes YYYY-MM en formato corto localizado (p. ej. "jul 26").
export function shortMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  const label = date.toLocaleDateString('es-ES', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  return label.replace('.', '');
}

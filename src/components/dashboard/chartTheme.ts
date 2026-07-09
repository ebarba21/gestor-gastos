// Parametros visuales compartidos por los graficos del dashboard (Recharts). Un unico
// lugar para colores, rejilla y ejes: asi las series se leen como un sistema coherente.
// Colores elegidos con separacion suficiente tambien bajo deficiencia de vision del color
// (verde vs naranja, no verde vs rojo) y con contraste sobre superficie oscura (slate-900).
// La identidad de cada serie va SIEMPRE acompanada de leyenda/etiqueta, nunca solo color.
export const CHART_COLORS = {
  income: '#34d399', // emerald-400: ingresos
  expense: '#fb923c', // orange-400: gastos
  savings: '#818cf8', // indigo-400: ahorro neto
  bar: '#6366f1', // indigo-500: barras de serie unica (gasto por categoria)
  grid: '#1e293b', // slate-800: rejilla recesiva
  axis: '#64748b', // slate-500: ejes y ticks
  tooltipBg: '#0f172a', // slate-950
  tooltipBorder: '#334155', // slate-700
} as const;

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

// Etiqueta de un mes YYYY-MM en formato corto localizado (p. ej. "jul 26").
export function shortMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  const label = date.toLocaleDateString('es-ES', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  return label.replace('.', '');
}

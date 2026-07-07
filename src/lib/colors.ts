// Paleta de acentos reutilizable para entidades con color en la UI (categorias,
// etiquetas, cuentas). Solo presentacion. Valores hex.
export const ACCENT_COLORS: readonly string[] = [
  '#6366f1', // indigo
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ef4444', // red
  '#14b8a6', // teal
  '#f97316', // orange
  '#84cc16', // lime
  '#06b6d4', // cyan
  '#a855f7', // purple
];

export function pickAccentColor(index: number): string {
  const len = ACCENT_COLORS.length;
  const i = ((index % len) + len) % len;
  return ACCENT_COLORS[i] ?? ACCENT_COLORS[0]!;
}

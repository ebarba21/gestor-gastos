// Paleta de acentos reutilizable para entidades con color en la UI (categorias,
// etiquetas, cuentas). Solo presentacion. Valores hex.
//
// Tonos pastel "intensos": son el color de las categorias raiz. Las subcategorias usan
// variantes mas claras y suaves del MISMO tono (ver subcategoryShade), de modo que una
// subcategoria se reconoce de un vistazo como hija de su categoria (p. ej. Caprichos en
// fucsia y Ropa en rosa palo). El orden alterna tonos para que categorias contiguas no
// se parezcan.
export const ACCENT_COLORS: readonly string[] = [
  '#eb70ad', // fucsia
  '#74c0e7', // cielo
  '#f1cd55', // mantequilla
  '#72ca9e', // menta
  '#af95e4', // lavanda
  '#f18e7e', // coral
  '#5ec9c1', // turquesa
  '#f4ae71', // melocoton
  '#869fea', // pervinca
  '#acd161', // lima
  '#cc8cd9', // orquidea
  '#8bbb81', // salvia
  '#e87d8f', // frambuesa
  '#8fa6bc', // acero
  '#c9ac82', // arena
  '#c07caf', // ciruela
];

export function pickAccentColor(index: number): string {
  const len = ACCENT_COLORS.length;
  const i = ((index % len) + len) % len;
  return ACCENT_COLORS[i] ?? ACCENT_COLORS[0]!;
}

// --- Conversion hex <-> HSL (solo presentacion) ---

interface Hsl {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function hexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let v = m[1]!;
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sat = clamp(s, 0, 100) / 100;
  const lig = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// Luminosidades de las variantes de subcategoria: siempre claramente mas claras que la
// raiz (que ronda el 60-74%), escalonadas para distinguir subcategorias entre si.
const SUB_LIGHTNESS = [84, 78, 89, 81, 92, 86] as const;

// Color de una subcategoria: mismo tono que su categoria raiz, menos saturado y mas claro.
// El indice (orden de la subcategoria) elige la tonalidad para que hermanas no coincidan.
export function subcategoryShade(parentColor: string | null | undefined, index: number): string {
  const base = (parentColor && hexToHsl(parentColor)) || hexToHsl(ACCENT_COLORS[0]!)!;
  const len = SUB_LIGHTNESS.length;
  const i = ((index % len) + len) % len;
  // Grises (sin saturacion) se quedan grises; el resto baja a un pastel suave.
  const s = base.s < 8 ? base.s : clamp(base.s * 0.8, 30, 70);
  return hslToHex({ h: base.h, s, l: SUB_LIGHTNESS[i]! });
}

// Todas las variantes disponibles para las subcategorias de una raiz (para el selector).
export function subcategoryShades(parentColor: string | null | undefined): string[] {
  return SUB_LIGHTNESS.map((_, i) => subcategoryShade(parentColor, i));
}

// Asignacion completa de paleta pastel a un arbol de categorias ya ordenado: cada raiz
// toma un color de la paleta segun su posicion y sus hijas, variantes de ese color.
// Funcion pura: devuelve id -> color.
export function pastelAssignments(
  tree: readonly { id: string; children: readonly { id: string }[] }[],
): Map<string, string> {
  const out = new Map<string, string>();
  tree.forEach((root, ri) => {
    const rootColor = pickAccentColor(ri);
    out.set(root.id, rootColor);
    root.children.forEach((child, ci) => out.set(child.id, subcategoryShade(rootColor, ci)));
  });
  return out;
}

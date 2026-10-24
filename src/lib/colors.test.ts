import { describe, it, expect } from 'vitest';
import {
  ACCENT_COLORS,
  hexToHsl,
  hslToHex,
  pastelAssignments,
  pickAccentColor,
  subcategoryShade,
  subcategoryShades,
} from './colors';

describe('paleta pastel', () => {
  it('tiene colores unicos y validos', () => {
    expect(new Set(ACCENT_COLORS).size).toBe(ACCENT_COLORS.length);
    for (const c of ACCENT_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('las raices son pastel: ni muy oscuras ni casi blancas', () => {
    for (const c of ACCENT_COLORS) {
      const { l } = hexToHsl(c)!;
      expect(l).toBeGreaterThanOrEqual(55);
      expect(l).toBeLessThanOrEqual(78);
    }
  });

  it('pickAccentColor rota y acepta indices negativos', () => {
    expect(pickAccentColor(0)).toBe(ACCENT_COLORS[0]);
    expect(pickAccentColor(ACCENT_COLORS.length)).toBe(ACCENT_COLORS[0]);
    expect(pickAccentColor(-1)).toBe(ACCENT_COLORS[ACCENT_COLORS.length - 1]);
  });
});

describe('hex <-> hsl', () => {
  it('ida y vuelta conserva el color', () => {
    for (const c of [...ACCENT_COLORS, '#000000', '#ffffff', '#336699']) {
      expect(hslToHex(hexToHsl(c)!)).toBe(c);
    }
  });
  it('acepta formato corto y rechaza basura', () => {
    expect(hslToHex(hexToHsl('#f00')!)).toBe('#ff0000');
    expect(hexToHsl('rojo')).toBeNull();
  });
});

describe('subcategoryShade', () => {
  it('mantiene el tono de la raiz y es mas claro', () => {
    for (const root of ACCENT_COLORS) {
      const r = hexToHsl(root)!;
      for (let i = 0; i < 6; i++) {
        const s = hexToHsl(subcategoryShade(root, i))!;
        expect(Math.abs(s.h - r.h)).toBeLessThan(6);
        expect(s.l).toBeGreaterThan(r.l + 3);
      }
    }
  });

  it('fucsia -> rosa palo', () => {
    const fucsia = ACCENT_COLORS[0]!;
    const sub = hexToHsl(subcategoryShade(fucsia, 0))!;
    expect(sub.h).toBeGreaterThan(320);
    expect(sub.l).toBeGreaterThanOrEqual(80);
  });

  it('las variantes de una misma raiz son distintas entre si', () => {
    const shades = subcategoryShades('#74c0e7');
    expect(new Set(shades).size).toBe(shades.length);
  });

  it('sin color de raiz o con color invalido cae a la primera paleta sin romper', () => {
    expect(subcategoryShade(null, 0)).toMatch(/^#[0-9a-f]{6}$/);
    expect(subcategoryShade('no-hex', 2)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('pastelAssignments', () => {
  it('asigna paleta a raices y variantes a sus hijas', () => {
    const plan = pastelAssignments([
      { id: 'a', children: [{ id: 'a1' }, { id: 'a2' }] },
      { id: 'b', children: [] },
    ]);
    expect(plan.get('a')).toBe(ACCENT_COLORS[0]);
    expect(plan.get('b')).toBe(ACCENT_COLORS[1]);
    expect(plan.get('a1')).toBe(subcategoryShade(ACCENT_COLORS[0], 0));
    expect(plan.get('a2')).toBe(subcategoryShade(ACCENT_COLORS[0], 1));
    expect(plan.size).toBe(4);
  });
});

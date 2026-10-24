import { describe, it, expect, beforeEach } from 'vitest';
import {
  APP_ICONS,
  APP_ICON_STORAGE_KEY,
  DEFAULT_APP_ICON,
  appIconAssets,
  appIconInstallUrl,
  applyAppIconAtBoot,
  getStoredAppIcon,
  isValidAppIcon,
  setAppIcon,
} from './appIcon';

function touchHref(): string | null {
  return document.head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? null;
}

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

describe('iconos de la app', () => {
  it('cada opcion tiene sus archivos en public/icons', () => {
    const files = new Set(
      Object.keys(import.meta.glob('/public/icons/*', { query: '?url' })).map((k) => k.split('/').pop()),
    );
    for (const { id } of APP_ICONS) {
      for (const f of [`${id}.svg`, `${id}-180.png`, `${id}-512.png`]) {
        expect(files.has(f), f).toBe(true);
      }
    }
  });

  it('ids unicos y el por defecto existe', () => {
    expect(new Set(APP_ICONS.map((o) => o.id)).size).toBe(APP_ICONS.length);
    expect(isValidAppIcon(DEFAULT_APP_ICON)).toBe(true);
    expect(isValidAppIcon('inventado')).toBe(false);
    expect(isValidAppIcon(null)).toBe(false);
  });

  it('sin preferencia guardada usa el icono por defecto', () => {
    expect(getStoredAppIcon()).toBe(DEFAULT_APP_ICON);
    localStorage.setItem(APP_ICON_STORAGE_KEY, 'basura');
    expect(getStoredAppIcon()).toBe(DEFAULT_APP_ICON);
  });

  it('setAppIcon guarda y actualiza el apple-touch-icon; rechaza ids invalidos', () => {
    expect(setAppIcon('hucha')).toBe(true);
    expect(getStoredAppIcon()).toBe('hucha');
    expect(touchHref()).toBe(appIconAssets('hucha').touch);
    expect(setAppIcon('../../evil')).toBe(false);
    expect(getStoredAppIcon()).toBe('hucha');
  });

  it('applyAppIconAtBoot adopta ?icono= valido y lo limpia de la URL', () => {
    window.history.replaceState(null, '', '/?icono=donut&x=1');
    expect(applyAppIconAtBoot()).toBe('donut');
    expect(getStoredAppIcon()).toBe('donut');
    expect(window.location.search).toBe('?x=1');
    expect(touchHref()).toBe(appIconAssets('donut').touch);
  });

  it('applyAppIconAtBoot ignora ?icono= invalido y conserva el guardado', () => {
    setAppIcon('euro');
    window.history.replaceState(null, '', '/?icono=nope');
    expect(applyAppIconAtBoot()).toBe('euro');
    expect(window.location.search).toBe('');
  });

  it('el enlace de instalacion lleva el icono y escapa ids raros', () => {
    expect(appIconInstallUrl('barras', 'https://x.test')).toMatch(/^https:\/\/x\.test\/.*\?icono=barras$/);
    expect(appIconInstallUrl('<script>', 'https://x.test')).toMatch(/\?icono=clasico$/);
  });
});

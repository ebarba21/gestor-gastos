// Icono de la app elegido por la persona. Solo presentacion y preferencia de este
// dispositivo (localStorage); sin red ni datos financieros.
//
// Limitacion de iOS: el icono de una web app instalada se fija al pulsar "Anadir a pantalla
// de inicio" (Safari lee el <link rel="apple-touch-icon"> en ese momento) y no se puede
// cambiar despues desde la propia app. Por eso, ademas de guardar la preferencia, se ofrece
// un enlace de instalacion con ?icono=<id>: al abrirlo en Safari, el icono elegido se aplica
// antes de anadir la app a la pantalla de inicio.

export interface AppIconOption {
  id: string;
  name: string;
}

export const APP_ICONS: readonly AppIconOption[] = [
  { id: 'clasico', name: 'Cartera clasica' },
  { id: 'hucha', name: 'Hucha' },
  { id: 'euro', name: 'Moneda' },
  { id: 'barras', name: 'Grafico' },
  { id: 'donut', name: 'Donut' },
  { id: 'cartera', name: 'Cartera coral' },
  { id: 'ticket', name: 'Ticket' },
];

export const DEFAULT_APP_ICON = 'clasico';
export const APP_ICON_STORAGE_KEY = 'gestor-gastos:app-icon';
export const APP_ICON_QUERY_PARAM = 'icono';

export function isValidAppIcon(id: string | null | undefined): id is string {
  return typeof id === 'string' && APP_ICONS.some((o) => o.id === id);
}

function baseUrl(): string {
  return import.meta.env.BASE_URL || '/';
}

// Rutas de los PNG/SVG de un icono (relativas a la base de publicacion).
export function appIconAssets(id: string): { touch: string; large: string; svg: string } {
  const safe = isValidAppIcon(id) ? id : DEFAULT_APP_ICON;
  const b = baseUrl();
  return {
    touch: `${b}icons/${safe}-180.png`,
    large: `${b}icons/${safe}-512.png`,
    svg: `${b}icons/${safe}.svg`,
  };
}

export function getStoredAppIcon(): string {
  try {
    const v = localStorage.getItem(APP_ICON_STORAGE_KEY);
    return isValidAppIcon(v) ? v : DEFAULT_APP_ICON;
  } catch {
    // localStorage no disponible (modo privado): icono por defecto.
    return DEFAULT_APP_ICON;
  }
}

function setLink(rel: string, href: string, type?: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
  if (type) el.type = type;
}

// Aplica el icono a las etiquetas <link> del documento (iOS y pestana del navegador).
export function applyAppIcon(id: string): void {
  const assets = appIconAssets(id);
  setLink('apple-touch-icon', assets.touch);
  setLink('icon', assets.svg, 'image/svg+xml');
}

// Guarda la preferencia y la aplica. Devuelve false si el id no existe.
export function setAppIcon(id: string): boolean {
  if (!isValidAppIcon(id)) return false;
  try {
    localStorage.setItem(APP_ICON_STORAGE_KEY, id);
  } catch {
    // Sin almacenamiento: se aplica igualmente en esta sesion.
  }
  applyAppIcon(id);
  return true;
}

// Al arrancar: si la URL trae ?icono=<id> valido se adopta (y se limpia de la barra de
// direcciones); si no, se aplica el guardado.
export function applyAppIconAtBoot(): string {
  let chosen = getStoredAppIcon();
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get(APP_ICON_QUERY_PARAM);
    if (fromUrl !== null) {
      if (isValidAppIcon(fromUrl)) {
        setAppIcon(fromUrl);
        chosen = fromUrl;
      }
      url.searchParams.delete(APP_ICON_QUERY_PARAM);
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  } catch {
    // URL no parseable: se ignora el parametro.
  }
  applyAppIcon(chosen);
  return chosen;
}

// Enlace para instalar la app con un icono concreto (se abre en Safari).
export function appIconInstallUrl(id: string, origin: string = window.location.origin): string {
  const safe = isValidAppIcon(id) ? id : DEFAULT_APP_ICON;
  return `${origin}${baseUrl()}?${APP_ICON_QUERY_PARAM}=${encodeURIComponent(safe)}`;
}

// La app se esta usando instalada (pantalla de inicio) y no dentro de Safari.
export function isRunningStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  } catch {
    return false;
  }
}

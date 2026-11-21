// Memoria de la entrada manual rapida (noviembre 2026): ultima cuenta usada y categorias
// recientes, por perfil y en este dispositivo (localStorage). Sirve para que apuntar un gasto en
// efectivo o un Bizum sean tres o cuatro toques: importe, categoria reciente, guardar.
// No son datos financieros (solo ids de cuenta y categoria del propio perfil) y no se sincronizan.
const MAX_RECENT = 6;

function key(kind: 'account' | 'categories', profileId: string): string {
  return `gg-quick-${kind}:${profileId}`;
}

function read(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function write(k: string, value: string): void {
  try {
    localStorage.setItem(k, value);
  } catch {
    // Sin persistencia: la entrada rapida sigue funcionando con los valores por defecto.
  }
}

export function lastAccountId(profileId: string): string | null {
  return read(key('account', profileId));
}

export function rememberAccount(profileId: string, accountId: string): void {
  write(key('account', profileId), accountId);
}

export function recentCategoryIds(profileId: string): string[] {
  const raw = read(key('categories', profileId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

// Pone la categoria la primera de la lista (sin duplicados, maximo 6).
export function pushRecentCategory(profileId: string, categoryId: string): string[] {
  const next = [categoryId, ...recentCategoryIds(profileId).filter((id) => id !== categoryId)].slice(0, MAX_RECENT);
  write(key('categories', profileId), JSON.stringify(next));
  return next;
}

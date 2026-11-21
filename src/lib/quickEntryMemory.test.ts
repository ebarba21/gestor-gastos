import { beforeEach, describe, expect, it } from 'vitest';
import { lastAccountId, pushRecentCategory, recentCategoryIds, rememberAccount } from './quickEntryMemory';

beforeEach(() => localStorage.clear());

describe('memoria de la entrada rapida', () => {
  it('recuerda la ultima cuenta por perfil', () => {
    expect(lastAccountId('p1')).toBeNull();
    rememberAccount('p1', 'acc-revolut');
    expect(lastAccountId('p1')).toBe('acc-revolut');
    expect(lastAccountId('p2')).toBeNull(); // aislada por perfil
  });

  it('las categorias recientes van primero, sin repetir y como mucho seis', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) pushRecentCategory('p1', id);
    pushRecentCategory('p1', 'c');
    expect(recentCategoryIds('p1')).toEqual(['c', 'g', 'f', 'e', 'd', 'b']);
    expect(recentCategoryIds('p2')).toEqual([]);
  });

  it('un valor corrupto no rompe nada', () => {
    localStorage.setItem('gg-quick-categories:p1', '{no es json');
    expect(recentCategoryIds('p1')).toEqual([]);
  });
});

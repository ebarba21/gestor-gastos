// Pide al navegador que marque el almacenamiento de la app como PERSISTENTE.
//
// Por que: la app es local-first y sus datos viven en IndexedDB. Sin esta marca, el navegador
// puede borrar ese almacenamiento si falta espacio, y Safari en iPhone aplica ademas limpiezas a
// sitios web que no se abren en un tiempo. Con la app instalada en la pantalla de inicio y el
// almacenamiento marcado como persistente, ese riesgo se reduce al minimo. Aun asi, el backup
// periodico (Exportar) o la sincronizacion con cuenta siguen siendo la copia de seguridad real.
//
// Solo usa APIs locales del navegador (sin red). Nunca lanza: si la API no existe o falla,
// devuelve un estado que la UI puede mostrar.
export type PersistenceState = 'persisted' | 'not-persisted' | 'unsupported';

interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

export async function requestPersistentStorage(
  storage: StorageManagerLike | undefined = typeof navigator !== 'undefined'
    ? navigator.storage
    : undefined,
): Promise<PersistenceState> {
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) {
      return 'persisted';
    }
    return (await storage.persist()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'not-persisted';
  }
}

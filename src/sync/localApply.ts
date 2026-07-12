// Aplicacion de cambios en Dexie desde el motor de sincronizacion (fase 2). Centraliza el acceso
// a la tabla local por entidad y las escrituras que hacen push (confirmar) y pull/reconstruccion
// (aplicar remoto). El mapeo de campos lo garantiza el mapper; aqui solo se escribe.
import type { Table } from 'dexie';
import { db, now } from '../db/index';
import { ENTITY_REGISTRY } from './entityRegistry';
import { fromRow } from './mapper';
import type { SyncEntityType } from '../db/schema';

// Tabla Dexie generica para una entidad sincronizable. Se accede por nombre porque el motor opera
// sobre entidades heterogeneas; `db.table` devuelve Table<any,any> de Dexie. Se acota a esta forma
// (justificacion del tipado laxo local, invariante CLAUDE.md; sin `any`).
type LocalRow = Record<string, unknown>;

function tableFor(entityType: SyncEntityType): Table<LocalRow, string> {
  return db.table(ENTITY_REGISTRY[entityType].localTable) as unknown as Table<LocalRow, string>;
}

export async function localGet(
  entityType: SyncEntityType,
  id: string,
): Promise<LocalRow | undefined> {
  return tableFor(entityType).get(id);
}

// Marca una fila local como sincronizada tras confirmar su mutacion (revision autoritativa del
// servidor). Solo pasa a 'synced' si no quedan mutaciones pendientes de la misma entidad; si las
// hay (edicion secuencial offline), permanece 'pending' hasta enviarlas.
export async function confirmSynced(
  entityType: SyncEntityType,
  id: string,
  revision: number,
  hasMorePending: boolean,
): Promise<void> {
  await tableFor(entityType).update(id, {
    revision,
    lastSyncedAt: now(),
    syncStatus: hasMorePending ? 'pending' : 'synced',
  });
}

// Aplica una fila remota en Dexie (pull/reconstruccion). Sobrescribe la local con la remota,
// incluidos los tombstones (deletedAt se propaga para no resucitar filas borradas). El llamante
// decide si hay conflicto ANTES de llamar (no se sobrescribe una fila local con cambios pendientes).
export async function applyRemote(
  entityType: SyncEntityType,
  remoteRow: Record<string, unknown>,
): Promise<void> {
  const local = fromRow(entityType, remoteRow);
  await tableFor(entityType).put(local);
}

export async function markConflictLocal(
  entityType: SyncEntityType,
  id: string,
): Promise<void> {
  await tableFor(entityType).update(id, { syncStatus: 'conflict' });
}

export async function setLocalSyncStatus(
  entityType: SyncEntityType,
  id: string,
  syncStatus: 'local' | 'pending' | 'synced' | 'conflict',
): Promise<void> {
  await tableFor(entityType).update(id, { syncStatus });
}

// Marca la fila local como borrada logicamente y sincronizada (resolucion keepRemote cuando el
// remoto ya no tiene la fila).
export async function tombstoneLocalSynced(
  entityType: SyncEntityType,
  id: string,
  revision: number,
): Promise<void> {
  await tableFor(entityType).update(id, {
    deletedAt: now(),
    revision,
    syncStatus: 'synced',
    lastSyncedAt: now(),
  });
}

// Sobrescribe la fila local con un objeto ya en forma local (p. ej. resolucion keepRemote).
export async function overwriteLocal(
  entityType: SyncEntityType,
  local: Record<string, unknown>,
): Promise<void> {
  await tableFor(entityType).put(local);
}

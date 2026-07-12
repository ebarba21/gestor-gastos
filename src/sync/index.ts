// Barrel del motor de sincronizacion (fase 2). La UI interactua a traves del SyncProvider y de
// estos simbolos; nunca llama al cliente remoto directamente (local-first).
export { runSync, isSyncRunning } from './syncEngine';
export type { SyncSummary, SyncPhaseProgress, SyncOptions } from './syncEngine';
export type { PushResult } from './pushEngine';
export type { PullResult } from './pullEngine';

export { countPending, listByProfile as listOutboxByProfile } from './outboxRepo';
export {
  listOpen as listOpenConflicts,
  listOpenByUser as listOpenConflictsByUser,
  countOpen as countOpenConflicts,
  getConflict,
} from './conflictsRepo';
export { listPending as listPendingMutations } from './outboxRepo';
export { resolveKeepLocal, resolveKeepRemote, resolveMerged } from './conflictResolver';

export {
  listMigratableProfiles,
  migrateProfile,
  computeLocalCounts,
} from './profileMigration';
export type { MigratableProfile, MigrationProgress } from './profileMigration';

export { hasLocalProfiles, rebuildDevice } from './deviceRebuild';
export type { RebuildProgress, RebuildResult } from './deviceRebuild';

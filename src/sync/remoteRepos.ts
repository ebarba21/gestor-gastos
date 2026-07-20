// Fabrica de repositorios remotos por entidad sincronizable (fase 2). Liga cada entidad a su tabla
// remota y a su modo de aislamiento (la raiz `profiles` no tiene profile_id). El ownerUserId
// proviene SIEMPRE de la sesion, nunca de la UI.
import { createRemoteRepo, type RemoteRepo, type RemoteTableName } from '../remote';
import type { AppSupabaseClient } from '../lib/supabase/client';
import type { SyncEntityType } from '../db/schema';
import { ENTITY_REGISTRY } from './entityRegistry';

export function remoteRepoFor(
  client: AppSupabaseClient,
  userId: string,
  entityType: SyncEntityType,
): RemoteRepo<RemoteTableName> {
  const info = ENTITY_REGISTRY[entityType];
  return createRemoteRepo(client, info.remoteTable, userId, {
    hasProfileId: info.hasProfileId,
  });
}

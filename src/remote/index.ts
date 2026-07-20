// Barrel de la capa de acceso remoto (Supabase). La UI no importa de aqui directamente:
// lee de Dexie (local-first). Esta capa la usara el motor de sincronizacion (fase 2).
export {
  createRemoteRepo,
  buildInsertRow,
  stripOwnershipKeys,
  type RemoteRepo,
  type RemoteTableName,
  type RemoteInsertInput,
  type RemoteUpdateInput,
} from './remoteRepo';
export {
  serializeCents,
  serializeCentsNullable,
  deserializeCents,
  deserializeCentsNullable,
  assertIntegerCents,
} from './cents';
export { RemoteError, toRemoteError, type RemoteErrorCode } from './errors';

// Repositorio remoto generico sobre Supabase (capa `remote/`, ARCHITECTURE seccion 3).
//
// Es la contrapartida remota de los repositorios locales de `src/db/`. Materializa el
// aislamiento por PROPIETARIO + PERFIL en el cliente (DATA_MODEL seccion 23, invariantes 4 y 9
// de CLAUDE.md), aunque la autoridad final es siempre RLS en Postgres:
//   - toda lectura filtra por owner_user_id = usuario de la sesion Y profile_id;
//   - toda insercion FIJA owner_user_id desde la sesion (nunca desde el payload de UI) y el
//     profile_id indicado; el cliente jamas decide el propietario a partir de datos de UI;
//   - toda actualizacion ELIMINA del patch cualquier intento de cambiar owner_user_id,
//     profile_id o id (el propietario es inmutable);
//   - el borrado es LOGICO (deleted_at), coherente con la sincronizacion (fase 2).
//
// Alcance fase 1: es un esqueleto tipado y probado, listo para que la fase 2 (sincronizacion)
// lo use. La UI NO llama aqui directamente: sigue leyendo de Dexie (local-first).

import type { AppSupabaseClient } from '../lib/supabase/client';
import type { Database } from '../lib/supabase/database.types';
import { RemoteError, toRemoteError } from './errors';

type PublicTables = Database['public']['Tables'];
export type RemoteTableName = keyof PublicTables;

type RowOf<T extends RemoteTableName> = PublicTables[T]['Row'];
type InsertOf<T extends RemoteTableName> = PublicTables[T]['Insert'];
type UpdateOf<T extends RemoteTableName> = PublicTables[T]['Update'];

// Campos de propiedad que el repositorio controla y que NUNCA se aceptan desde el payload.
const OWNERSHIP_KEYS = ['owner_user_id', 'profile_id', 'id'] as const;

// Valores de negocio para insertar: el llamante nunca aporta owner_user_id ni profile_id
// (los pone el repositorio); tampoco los campos de sincronizacion que gestiona el servidor.
export type RemoteInsertInput<T extends RemoteTableName> = Omit<
  InsertOf<T>,
  'owner_user_id' | 'profile_id' | 'revision'
>;

// Patch de actualizacion: nunca puede tocar id, owner_user_id ni profile_id.
export type RemoteUpdateInput<T extends RemoteTableName> = Partial<
  Omit<UpdateOf<T>, 'owner_user_id' | 'profile_id' | 'id' | 'revision'>
>;

// Elimina cualquier clave de propiedad de un patch (defensa en profundidad en runtime, no solo
// en tipos). Funcion PURA: se prueba de forma aislada.
export function stripOwnershipKeys<T extends Record<string, unknown>>(patch: T): T {
  const clean = { ...patch };
  for (const key of OWNERSHIP_KEYS) {
    if (key in clean) delete (clean as Record<string, unknown>)[key];
  }
  // El servidor controla la revision; nunca se envia desde el cliente.
  if ('revision' in clean) delete (clean as Record<string, unknown>).revision;
  return clean;
}

// Construye la fila a insertar fijando SIEMPRE owner_user_id (sesion) y profile_id (contexto),
// ignorando cualquier valor de esos campos que viniera en el input. Funcion PURA y probada.
export function buildInsertRow<T extends RemoteTableName>(
  ownerUserId: string,
  profileId: string,
  values: RemoteInsertInput<T>,
): InsertOf<T> {
  const sanitized = stripOwnershipKeys(values as Record<string, unknown>);
  return {
    ...sanitized,
    owner_user_id: ownerUserId,
    profile_id: profileId,
  } as unknown as InsertOf<T>;
}

export interface RemoteRepo<T extends RemoteTableName> {
  list(profileId: string): Promise<RowOf<T>[]>;
  getById(profileId: string, id: string): Promise<RowOf<T> | null>;
  insert(profileId: string, values: RemoteInsertInput<T>): Promise<RowOf<T>>;
  update(profileId: string, id: string, patch: RemoteUpdateInput<T>): Promise<RowOf<T>>;
  softDelete(profileId: string, id: string): Promise<void>;
}

// Interfaz minima del constructor de consultas de PostgREST. Se usa para puentear la
// limitacion de supabase-js con nombres de tabla GENERICOS: su tipado exige que cada columna
// sea demostrablemente de la fila para un T generico, lo que aqui no es posible. En vez de
// `any`, se acota a esta forma (justificacion del tipado laxo local, invariante CLAUDE.md).
interface RemoteResult {
  data: unknown;
  error: unknown;
}
interface RemoteQuery extends PromiseLike<RemoteResult> {
  select(columns?: string): RemoteQuery;
  insert(row: unknown): RemoteQuery;
  update(patch: unknown): RemoteQuery;
  eq(column: string, value: unknown): RemoteQuery;
  is(column: string, value: unknown): RemoteQuery;
  single(): PromiseLike<RemoteResult>;
  maybeSingle(): PromiseLike<RemoteResult>;
}

// Crea un repositorio remoto para una tabla, ligado al usuario autenticado (ownerUserId).
// El ownerUserId proviene de la sesion de Supabase, nunca de la UI.
export function createRemoteRepo<T extends RemoteTableName>(
  client: AppSupabaseClient,
  table: T,
  ownerUserId: string,
): RemoteRepo<T> {
  if (!ownerUserId) {
    throw new RemoteError('REMOTE_AUTH', 'Falta el usuario de la sesion para operar en remoto.');
  }

  // Punto unico donde se acota el tipado del constructor de consultas para una tabla generica.
  const q = (): RemoteQuery => client.from(table) as unknown as RemoteQuery;

  // Filtro base comun a toda consulta de lectura: propietario + perfil + no borrada logicamente.
  const scoped = (profileId: string): RemoteQuery =>
    q()
      .select('*')
      .eq('owner_user_id', ownerUserId)
      .eq('profile_id', profileId)
      .is('deleted_at', null);

  return {
    async list(profileId) {
      const { data, error } = await scoped(profileId);
      if (error) throw toRemoteError(error, 'lectura');
      return (data ?? []) as RowOf<T>[];
    },

    async getById(profileId, id) {
      const { data, error } = await q()
        .select('*')
        .eq('owner_user_id', ownerUserId)
        .eq('profile_id', profileId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw toRemoteError(error, 'lectura');
      return (data ?? null) as RowOf<T> | null;
    },

    async insert(profileId, values) {
      const row = buildInsertRow(ownerUserId, profileId, values);
      const { data, error } = await q().insert(row).select().single();
      if (error) throw toRemoteError(error, 'creacion');
      return data as RowOf<T>;
    },

    async update(profileId, id, patch) {
      const clean = stripOwnershipKeys(patch as Record<string, unknown>);
      const { data, error } = await q()
        .update(clean)
        .eq('owner_user_id', ownerUserId)
        .eq('profile_id', profileId)
        .eq('id', id)
        .select()
        .single();
      if (error) throw toRemoteError(error, 'actualizacion');
      return data as RowOf<T>;
    },

    async softDelete(profileId, id) {
      const { error } = await q()
        .update({ deleted_at: new Date().toISOString() })
        .eq('owner_user_id', ownerUserId)
        .eq('profile_id', profileId)
        .eq('id', id);
      if (error) throw toRemoteError(error, 'borrado');
    },
  };
}

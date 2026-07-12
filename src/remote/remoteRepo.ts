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

  // --- Metodos de SINCRONIZACION (fase 2). `row` es la salida del mapper (columnas de negocio +
  // auditoria en snake_case, sin owner/profile/revision/last_mutation_id). Estos metodos fijan
  // owner_user_id (sesion), profile_id (contexto) y last_mutation_id (mutacion en curso). ---

  // Insert IDEMPOTENTE por PK: upsert con ignoreDuplicates. Devuelve la fila creada, o null si el
  // id ya existia (reejecucion): el llamante releera con getById para conocer la revision.
  upsertInsert(
    profileId: string,
    row: Record<string, unknown>,
    lastMutationId: string,
  ): Promise<RowOf<T> | null>;

  // Update/soft-delete GUARDADO por revision. Aplica la fila solo si revision == baseRevision.
  // Devuelve la fila actualizada, o null si afecto 0 filas (conflicto o reejecucion; lo distingue
  // el motor de push comparando last_mutation_id con getById).
  guardedUpdate(
    profileId: string,
    id: string,
    row: Record<string, unknown>,
    baseRevision: number,
    lastMutationId: string,
  ): Promise<RowOf<T> | null>;

  // Numero de filas vivas del perfil (para validar recuentos de migracion). No cuenta tombstones.
  count(profileId: string): Promise<number>;

  // Descarga cambios: filas con updated_at >= since (INCLUYE tombstones para propagar bajas),
  // ordenadas por updated_at ascendente, hasta `limit`. Cursor de PULL.
  pullSince(profileId: string, sinceIso: string | null, limit: number): Promise<RowOf<T>[]>;
}

// Columnas que nunca se envian en un UPDATE (las controla el servidor o son inmutables). A
// diferencia del insert, tampoco se reescribe created_at.
function buildUpdatePatch(
  row: Record<string, unknown>,
  lastMutationId: string,
): Record<string, unknown> {
  const patch = stripOwnershipKeys(row);
  delete (patch as Record<string, unknown>).created_at;
  (patch as Record<string, unknown>).last_mutation_id = lastMutationId;
  return patch;
}

// Interfaz minima del constructor de consultas de PostgREST. Se usa para puentear la
// limitacion de supabase-js con nombres de tabla GENERICOS: su tipado exige que cada columna
// sea demostrablemente de la fila para un T generico, lo que aqui no es posible. En vez de
// `any`, se acota a esta forma (justificacion del tipado laxo local, invariante CLAUDE.md).
interface RemoteResult {
  data: unknown;
  error: unknown;
  count?: number | null;
}
interface RemoteQuery extends PromiseLike<RemoteResult> {
  select(columns?: string, options?: { count?: 'exact'; head?: boolean }): RemoteQuery;
  insert(row: unknown): RemoteQuery;
  upsert(row: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }): RemoteQuery;
  update(patch: unknown): RemoteQuery;
  eq(column: string, value: unknown): RemoteQuery;
  is(column: string, value: unknown): RemoteQuery;
  gte(column: string, value: unknown): RemoteQuery;
  order(column: string, options?: { ascending?: boolean }): RemoteQuery;
  limit(count: number): RemoteQuery;
  single(): PromiseLike<RemoteResult>;
  maybeSingle(): PromiseLike<RemoteResult>;
}

// Crea un repositorio remoto para una tabla, ligado al usuario autenticado (ownerUserId).
// El ownerUserId proviene de la sesion de Supabase, nunca de la UI.
export interface RemoteRepoOptions {
  // La tabla raiz `profiles` NO tiene columna profile_id: su aislamiento es solo por
  // owner_user_id. Para ella se pasa hasProfileId=false y el parametro profileId se ignora en el
  // filtrado (el id del perfil es su propia PK). Por defecto true (tablas hijas).
  hasProfileId?: boolean;
}

export function createRemoteRepo<T extends RemoteTableName>(
  client: AppSupabaseClient,
  table: T,
  ownerUserId: string,
  options: RemoteRepoOptions = {},
): RemoteRepo<T> {
  if (!ownerUserId) {
    throw new RemoteError('REMOTE_AUTH', 'Falta el usuario de la sesion para operar en remoto.');
  }
  const hasProfileId = options.hasProfileId ?? true;

  // Punto unico donde se acota el tipado del constructor de consultas para una tabla generica.
  const q = (): RemoteQuery => client.from(table) as unknown as RemoteQuery;

  // Aplica el aislamiento por propietario y, para tablas hijas, tambien por perfil.
  const withOwner = (query: RemoteQuery, profileId: string): RemoteQuery => {
    const scopedQuery = query.eq('owner_user_id', ownerUserId);
    return hasProfileId ? scopedQuery.eq('profile_id', profileId) : scopedQuery;
  };

  // Filtro base comun a toda consulta de lectura: propietario (+ perfil) + no borrada logicamente.
  const scoped = (profileId: string): RemoteQuery =>
    withOwner(q().select('*'), profileId).is('deleted_at', null);

  return {
    async list(profileId) {
      const { data, error } = await scoped(profileId);
      if (error) throw toRemoteError(error, 'lectura');
      return (data ?? []) as RowOf<T>[];
    },

    async getById(profileId, id) {
      const { data, error } = await withOwner(q().select('*'), profileId)
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

    async upsertInsert(profileId, row, lastMutationId) {
      // A diferencia de un insert clasico (donde el servidor genera el id), la SINCRONIZACION
      // REUTILIZA el UUID local como PK remota (idempotencia). Por eso se CONSERVA `id` y solo se
      // descartan owner/profile/revision (los fija el servidor o este metodo).
      const clean = { ...row };
      delete clean.owner_user_id;
      delete clean.profile_id;
      delete clean.revision;
      const ownership: Record<string, unknown> = {
        owner_user_id: ownerUserId,
        last_mutation_id: lastMutationId,
      };
      if (hasProfileId) ownership.profile_id = profileId;
      const insertRow = { ...clean, ...ownership };
      const { data, error } = await q()
        .upsert(insertRow, { onConflict: 'id', ignoreDuplicates: true })
        .select();
      if (error) throw toRemoteError(error, 'creacion');
      const rows = (data ?? []) as RowOf<T>[];
      // ignoreDuplicates: la reejecucion de un insert ya aplicado no devuelve fila.
      return rows.length > 0 ? rows[0] : null;
    },

    async guardedUpdate(profileId, id, row, baseRevision, lastMutationId) {
      const patch = buildUpdatePatch(row, lastMutationId);
      const { data, error } = await withOwner(q().update(patch), profileId)
        .eq('id', id)
        .eq('revision', baseRevision)
        .select();
      if (error) throw toRemoteError(error, 'actualizacion');
      const rows = (data ?? []) as RowOf<T>[];
      // 0 filas: revision remota distinta de baseRevision (conflicto) o reejecucion ya aplicada.
      return rows.length > 0 ? rows[0] : null;
    },

    async count(profileId) {
      const { count, error } = await withOwner(
        q().select('id', { count: 'exact', head: true }),
        profileId,
      ).is('deleted_at', null);
      if (error) throw toRemoteError(error, 'recuento');
      return count ?? 0;
    },

    async pullSince(profileId, sinceIso, limit) {
      // Incluye tombstones (no filtra deleted_at) para propagar bajas a este dispositivo.
      let query = withOwner(q().select('*'), profileId);
      if (sinceIso !== null) {
        query = query.gte('updated_at', sinceIso);
      }
      const { data, error } = await query
        .order('updated_at', { ascending: true })
        .limit(limit);
      if (error) throw toRemoteError(error, 'descarga');
      return (data ?? []) as RowOf<T>[];
    },
  };
}

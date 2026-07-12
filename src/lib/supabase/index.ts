// Barrel de la capa de integracion con Supabase.
export {
  getSupabaseClient,
  createSupabaseClient,
  isSupabaseConfigured,
  resetSupabaseClientForTests,
  type AppSupabaseClient,
} from './client';
export {
  resolveSupabaseConfig,
  assertNoServiceRoleInEnv,
  SupabaseConfigError,
  SUPABASE_URL_ENV,
  SUPABASE_PUBLISHABLE_KEY_ENV,
  type SupabaseConfig,
  type SupabaseConfigResult,
} from './env';
export type { Database, Json, Tables, TablesInsert, TablesUpdate } from './database.types';

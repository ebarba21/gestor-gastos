// Tipos de TRANSPORTE de la base remota (Supabase/Postgres). Espejo tipado del esquema
// definido en `supabase/migrations`. Fuente de verdad del esquema: las migraciones SQL.
//
// Convenciones (identicas a las que produce `supabase gen types typescript`):
//   - uuid, text, date, timestamptz -> string
//   - bigint (centimos, revision), integer, smallint -> number
//   - boolean -> boolean
//   - jsonb -> Json
//   - columnas nullables -> `| null`
//   - Insert: las columnas con DEFAULT o nullables son opcionales.
//
// REGENERACION (cuando cambien las migraciones): ver README y `supabase/README.md`.
//   supabase gen types typescript --project-id skwhlbwpnsdgmdsfozcr --schema public > src/lib/supabase/database.types.ts
// Este archivo esta hecho a mano de forma reproducible porque esta sesion no tiene acceso
// al proyecto remoto; al regenerarlo debe coincidir campo a campo con estas migraciones.
//
// Nota de alcance (IMPLEMENTATION_ROADMAP fase 1): se preparan las entidades actuales y los
// campos de sincronizacion/propiedad (owner_user_id, profile_id, created_at, updated_at,
// deleted_at, revision). Las columnas de fases posteriores (comercios, duplicados avanzados,
// recurrencias, deudas) se anadiran en las migraciones de SUS fases, no aqui.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Campos comunes de sincronizacion presentes en toda tabla sincronizable.
interface SyncRow {
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: SyncRow & {
          id: string;
          owner_user_id: string;
          name: string;
          color: string;
          avatar_emoji: string | null;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          name: string;
          color: string;
          avatar_emoji?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          name?: string;
          color?: string;
          avatar_emoji?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Relationships: [];
      };
      settings: {
        Row: SyncRow & {
          id: string;
          owner_user_id: string;
          profile_id: string;
          currency: string;
          locale: string;
          week_start: string;
          default_account_id: string | null;
          encryption_enabled: boolean;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          profile_id: string;
          currency?: string;
          locale: string;
          week_start: string;
          default_account_id?: string | null;
          encryption_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          profile_id?: string;
          currency?: string;
          locale?: string;
          week_start?: string;
          default_account_id?: string | null;
          encryption_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Relationships: [];
      };
      accounts: {
        Row: SyncRow & {
          id: string;
          owner_user_id: string;
          profile_id: string;
          name: string;
          kind: string;
          currency: string;
          color: string | null;
          opening_balance_cents: number;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          profile_id: string;
          name: string;
          kind: string;
          currency: string;
          color?: string | null;
          opening_balance_cents?: number;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          profile_id?: string;
          name?: string;
          kind?: string;
          currency?: string;
          color?: string | null;
          opening_balance_cents?: number;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Relationships: [];
      };
      categories: {
        Row: SyncRow & {
          id: string;
          owner_user_id: string;
          profile_id: string;
          name: string;
          parent_id: string | null;
          kind: string;
          color: string | null;
          icon: string | null;
          archived_at: string | null;
          sort_order: number;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          profile_id: string;
          name: string;
          parent_id?: string | null;
          kind: string;
          color?: string | null;
          icon?: string | null;
          archived_at?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          profile_id?: string;
          name?: string;
          parent_id?: string | null;
          kind?: string;
          color?: string | null;
          icon?: string | null;
          archived_at?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Relationships: [];
      };
      tags: {
        Row: SyncRow & {
          id: string;
          owner_user_id: string;
          profile_id: string;
          name: string;
          color: string | null;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          profile_id: string;
          name: string;
          color?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          profile_id?: string;
          name?: string;
          color?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Relationships: [];
      };
      transactions: {
        Row: SyncRow & {
          id: string;
          owner_user_id: string;
          profile_id: string;
          date: string;
          amount_cents: number;
          type: string;
          concept: string;
          notes: string | null;
          account_id: string;
          category_id: string | null;
          subcategory_id: string | null;
          status: string;
          categorized_by: string;
          rule_id: string | null;
          transfer_group_id: string | null;
          parent_id: string | null;
          is_split_parent: boolean;
          refund_of_id: string | null;
          excluded_from_stats: boolean;
          stats_flag: number;
          import_batch_id: string | null;
          dedupe_hash: string;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          profile_id: string;
          date: string;
          amount_cents: number;
          type: string;
          concept: string;
          notes?: string | null;
          account_id: string;
          category_id?: string | null;
          subcategory_id?: string | null;
          status: string;
          categorized_by: string;
          rule_id?: string | null;
          transfer_group_id?: string | null;
          parent_id?: string | null;
          is_split_parent?: boolean;
          refund_of_id?: string | null;
          excluded_from_stats?: boolean;
          stats_flag?: number;
          import_batch_id?: string | null;
          dedupe_hash: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          profile_id?: string;
          date?: string;
          amount_cents?: number;
          type?: string;
          concept?: string;
          notes?: string | null;
          account_id?: string;
          category_id?: string | null;
          subcategory_id?: string | null;
          status?: string;
          categorized_by?: string;
          rule_id?: string | null;
          transfer_group_id?: string | null;
          parent_id?: string | null;
          is_split_parent?: boolean;
          refund_of_id?: string | null;
          excluded_from_stats?: boolean;
          stats_flag?: number;
          import_batch_id?: string | null;
          dedupe_hash?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Relationships: [];
      };
      transaction_tags: {
        Row: {
          transaction_id: string;
          tag_id: string;
          owner_user_id: string;
          profile_id: string;
          created_at: string;
        };
        Insert: {
          transaction_id: string;
          tag_id: string;
          owner_user_id: string;
          profile_id: string;
          created_at?: string;
        };
        Update: {
          transaction_id?: string;
          tag_id?: string;
          owner_user_id?: string;
          profile_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      rules: {
        Row: SyncRow & {
          id: string;
          owner_user_id: string;
          profile_id: string;
          name: string;
          enabled: boolean;
          priority: number;
          match_mode: string;
          conditions: Json;
          action: Json;
          stop_on_match: boolean;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          profile_id: string;
          name: string;
          enabled?: boolean;
          priority?: number;
          match_mode: string;
          conditions: Json;
          action: Json;
          stop_on_match?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          profile_id?: string;
          name?: string;
          enabled?: boolean;
          priority?: number;
          match_mode?: string;
          conditions?: Json;
          action?: Json;
          stop_on_match?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Relationships: [];
      };
      budgets: {
        Row: SyncRow & {
          id: string;
          owner_user_id: string;
          profile_id: string;
          name: string;
          scope: string;
          scope_id: string | null;
          direction: string;
          limit_cents: number;
          period: string;
          custom_start: string | null;
          custom_end: string | null;
          rollover: boolean;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          profile_id: string;
          name: string;
          scope: string;
          scope_id?: string | null;
          direction: string;
          limit_cents: number;
          period: string;
          custom_start?: string | null;
          custom_end?: string | null;
          rollover?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          profile_id?: string;
          name?: string;
          scope?: string;
          scope_id?: string | null;
          direction?: string;
          limit_cents?: number;
          period?: string;
          custom_start?: string | null;
          custom_end?: string | null;
          rollover?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Relationships: [];
      };
      import_templates: {
        Row: SyncRow & {
          id: string;
          owner_user_id: string;
          profile_id: string;
          name: string;
          source_format: string;
          column_map: Json;
          date_format: string;
          decimal_separator: string;
          thousand_separator: string;
          amount_strategy: string;
          default_account_id: string | null;
          has_header_row: boolean;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          profile_id: string;
          name: string;
          source_format: string;
          column_map: Json;
          date_format: string;
          decimal_separator: string;
          thousand_separator: string;
          amount_strategy: string;
          default_account_id?: string | null;
          has_header_row?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          profile_id?: string;
          name?: string;
          source_format?: string;
          column_map?: Json;
          date_format?: string;
          decimal_separator?: string;
          thousand_separator?: string;
          amount_strategy?: string;
          default_account_id?: string | null;
          has_header_row?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Relationships: [];
      };
      import_batches: {
        Row: SyncRow & {
          id: string;
          owner_user_id: string;
          profile_id: string;
          template_id: string | null;
          file_name: string;
          imported_at: string;
          rows_total: number;
          rows_imported: number;
          rows_skipped_duplicate: number;
          status: string;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          profile_id: string;
          template_id?: string | null;
          file_name: string;
          imported_at: string;
          rows_total?: number;
          rows_imported?: number;
          rows_skipped_duplicate?: number;
          status: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          profile_id?: string;
          template_id?: string | null;
          file_name?: string;
          imported_at?: string;
          rows_total?: number;
          rows_imported?: number;
          rows_skipped_duplicate?: number;
          status?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Relationships: [];
      };
      backup_metadata: {
        Row: SyncRow & {
          id: string;
          owner_user_id: string;
          profile_id: string;
          exported_at: string;
          schema_version: number;
          counts: Json;
          note: string | null;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          profile_id: string;
          exported_at: string;
          schema_version: number;
          counts: Json;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          profile_id?: string;
          exported_at?: string;
          schema_version?: number;
          counts?: Json;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// Atajos de tipo por tabla (transporte). Utiles en la capa remota/mappers.
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];

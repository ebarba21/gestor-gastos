// Tipos de TRANSPORTE de la base remota (Supabase/Postgres). Espejo tipado del esquema
// definido en `supabase/migrations`. Fuente de verdad del esquema: las migraciones SQL.
//
// GENERADO desde el proyecto remoto (no editar a mano). Refleja el esquema ya aplicado por
// las migraciones de `supabase/migrations`. Convenciones estandar de `supabase gen types`:
//   - uuid, text, date, timestamptz -> string
//   - bigint (centimos, revision), integer, smallint -> number
//   - boolean -> boolean; jsonb -> Json; columnas nullables -> `| null`
//   - Insert: columnas con DEFAULT o nullables son opcionales.
//
// REGENERACION (cuando cambien las migraciones): via MCP (generate_typescript_types) o CLI:
//   supabase gen types typescript --project-id skwhlbwpnsdgmdsfozcr --schema public > src/lib/supabase/database.types.ts
//
// Nota de alcance (IMPLEMENTATION_ROADMAP fase 2, fase 4 y fase 5): entidades actuales, campos
// de sincronizacion/propiedad (owner_user_id, profile_id, created_at, updated_at, deleted_at,
// revision), la columna de idempotencia `last_mutation_id`, `transactions.tag_ids` (fuente de
// verdad de las etiquetas; `transaction_tags` es proyeccion derivada), los campos de comercio
// de `transactions` (fase 4: raw_concept, normalized_concept, normalization_version,
// merchant_id, merchant_match_source, merchant_match_confidence) y las tablas
// `merchants`/`merchant_aliases`, y desde fase 5 los metadatos bancarios y huellas de
// duplicados de `transactions` (bank_transaction_id, booking_date, value_date, pending,
// currency, balance_after_cents, bank_reference, operation_type, source_row_hash,
// exact_fingerprint, normalized_fingerprint, fingerprint_version, source_file_hash,
// source_file_size, duplicate_status, duplicate_confidence, duplicate_reason_codes,
// duplicate_candidate_ids, pending_replacement_id), `import_batches.source_file_hash/
// source_file_size/rows_linked` y la tabla `no_duplicate_decisions`. Las columnas de fases
// posteriores (recurrencias, deudas) se anadiran en las migraciones de SUS fases, no aqui.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          archived_at: string | null
          color: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          id: string
          kind: string
          last_mutation_id: string | null
          name: string
          opening_balance_cents: number
          owner_user_id: string
          profile_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          currency: string
          deleted_at?: string | null
          id?: string
          kind: string
          last_mutation_id?: string | null
          name: string
          opening_balance_cents?: number
          owner_user_id: string
          profile_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          id?: string
          kind?: string
          last_mutation_id?: string | null
          name?: string
          opening_balance_cents?: number
          owner_user_id?: string
          profile_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_metadata: {
        Row: {
          counts: Json
          created_at: string
          deleted_at: string | null
          exported_at: string
          id: string
          last_mutation_id: string | null
          note: string | null
          owner_user_id: string
          profile_id: string
          revision: number
          schema_version: number
          updated_at: string
        }
        Insert: {
          counts?: Json
          created_at?: string
          deleted_at?: string | null
          exported_at: string
          id?: string
          last_mutation_id?: string | null
          note?: string | null
          owner_user_id: string
          profile_id: string
          revision?: number
          schema_version: number
          updated_at?: string
        }
        Update: {
          counts?: Json
          created_at?: string
          deleted_at?: string | null
          exported_at?: string
          id?: string
          last_mutation_id?: string | null
          note?: string | null
          owner_user_id?: string
          profile_id?: string
          revision?: number
          schema_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "backup_metadata_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          archived_at: string | null
          created_at: string
          custom_end: string | null
          custom_start: string | null
          deleted_at: string | null
          direction: string
          id: string
          last_mutation_id: string | null
          limit_cents: number
          name: string
          owner_user_id: string
          period: string
          profile_id: string
          revision: number
          rollover: boolean
          scope: string
          scope_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          custom_end?: string | null
          custom_start?: string | null
          deleted_at?: string | null
          direction: string
          id?: string
          last_mutation_id?: string | null
          limit_cents: number
          name: string
          owner_user_id: string
          period: string
          profile_id: string
          revision?: number
          rollover?: boolean
          scope: string
          scope_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          custom_end?: string | null
          custom_start?: string | null
          deleted_at?: string | null
          direction?: string
          id?: string
          last_mutation_id?: string | null
          limit_cents?: number
          name?: string
          owner_user_id?: string
          period?: string
          profile_id?: string
          revision?: number
          rollover?: boolean
          scope?: string
          scope_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          archived_at: string | null
          color: string | null
          created_at: string
          deleted_at: string | null
          icon: string | null
          id: string
          kind: string
          last_mutation_id: string | null
          name: string
          owner_user_id: string
          parent_id: string | null
          profile_id: string
          revision: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          icon?: string | null
          id?: string
          kind: string
          last_mutation_id?: string | null
          name: string
          owner_user_id: string
          parent_id?: string | null
          profile_id: string
          revision?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          icon?: string | null
          id?: string
          kind?: string
          last_mutation_id?: string | null
          name?: string
          owner_user_id?: string
          parent_id?: string | null
          profile_id?: string
          revision?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "categories_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          created_at: string
          deleted_at: string | null
          file_name: string
          id: string
          imported_at: string
          last_mutation_id: string | null
          owner_user_id: string
          profile_id: string
          revision: number
          rows_imported: number
          rows_linked: number
          rows_skipped_duplicate: number
          rows_total: number
          source_file_hash: string | null
          source_file_size: number | null
          status: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          file_name: string
          id?: string
          imported_at: string
          last_mutation_id?: string | null
          owner_user_id: string
          profile_id: string
          revision?: number
          rows_imported?: number
          rows_linked?: number
          rows_skipped_duplicate?: number
          rows_total?: number
          source_file_hash?: string | null
          source_file_size?: number | null
          status: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          file_name?: string
          id?: string
          imported_at?: string
          last_mutation_id?: string | null
          owner_user_id?: string
          profile_id?: string
          revision?: number
          rows_imported?: number
          rows_linked?: number
          rows_skipped_duplicate?: number
          rows_total?: number
          source_file_hash?: string | null
          source_file_size?: number | null
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_template_id_fkey"
            columns: ["template_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "import_templates"
            referencedColumns: ["id", "profile_id"]
          },
        ]
      }
      import_templates: {
        Row: {
          amount_strategy: string
          column_map: Json
          created_at: string
          date_format: string
          decimal_separator: string
          default_account_id: string | null
          deleted_at: string | null
          has_header_row: boolean
          id: string
          last_mutation_id: string | null
          name: string
          owner_user_id: string
          profile_id: string
          revision: number
          source_format: string
          thousand_separator: string
          updated_at: string
        }
        Insert: {
          amount_strategy: string
          column_map?: Json
          created_at?: string
          date_format: string
          decimal_separator: string
          default_account_id?: string | null
          deleted_at?: string | null
          has_header_row?: boolean
          id?: string
          last_mutation_id?: string | null
          name: string
          owner_user_id: string
          profile_id: string
          revision?: number
          source_format: string
          thousand_separator: string
          updated_at?: string
        }
        Update: {
          amount_strategy?: string
          column_map?: Json
          created_at?: string
          date_format?: string
          decimal_separator?: string
          default_account_id?: string | null
          deleted_at?: string | null
          has_header_row?: boolean
          id?: string
          last_mutation_id?: string | null
          name?: string
          owner_user_id?: string
          profile_id?: string
          revision?: number
          source_format?: string
          thousand_separator?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_templates_default_account_id_fkey"
            columns: ["default_account_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "import_templates_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_aliases: {
        Row: {
          created_at: string
          deleted_at: string | null
          enabled: boolean
          id: string
          last_mutation_id: string | null
          match_type: string
          merchant_id: string
          normalized_alias: string
          owner_user_id: string
          priority: number
          profile_id: string
          raw_alias: string
          revision: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          enabled?: boolean
          id?: string
          last_mutation_id?: string | null
          match_type: string
          merchant_id: string
          normalized_alias: string
          owner_user_id: string
          priority?: number
          profile_id: string
          raw_alias: string
          revision?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          enabled?: boolean
          id?: string
          last_mutation_id?: string | null
          match_type?: string
          merchant_id?: string
          normalized_alias?: string
          owner_user_id?: string
          priority?: number
          profile_id?: string
          raw_alias?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_aliases_merchant_fk"
            columns: ["merchant_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "merchant_aliases_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      merchants: {
        Row: {
          archived_at: string | null
          canonical_name: string
          created_at: string
          default_category_id: string | null
          default_subcategory_id: string | null
          default_tag_ids: string[]
          deleted_at: string | null
          id: string
          last_mutation_id: string | null
          normalized_name: string
          notes: string | null
          owner_user_id: string
          profile_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          canonical_name: string
          created_at?: string
          default_category_id?: string | null
          default_subcategory_id?: string | null
          default_tag_ids?: string[]
          deleted_at?: string | null
          id?: string
          last_mutation_id?: string | null
          normalized_name: string
          notes?: string | null
          owner_user_id: string
          profile_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          canonical_name?: string
          created_at?: string
          default_category_id?: string | null
          default_subcategory_id?: string | null
          default_tag_ids?: string[]
          deleted_at?: string | null
          id?: string
          last_mutation_id?: string | null
          normalized_name?: string
          notes?: string | null
          owner_user_id?: string
          profile_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchants_default_category_fk"
            columns: ["default_category_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "merchants_default_subcategory_fk"
            columns: ["default_subcategory_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "merchants_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      no_duplicate_decisions: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          last_mutation_id: string | null
          left_fingerprint: string
          left_tx_id: string | null
          owner_user_id: string
          profile_id: string
          reason: string | null
          revision: number
          right_fingerprint: string
          right_tx_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_mutation_id?: string | null
          left_fingerprint: string
          left_tx_id?: string | null
          owner_user_id: string
          profile_id: string
          reason?: string | null
          revision?: number
          right_fingerprint: string
          right_tx_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_mutation_id?: string | null
          left_fingerprint?: string
          left_tx_id?: string | null
          owner_user_id?: string
          profile_id?: string
          reason?: string | null
          revision?: number
          right_fingerprint?: string
          right_tx_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "no_duplicate_decisions_left_tx_fkey"
            columns: ["left_tx_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "no_duplicate_decisions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "no_duplicate_decisions_right_tx_fkey"
            columns: ["right_tx_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id", "profile_id"]
          },
        ]
      }
      profiles: {
        Row: {
          archived_at: string | null
          avatar_emoji: string | null
          color: string
          created_at: string
          deleted_at: string | null
          id: string
          last_mutation_id: string | null
          name: string
          owner_user_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          avatar_emoji?: string | null
          color: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_mutation_id?: string | null
          name: string
          owner_user_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          avatar_emoji?: string | null
          color?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_mutation_id?: string | null
          name?: string
          owner_user_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      rules: {
        Row: {
          action: Json
          conditions: Json
          created_at: string
          deleted_at: string | null
          enabled: boolean
          id: string
          last_mutation_id: string | null
          match_mode: string
          name: string
          owner_user_id: string
          priority: number
          profile_id: string
          revision: number
          stop_on_match: boolean
          updated_at: string
        }
        Insert: {
          action?: Json
          conditions?: Json
          created_at?: string
          deleted_at?: string | null
          enabled?: boolean
          id?: string
          last_mutation_id?: string | null
          match_mode: string
          name: string
          owner_user_id: string
          priority?: number
          profile_id: string
          revision?: number
          stop_on_match?: boolean
          updated_at?: string
        }
        Update: {
          action?: Json
          conditions?: Json
          created_at?: string
          deleted_at?: string | null
          enabled?: boolean
          id?: string
          last_mutation_id?: string | null
          match_mode?: string
          name?: string
          owner_user_id?: string
          priority?: number
          profile_id?: string
          revision?: number
          stop_on_match?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rules_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          currency: string
          default_account_id: string | null
          deleted_at: string | null
          encryption_enabled: boolean
          id: string
          last_mutation_id: string | null
          locale: string
          owner_user_id: string
          profile_id: string
          revision: number
          updated_at: string
          week_start: string
        }
        Insert: {
          created_at?: string
          currency?: string
          default_account_id?: string | null
          deleted_at?: string | null
          encryption_enabled?: boolean
          id?: string
          last_mutation_id?: string | null
          locale: string
          owner_user_id: string
          profile_id: string
          revision?: number
          updated_at?: string
          week_start: string
        }
        Update: {
          created_at?: string
          currency?: string
          default_account_id?: string | null
          deleted_at?: string | null
          encryption_enabled?: boolean
          id?: string
          last_mutation_id?: string | null
          locale?: string
          owner_user_id?: string
          profile_id?: string
          revision?: number
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_default_account_fk"
            columns: ["default_account_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "settings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          id: string
          last_mutation_id: string | null
          name: string
          owner_user_id: string
          profile_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_mutation_id?: string | null
          name: string
          owner_user_id: string
          profile_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_mutation_id?: string | null
          name?: string
          owner_user_id?: string
          profile_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_tags: {
        Row: {
          created_at: string
          owner_user_id: string
          profile_id: string
          tag_id: string
          transaction_id: string
        }
        Insert: {
          created_at?: string
          owner_user_id: string
          profile_id: string
          tag_id: string
          transaction_id: string
        }
        Update: {
          created_at?: string
          owner_user_id?: string
          profile_id?: string
          tag_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_tags_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_tags_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          amount_cents: number
          balance_after_cents: number | null
          bank_reference: string | null
          bank_transaction_id: string | null
          booking_date: string | null
          categorized_by: string
          category_id: string | null
          concept: string
          created_at: string
          currency: string
          date: string
          dedupe_hash: string
          deleted_at: string | null
          duplicate_candidate_ids: string[]
          duplicate_confidence: number
          duplicate_reason_codes: string[]
          duplicate_status: string
          exact_fingerprint: string
          excluded_from_stats: boolean
          fingerprint_version: number
          id: string
          import_batch_id: string | null
          is_split_parent: boolean
          last_mutation_id: string | null
          merchant_id: string | null
          merchant_match_confidence: number
          merchant_match_source: string
          normalization_version: number
          normalized_concept: string
          normalized_fingerprint: string
          notes: string | null
          operation_type: string | null
          owner_user_id: string
          parent_id: string | null
          pending: boolean
          pending_replacement_id: string | null
          profile_id: string
          raw_concept: string
          refund_of_id: string | null
          revision: number
          rule_id: string | null
          source_file_hash: string | null
          source_file_size: number | null
          source_row_hash: string
          stats_flag: number
          status: string
          subcategory_id: string | null
          tag_ids: string[]
          transfer_group_id: string | null
          type: string
          updated_at: string
          value_date: string | null
        }
        Insert: {
          account_id: string
          amount_cents: number
          balance_after_cents?: number | null
          bank_reference?: string | null
          bank_transaction_id?: string | null
          booking_date?: string | null
          categorized_by: string
          category_id?: string | null
          concept: string
          created_at?: string
          currency?: string
          date: string
          dedupe_hash: string
          deleted_at?: string | null
          duplicate_candidate_ids?: string[]
          duplicate_confidence?: number
          duplicate_reason_codes?: string[]
          duplicate_status?: string
          exact_fingerprint: string
          excluded_from_stats?: boolean
          fingerprint_version?: number
          id?: string
          import_batch_id?: string | null
          is_split_parent?: boolean
          last_mutation_id?: string | null
          merchant_id?: string | null
          merchant_match_confidence?: number
          merchant_match_source?: string
          normalization_version?: number
          normalized_concept: string
          normalized_fingerprint: string
          notes?: string | null
          operation_type?: string | null
          owner_user_id: string
          parent_id?: string | null
          pending?: boolean
          pending_replacement_id?: string | null
          profile_id: string
          raw_concept: string
          refund_of_id?: string | null
          revision?: number
          rule_id?: string | null
          source_file_hash?: string | null
          source_file_size?: number | null
          source_row_hash: string
          stats_flag?: number
          status: string
          subcategory_id?: string | null
          tag_ids?: string[]
          transfer_group_id?: string | null
          type: string
          updated_at?: string
          value_date?: string | null
        }
        Update: {
          account_id?: string
          amount_cents?: number
          balance_after_cents?: number | null
          bank_reference?: string | null
          bank_transaction_id?: string | null
          booking_date?: string | null
          categorized_by?: string
          category_id?: string | null
          concept?: string
          created_at?: string
          currency?: string
          date?: string
          dedupe_hash?: string
          deleted_at?: string | null
          duplicate_candidate_ids?: string[]
          duplicate_confidence?: number
          duplicate_reason_codes?: string[]
          duplicate_status?: string
          exact_fingerprint?: string
          excluded_from_stats?: boolean
          fingerprint_version?: number
          id?: string
          import_batch_id?: string | null
          is_split_parent?: boolean
          last_mutation_id?: string | null
          merchant_id?: string | null
          merchant_match_confidence?: number
          merchant_match_source?: string
          normalization_version?: number
          normalized_concept?: string
          normalized_fingerprint?: string
          notes?: string | null
          operation_type?: string | null
          owner_user_id?: string
          parent_id?: string | null
          pending?: boolean
          pending_replacement_id?: string | null
          profile_id?: string
          raw_concept?: string
          refund_of_id?: string | null
          revision?: number
          rule_id?: string | null
          source_file_hash?: string | null
          source_file_size?: number | null
          source_row_hash?: string
          stats_flag?: number
          status?: string
          subcategory_id?: string | null
          tag_ids?: string[]
          transfer_group_id?: string | null
          type?: string
          updated_at?: string
          value_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "transactions_import_batch_fk"
            columns: ["import_batch_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "transactions_merchant_id_fkey"
            columns: ["merchant_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "transactions_parent_id_fkey"
            columns: ["parent_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "transactions_pending_replacement_fkey"
            columns: ["pending_replacement_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "transactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_refund_of_id_fkey"
            columns: ["refund_of_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "transactions_rule_fk"
            columns: ["rule_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id", "profile_id"]
          },
          {
            foreignKeyName: "transactions_subcategory_id_fkey"
            columns: ["subcategory_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "profile_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      profile_is_owned: { Args: { p_profile_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

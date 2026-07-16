-- Fase 5 (deteccion avanzada de duplicados): metadatos bancarios y huellas versionadas en
-- transactions (DATA_MODEL seccion 15.1, FINANCIAL_ALGORITHMS seccion 5).
--
-- Aditivo, mismo patron que 20260713104020_transactions_merchant_fields.sql: columnas
-- nullable primero, backfill aproximado para no dejar NULL en las columnas que el tipo TS
-- exige no-nulas, y despues NOT NULL/DEFAULT/CHECK. El backfill de source_row_hash/
-- exact_fingerprint/normalized_fingerprint aqui es una aproximacion SQL (md5 de los campos
-- de negocio) SOLO para no dejar la columna NULL entre la migracion de esquema y el primer
-- push; el algoritmo autoritativo y versionado (FNV-1a, src/lib/duplicateFingerprint.ts) vive
-- en el cliente y sincroniza el valor exacto en el siguiente push de cada movimiento existente.
--
-- NUNCA se declara UNIQUE sobre normalized_fingerprint (DATA_MODEL 15.1): dos compras reales
-- identicas en la misma cuenta son legitimas. La unica unicidad remota es
-- (profile_id, account_id, bank_transaction_id) cuando el identificador bancario existe
-- (DATA_MODEL 21.2), implementada como indice unico PARCIAL.

alter table public.transactions
  add column if not exists bank_transaction_id text,
  add column if not exists booking_date date,
  add column if not exists value_date date,
  add column if not exists pending boolean,
  add column if not exists currency text,
  add column if not exists balance_after_cents bigint,
  add column if not exists bank_reference text,
  add column if not exists operation_type text,
  add column if not exists source_row_hash text,
  add column if not exists exact_fingerprint text,
  add column if not exists normalized_fingerprint text,
  add column if not exists fingerprint_version integer,
  add column if not exists source_file_hash text,
  add column if not exists source_file_size bigint,
  add column if not exists duplicate_status text,
  add column if not exists duplicate_confidence integer,
  add column if not exists duplicate_reason_codes text[],
  add column if not exists duplicate_candidate_ids uuid[],
  add column if not exists pending_replacement_id uuid;

update public.transactions
set
  pending = coalesce(pending, false),
  currency = coalesce(currency, 'EUR'),
  source_row_hash = coalesce(source_row_hash, md5(account_id::text || date::text || amount_cents::text || concept)),
  exact_fingerprint = coalesce(exact_fingerprint, md5('exact' || account_id::text || date::text || amount_cents::text || coalesce(currency, 'EUR') || normalized_concept)),
  normalized_fingerprint = coalesce(normalized_fingerprint, md5('norm' || account_id::text || amount_cents::text || coalesce(currency, 'EUR') || coalesce(merchant_id::text, normalized_concept))),
  fingerprint_version = coalesce(fingerprint_version, 1),
  duplicate_status = coalesce(duplicate_status, 'unique'),
  duplicate_confidence = coalesce(duplicate_confidence, 0),
  duplicate_reason_codes = coalesce(duplicate_reason_codes, '{}'::text[]),
  duplicate_candidate_ids = coalesce(duplicate_candidate_ids, '{}'::uuid[])
where pending is null
   or currency is null
   or source_row_hash is null
   or exact_fingerprint is null
   or normalized_fingerprint is null
   or fingerprint_version is null
   or duplicate_status is null
   or duplicate_confidence is null
   or duplicate_reason_codes is null
   or duplicate_candidate_ids is null;

alter table public.transactions
  alter column pending set not null,
  alter column pending set default false,
  alter column currency set not null,
  alter column currency set default 'EUR',
  alter column source_row_hash set not null,
  alter column exact_fingerprint set not null,
  alter column normalized_fingerprint set not null,
  alter column fingerprint_version set not null,
  alter column fingerprint_version set default 1,
  alter column duplicate_status set not null,
  alter column duplicate_status set default 'unique',
  alter column duplicate_confidence set not null,
  alter column duplicate_confidence set default 0,
  alter column duplicate_reason_codes set not null,
  alter column duplicate_reason_codes set default '{}'::text[],
  alter column duplicate_candidate_ids set not null,
  alter column duplicate_candidate_ids set default '{}'::uuid[];

alter table public.transactions
  add constraint transactions_duplicate_status_ck
  check (duplicate_status in ('unique', 'exact', 'strongNormalized', 'possible', 'weak', 'pendingReplaced'));

alter table public.transactions
  add constraint transactions_duplicate_confidence_ck
  check (duplicate_confidence >= 0 and duplicate_confidence <= 1000);

-- pending_replacement_id dentro del mismo perfil (FK compuesta, patron composite_fk_integrity).
-- Se anula si el pendiente sustituido se elimina fisicamente (nunca ocurre por la app: el
-- borrado de un pendiente sustituido es logico, ver undoBatch).
alter table public.transactions
  add constraint transactions_pending_replacement_fkey
  foreign key (pending_replacement_id, profile_id) references public.transactions (id, profile_id)
  on delete set null (pending_replacement_id);

-- Unicidad remota SOLO sobre el identificador bancario, y solo cuando existe (indice unico
-- parcial): dos cuentas distintas pueden reutilizar el mismo identificador de operacion como
-- cadena (DATA_MODEL 21.2), y un movimiento sin identificador bancario nunca colisiona.
create unique index transactions_profile_account_banktx_uk
  on public.transactions (profile_id, account_id, bank_transaction_id)
  where bank_transaction_id is not null;

create index transactions_profile_exact_fp_idx on public.transactions (profile_id, exact_fingerprint);
create index transactions_profile_normalized_fp_idx on public.transactions (profile_id, normalized_fingerprint);
create index transactions_profile_duplicate_status_idx on public.transactions (profile_id, duplicate_status);
create index transactions_pending_replacement_fk_idx on public.transactions (pending_replacement_id);

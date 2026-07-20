-- Fase 6 (bandeja de revision y conciliacion): esquema remoto de ReviewItem y Reconciliation
-- (DATA_MODEL secciones 16-17, FINANCIAL_ALGORITHMS seccion 6).
--
-- Mismo patron que fase 5 (no_duplicate_decisions_schema.sql): owner_user_id + profile_id,
-- columnas de auditoria, revision gestionada por trigger, last_mutation_id desde el origen,
-- unique(id, profile_id) desde la creacion para poder usar FK compuestas. RLS y grants en la
-- migracion siguiente.

-- ---------------------------------------------------------------------------
-- review_items: tarea de revision unificada (DATA_MODEL seccion 16).
-- entity_type/entity_id son POLIMORFICOS (transaction | importBatch | conflict segun type):
-- igual que budgets.scope_id (seccion 2.8), no llevan FK. La coherencia por perfil la valida
-- la app; el aislamiento por propietario lo garantiza RLS via profile_id.
-- ---------------------------------------------------------------------------
create table public.review_items (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references auth.users (id) on delete cascade,
  profile_id       uuid not null references public.profiles (id) on delete cascade,
  type             text not null check (type in (
                     'uncategorized', 'lowConfidenceRule', 'possibleDuplicate',
                     'transferCandidate', 'refundCandidate', 'stalePending',
                     'newMerchant', 'importError', 'syncConflict', 'recurringAnomaly'
                   )),
  entity_type      text not null check (entity_type in ('transaction', 'importBatch', 'conflict')),
  entity_id        uuid not null,
  confidence       integer not null default 0 check (confidence >= 0 and confidence <= 1000),
  reason_codes     text[] not null default '{}',
  metadata         jsonb not null default '{}',
  status           text not null default 'open' check (status in ('open', 'snoozed', 'resolved', 'dismissed')),
  resolution       text,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  revision         bigint not null default 0 check (revision >= 0),
  last_mutation_id uuid,
  unique (id, profile_id)
);

create index review_items_owner_profile_idx on public.review_items (owner_user_id, profile_id);
create index review_items_profile_status_idx on public.review_items (profile_id, status);
create index review_items_profile_type_idx on public.review_items (profile_id, type);
create index review_items_profile_entity_idx on public.review_items (profile_id, entity_type, entity_id);
create index review_items_profile_updated_idx on public.review_items (profile_id, updated_at);

-- Idempotencia (defensa en profundidad; la app comprueba antes de crear): como mucho una tarea
-- ABIERTA por (perfil, tipo, entidad). No bloquea reabrir tras resolver/descartar.
create unique index review_items_open_dedup_uk on public.review_items (profile_id, type, entity_id)
  where status = 'open' and deleted_at is null;

create trigger review_items_set_updated_at before update on public.review_items
  for each row execute function public.tg_set_updated_at();
create trigger review_items_bump_revision before update on public.review_items
  for each row execute function public.tg_bump_revision();
create trigger review_items_init_revision before insert on public.review_items
  for each row execute function public.tg_init_revision();
create trigger review_items_lock_ownership before update on public.review_items
  for each row execute function public.tg_lock_ownership();

-- ---------------------------------------------------------------------------
-- reconciliations: conciliacion bancaria por cuenta (DATA_MODEL seccion 17,
-- FINANCIAL_ALGORITHMS seccion 6).
-- ---------------------------------------------------------------------------
create table public.reconciliations (
  id                       uuid primary key default gen_random_uuid(),
  owner_user_id            uuid not null references auth.users (id) on delete cascade,
  profile_id               uuid not null references public.profiles (id) on delete cascade,
  account_id               uuid not null,
  statement_date           date not null,
  statement_balance_cents  bigint not null,
  computed_balance_cents   bigint not null,
  difference_cents         bigint not null,
  status                   text not null check (status in ('balanced', 'discrepancy', 'acceptedWithDifference')),
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  revision                 bigint not null default 0 check (revision >= 0),
  last_mutation_id         uuid,
  unique (id, profile_id)
);

-- FK compuesta (account_id, profile_id) dentro del mismo perfil (patron composite_fk_integrity).
-- Sin ON DELETE SET NULL: igual que transactions.account_id, una cuenta con conciliaciones no se
-- borra sin resolver antes (regla de producto, DATA_MODEL seccion 2.3).
alter table public.reconciliations
  add constraint reconciliations_account_id_fkey
  foreign key (account_id, profile_id) references public.accounts (id, profile_id);

create index reconciliations_owner_profile_idx on public.reconciliations (owner_user_id, profile_id);
create index reconciliations_profile_account_idx on public.reconciliations (profile_id, account_id);
create index reconciliations_profile_statement_date_idx on public.reconciliations (profile_id, statement_date);
create index reconciliations_profile_updated_idx on public.reconciliations (profile_id, updated_at);
create index reconciliations_account_id_fk_idx on public.reconciliations (account_id);

create trigger reconciliations_set_updated_at before update on public.reconciliations
  for each row execute function public.tg_set_updated_at();
create trigger reconciliations_bump_revision before update on public.reconciliations
  for each row execute function public.tg_bump_revision();
create trigger reconciliations_init_revision before insert on public.reconciliations
  for each row execute function public.tg_init_revision();
create trigger reconciliations_lock_ownership before update on public.reconciliations
  for each row execute function public.tg_lock_ownership();

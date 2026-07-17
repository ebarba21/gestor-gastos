-- Fase 7 (recurrencias y forecast): esquema remoto de RecurringSeries y RecurringOccurrence
-- (DATA_MODEL secciones 18, 21-23; FINANCIAL_ALGORITHMS seccion 7).
--
-- Mismo patron que fase 6 (review_items_and_reconciliations_schema.sql): owner_user_id +
-- profile_id, columnas de auditoria, revision gestionada por trigger, last_mutation_id desde el
-- origen, unique(id, profile_id) desde la creacion para poder usar FK compuestas. RLS y grants
-- en la migracion siguiente.

-- ---------------------------------------------------------------------------
-- recurring_series: serie recurrente detectada o confirmada (DATA_MODEL 18.1).
-- merchant_id es OPCIONAL (una serie puede detectarse solo por concepto normalizado, sin
-- comercio asociado): FK compuesta (merchant_id, profile_id) nullable, MATCH SIMPLE (Postgres
-- por defecto) no la exige cuando merchant_id es null.
-- ---------------------------------------------------------------------------
create table public.recurring_series (
  id                      uuid primary key default gen_random_uuid(),
  owner_user_id           uuid not null references auth.users (id) on delete cascade,
  profile_id              uuid not null references public.profiles (id) on delete cascade,
  merchant_id             uuid,
  name                    text not null check (char_length(name) >= 1 and char_length(name) <= 160),
  direction               text not null check (direction in ('expense', 'income')),
  frequency               text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  "interval"              integer not null default 1 check ("interval" >= 1),
  expected_amount_cents   bigint not null,
  amount_tolerance_cents  bigint not null default 0 check (amount_tolerance_cents >= 0),
  amount_tolerance_ppm    bigint not null default 0 check (amount_tolerance_ppm >= 0),
  expected_day_of_week    integer check (expected_day_of_week >= 0 and expected_day_of_week <= 6),
  expected_day_of_month   integer check (expected_day_of_month >= 1 and expected_day_of_month <= 31),
  date_tolerance_days     integer not null default 0 check (date_tolerance_days >= 0),
  next_expected_date      date,
  status                  text not null default 'candidate' check (status in (
                            'candidate', 'active', 'paused', 'possiblyCancelled', 'cancelled'
                          )),
  confidence              integer not null default 0 check (confidence >= 0 and confidence <= 1000),
  detection_version       integer not null default 1 check (detection_version >= 1),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,
  revision                bigint not null default 0 check (revision >= 0),
  last_mutation_id        uuid,
  unique (id, profile_id)
);

alter table public.recurring_series
  add constraint recurring_series_merchant_id_fkey
  foreign key (merchant_id, profile_id) references public.merchants (id, profile_id);

create index recurring_series_owner_profile_idx on public.recurring_series (owner_user_id, profile_id);
create index recurring_series_profile_status_idx on public.recurring_series (profile_id, status);
create index recurring_series_profile_merchant_idx on public.recurring_series (profile_id, merchant_id);
create index recurring_series_profile_updated_idx on public.recurring_series (profile_id, updated_at);
create index recurring_series_merchant_id_fk_idx on public.recurring_series (merchant_id);

create trigger recurring_series_set_updated_at before update on public.recurring_series
  for each row execute function public.tg_set_updated_at();
create trigger recurring_series_bump_revision before update on public.recurring_series
  for each row execute function public.tg_bump_revision();
create trigger recurring_series_init_revision before insert on public.recurring_series
  for each row execute function public.tg_init_revision();
create trigger recurring_series_lock_ownership before update on public.recurring_series
  for each row execute function public.tg_lock_ownership();

-- ---------------------------------------------------------------------------
-- recurring_occurrences: ocurrencia esperada de una serie (DATA_MODEL 18.2). series_id es
-- obligatoria (FK compuesta NOT NULL); transaction_id es OPCIONAL (una ocurrencia puede no
-- tener movimiento vinculado aun: 'expected', 'missing', 'skipped', 'manuallyCompleted').
-- ---------------------------------------------------------------------------
create table public.recurring_occurrences (
  id                      uuid primary key default gen_random_uuid(),
  owner_user_id           uuid not null references auth.users (id) on delete cascade,
  profile_id              uuid not null references public.profiles (id) on delete cascade,
  series_id               uuid not null,
  transaction_id          uuid,
  expected_date           date not null,
  expected_amount_cents   bigint not null,
  status                  text not null default 'expected' check (status in (
                            'expected', 'matched', 'missing', 'skipped', 'manuallyCompleted'
                          )),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,
  revision                bigint not null default 0 check (revision >= 0),
  last_mutation_id        uuid,
  unique (id, profile_id)
);

alter table public.recurring_occurrences
  add constraint recurring_occurrences_series_id_fkey
  foreign key (series_id, profile_id) references public.recurring_series (id, profile_id) on delete cascade;

alter table public.recurring_occurrences
  add constraint recurring_occurrences_transaction_id_fkey
  foreign key (transaction_id, profile_id) references public.transactions (id, profile_id);

create index recurring_occurrences_owner_profile_idx on public.recurring_occurrences (owner_user_id, profile_id);
create index recurring_occurrences_profile_series_idx on public.recurring_occurrences (profile_id, series_id);
create index recurring_occurrences_profile_status_idx on public.recurring_occurrences (profile_id, status);
create index recurring_occurrences_profile_expected_date_idx on public.recurring_occurrences (profile_id, expected_date);
create index recurring_occurrences_profile_updated_idx on public.recurring_occurrences (profile_id, updated_at);
create index recurring_occurrences_series_id_fk_idx on public.recurring_occurrences (series_id);
create index recurring_occurrences_transaction_id_fk_idx on public.recurring_occurrences (transaction_id);

-- Idempotencia (defensa en profundidad; la app comprueba antes de crear): como mucho una
-- ocurrencia por (serie, fecha esperada) viva.
create unique index recurring_occurrences_series_date_uk on public.recurring_occurrences (series_id, expected_date)
  where deleted_at is null;

create trigger recurring_occurrences_set_updated_at before update on public.recurring_occurrences
  for each row execute function public.tg_set_updated_at();
create trigger recurring_occurrences_bump_revision before update on public.recurring_occurrences
  for each row execute function public.tg_bump_revision();
create trigger recurring_occurrences_init_revision before insert on public.recurring_occurrences
  for each row execute function public.tg_init_revision();
create trigger recurring_occurrences_lock_ownership before update on public.recurring_occurrences
  for each row execute function public.tg_lock_ownership();

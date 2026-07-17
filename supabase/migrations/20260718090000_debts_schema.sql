-- Fase 8 (deudas): esquema remoto de Debt, DebtPayment y DebtScenario (DATA_MODEL seccion 19,
-- 21-23; FINANCIAL_ALGORITHMS secciones 8-9). No es asesoramiento financiero personalizado.
--
-- Mismo patron que fase 7 (recurring_series_and_occurrences_schema.sql): owner_user_id +
-- profile_id, columnas de auditoria, revision gestionada por trigger, last_mutation_id desde el
-- origen, unique(id, profile_id) desde la creacion para poder usar FK compuestas. RLS y grants
-- en la migracion siguiente.

-- ---------------------------------------------------------------------------
-- debts: deuda registrada (DATA_MODEL 19.1). linked_account_id / linked_category_id son
-- OPCIONALES: FK compuestas nullable, MATCH SIMPLE (Postgres por defecto) no las exige cuando
-- son null. `type='card'` (revolving) se registra igual que el resto; el calendario de
-- amortizacion queda fuera de alcance de esta fase a nivel de aplicacion (FINANCIAL_ALGORITHMS
-- 8.1), no se modela como restriccion de base de datos.
-- ---------------------------------------------------------------------------
create table public.debts (
  id                            uuid primary key default gen_random_uuid(),
  owner_user_id                 uuid not null references auth.users (id) on delete cascade,
  profile_id                    uuid not null references public.profiles (id) on delete cascade,
  name                          text not null check (char_length(name) >= 1 and char_length(name) <= 160),
  type                          text not null check (type in ('personalLoan', 'mortgageFixed', 'card', 'other')),
  currency                      text not null default 'EUR' check (char_length(currency) = 3),
  original_principal_cents      bigint not null check (original_principal_cents >= 0),
  outstanding_principal_cents   bigint not null check (outstanding_principal_cents >= 0),
  annual_rate_ppm                bigint not null check (annual_rate_ppm >= 0),
  minimum_payment_cents         bigint not null check (minimum_payment_cents >= 0),
  payment_frequency             text not null default 'monthly' check (payment_frequency in ('monthly')),
  next_payment_date             date,
  remaining_term_months         integer check (remaining_term_months >= 0),
  linked_account_id             uuid,
  linked_category_id            uuid,
  status                        text not null default 'active' check (status in ('active', 'paidOff', 'archived')),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  deleted_at                    timestamptz,
  revision                      bigint not null default 0 check (revision >= 0),
  last_mutation_id              uuid,
  unique (id, profile_id)
);

alter table public.debts
  add constraint debts_linked_account_id_fkey
  foreign key (linked_account_id, profile_id) references public.accounts (id, profile_id);

alter table public.debts
  add constraint debts_linked_category_id_fkey
  foreign key (linked_category_id, profile_id) references public.categories (id, profile_id);

create index debts_owner_profile_idx on public.debts (owner_user_id, profile_id);
create index debts_profile_status_idx on public.debts (profile_id, status);
create index debts_profile_updated_idx on public.debts (profile_id, updated_at);
create index debts_linked_account_id_fk_idx on public.debts (linked_account_id);
create index debts_linked_category_id_fk_idx on public.debts (linked_category_id);

create trigger debts_set_updated_at before update on public.debts
  for each row execute function public.tg_set_updated_at();
create trigger debts_bump_revision before update on public.debts
  for each row execute function public.tg_bump_revision();
create trigger debts_init_revision before insert on public.debts
  for each row execute function public.tg_init_revision();
create trigger debts_lock_ownership before update on public.debts
  for each row execute function public.tg_lock_ownership();

-- ---------------------------------------------------------------------------
-- debt_payments: pago registrado sobre una deuda (DATA_MODEL 19.2). debt_id es obligatoria (FK
-- compuesta NOT NULL, on delete cascade: borrar una deuda borra sus pagos). transaction_id es
-- OPCIONAL (un pago puede registrarse sin vincular movimiento). Invariante de magnitudes
-- positivas: total = principal + interes + comisiones (evita doble conteo y reduccion de
-- pasivo mal contabilizada, ver comentario de columna en el modelo local).
-- ---------------------------------------------------------------------------
create table public.debt_payments (
  id                      uuid primary key default gen_random_uuid(),
  owner_user_id           uuid not null references auth.users (id) on delete cascade,
  profile_id              uuid not null references public.profiles (id) on delete cascade,
  debt_id                 uuid not null,
  date                    date not null,
  total_cents             bigint not null check (total_cents >= 0),
  principal_cents         bigint not null check (principal_cents >= 0),
  interest_cents          bigint not null check (interest_cents >= 0),
  fees_cents              bigint not null check (fees_cents >= 0),
  extra_principal_cents   bigint not null default 0 check (extra_principal_cents >= 0),
  transaction_id          uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,
  revision                bigint not null default 0 check (revision >= 0),
  last_mutation_id        uuid,
  unique (id, profile_id),
  constraint debt_payments_total_matches_parts check (total_cents = principal_cents + interest_cents + fees_cents),
  constraint debt_payments_extra_within_principal check (extra_principal_cents <= principal_cents)
);

alter table public.debt_payments
  add constraint debt_payments_debt_id_fkey
  foreign key (debt_id, profile_id) references public.debts (id, profile_id) on delete cascade;

alter table public.debt_payments
  add constraint debt_payments_transaction_id_fkey
  foreign key (transaction_id, profile_id) references public.transactions (id, profile_id);

create index debt_payments_owner_profile_idx on public.debt_payments (owner_user_id, profile_id);
create index debt_payments_profile_debt_idx on public.debt_payments (profile_id, debt_id);
create index debt_payments_profile_date_idx on public.debt_payments (profile_id, date);
create index debt_payments_profile_updated_idx on public.debt_payments (profile_id, updated_at);
create index debt_payments_debt_id_fk_idx on public.debt_payments (debt_id);
create index debt_payments_transaction_id_fk_idx on public.debt_payments (transaction_id);

create trigger debt_payments_set_updated_at before update on public.debt_payments
  for each row execute function public.tg_set_updated_at();
create trigger debt_payments_bump_revision before update on public.debt_payments
  for each row execute function public.tg_bump_revision();
create trigger debt_payments_init_revision before insert on public.debt_payments
  for each row execute function public.tg_init_revision();
create trigger debt_payments_lock_ownership before update on public.debt_payments
  for each row execute function public.tg_lock_ownership();

-- ---------------------------------------------------------------------------
-- debt_scenarios: simulacion guardada (DATA_MODEL 19.3). NUNCA modifica deudas reales.
-- one_time_extra_payments es un array embebido (ExtraPayment[]), no una tabla propia: un
-- escenario es una fotografia de simulacion, no relaciones vivas. source_revision es la suma de
-- las `revision` de las deudas incluidas al calcular; si el agregado actual difiere, el
-- escenario esta desactualizado (lo detecta la app, no una restriccion de base de datos, porque
-- depende de que subconjunto de deudas participo).
-- ---------------------------------------------------------------------------
create table public.debt_scenarios (
  id                          uuid primary key default gen_random_uuid(),
  owner_user_id               uuid not null references auth.users (id) on delete cascade,
  profile_id                  uuid not null references public.profiles (id) on delete cascade,
  name                        text not null check (char_length(name) >= 1 and char_length(name) <= 160),
  strategy                    text not null check (strategy in ('baseline', 'snowball', 'avalanche', 'custom')),
  recurring_extra_cents       bigint not null default 0 check (recurring_extra_cents >= 0),
  one_time_extra_payments     jsonb not null default '[]'::jsonb,
  calculation_version         integer not null check (calculation_version >= 1),
  source_revision             bigint not null default 0 check (source_revision >= 0),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,
  revision                    bigint not null default 0 check (revision >= 0),
  last_mutation_id            uuid,
  unique (id, profile_id)
);

create index debt_scenarios_owner_profile_idx on public.debt_scenarios (owner_user_id, profile_id);
create index debt_scenarios_profile_strategy_idx on public.debt_scenarios (profile_id, strategy);
create index debt_scenarios_profile_updated_idx on public.debt_scenarios (profile_id, updated_at);

create trigger debt_scenarios_set_updated_at before update on public.debt_scenarios
  for each row execute function public.tg_set_updated_at();
create trigger debt_scenarios_bump_revision before update on public.debt_scenarios
  for each row execute function public.tg_bump_revision();
create trigger debt_scenarios_init_revision before insert on public.debt_scenarios
  for each row execute function public.tg_init_revision();
create trigger debt_scenarios_lock_ownership before update on public.debt_scenarios
  for each row execute function public.tg_lock_ownership();

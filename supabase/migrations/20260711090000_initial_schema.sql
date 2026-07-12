-- Fase 1: esquema remoto inicial (Supabase/Postgres).
--
-- Representa las entidades LOCALES vigentes (ver specs/DATA_MODEL.md secciones 1 a 8) y deja
-- preparados los campos de sincronizacion y propiedad de la ampliacion (seccion 9 y 22):
-- owner_user_id, profile_id, created_at, updated_at, deleted_at, revision.
--
-- Decisiones de modelado (fuente de verdad: DATA_MODEL.md):
--   - Dinero en centimos como BIGINT (nunca floats).
--   - Splits, transferencias y reembolsos se representan como columnas/auto-referencias de
--     `transactions` (parent_id, transfer_group_id, refund_of_id), NO como tablas aparte
--     (DATA_MODEL 6.1-6.3). Las condiciones/acciones de reglas son objetos embebidos jsonb
--     (DATA_MODEL 2.7: "objeto embebido, no tabla").
--   - Las relaciones de etiquetas se normalizan en `transaction_tags` (join table).
--   - Las columnas de fases posteriores (comercios, duplicados avanzados, recurrencias,
--     deudas) se anadiran en las migraciones de SUS fases (IMPLEMENTATION_ROADMAP).
--
-- RLS y grants: se activan en la migracion siguiente (20260711090100_rls_and_grants.sql).
-- Aqui NO se conceden privilegios a ningun rol todavia: sin esa migracion, ni authenticated
-- ni anon acceden (la exposicion automatica de tablas esta desactivada en el proyecto).
--
-- Deuda anotada para fases posteriores (no bloquea fase 1; sin fuga entre usuarios):
--   - Integridad entre perfiles del MISMO usuario en las FKs (account_id, category_id, etc.):
--     las FKs referencian por PK sin exigir mismo profile_id. Se cerrara en la fase 2 (sync)
--     con FK compuesta (id, profile_id) o validacion en el motor de sincronizacion.
--   - Cifrado de la sesion persistida: llega en la fase 3 (PIN + AES-GCM). Hasta entonces el
--     SDK guarda la sesion sin cifrar (deuda de seguridad conocida y documentada).

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Funciones auxiliares (triggers y autorizacion)
-- ---------------------------------------------------------------------------

-- Mantiene updated_at = now() en cada UPDATE.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Incrementa revision en cada UPDATE. El cliente NUNCA fija revision de forma autoritativa
-- (DATA_MODEL 9, CLOUD_SYNC_SECURITY 4): es el servidor quien la controla.
create or replace function public.tg_bump_revision()
returns trigger
language plpgsql
as $$
begin
  new.revision := coalesce(old.revision, 0) + 1;
  return new;
end;
$$;

-- Fuerza revision = 0 en cada INSERT: una fila nueva arranca sin revisiones, ignorando
-- cualquier valor que el cliente intente inyectar (el servidor controla la revision).
create or replace function public.tg_init_revision()
returns trigger
language plpgsql
as $$
begin
  new.revision := 0;
  return new;
end;
$$;

-- Inmutabilidad de la propiedad en UPDATE (ultima linea de defensa en el servidor). El
-- cliente ya no envia estos campos (remoteRepo los elimina del patch), pero RLS no basta:
-- su WITH CHECK permitiria mover una fila a otro perfil DEL MISMO usuario. Este trigger lo
-- impide a nivel de base: ni owner_user_id ni profile_id pueden cambiar tras crear la fila
-- (invariantes 4 y 9 de CLAUDE.md verificados tambien en RLS/servidor). Para tablas hijas.
create or replace function public.tg_lock_ownership()
returns trigger
language plpgsql
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'owner_user_id es inmutable' using errcode = '42501';
  end if;
  if new.profile_id is distinct from old.profile_id then
    raise exception 'profile_id es inmutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Variante para la tabla raiz `profiles`, que no tiene profile_id: solo bloquea el cambio de
-- propietario (defensa en profundidad; RLS ya lo impide en su WITH CHECK).
create or replace function public.tg_lock_owner()
returns trigger
language plpgsql
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'owner_user_id es inmutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Autorizacion por pertenencia de perfil. Devuelve true si el perfil pertenece al usuario
-- autenticado. SECURITY INVOKER (por defecto) para que la RLS de `profiles` siga aplicando:
-- un usuario solo "ve" sus propios perfiles, asi que EXISTS solo casa con perfiles propios.
-- Se usa en el WITH CHECK/USING de las tablas hijas para impedir adjuntar filas a un
-- profile_id ajeno (CLOUD_SYNC_SECURITY seccion 4).
create or replace function public.profile_is_owned(p_profile_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = p_profile_id
      and pr.owner_user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- profiles (raiz de propiedad). owner_user_id -> auth.users.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  color         text not null,
  avatar_emoji  text,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  revision      bigint not null default 0 check (revision >= 0)
);
create index profiles_owner_idx on public.profiles (owner_user_id);
create index profiles_owner_updated_idx on public.profiles (owner_user_id, updated_at);

-- ---------------------------------------------------------------------------
-- settings (1:1 con profile)
-- ---------------------------------------------------------------------------
create table public.settings (
  id                 uuid primary key default gen_random_uuid(),
  owner_user_id      uuid not null references auth.users (id) on delete cascade,
  profile_id         uuid not null references public.profiles (id) on delete cascade,
  currency           text not null default 'EUR',
  locale             text not null,
  week_start         text not null check (week_start in ('monday', 'sunday')),
  default_account_id uuid,
  encryption_enabled boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  revision           bigint not null default 0 check (revision >= 0),
  unique (profile_id)
);
create index settings_owner_profile_idx on public.settings (owner_user_id, profile_id);

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
create table public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  owner_user_id         uuid not null references auth.users (id) on delete cascade,
  profile_id            uuid not null references public.profiles (id) on delete cascade,
  name                  text not null,
  kind                  text not null check (kind in ('bank', 'card', 'cash', 'wallet', 'shared', 'other')),
  currency              text not null,
  color                 text,
  opening_balance_cents bigint not null default 0,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  revision              bigint not null default 0 check (revision >= 0)
);
create index accounts_owner_profile_idx on public.accounts (owner_user_id, profile_id);
create index accounts_profile_kind_idx on public.accounts (profile_id, kind);

-- settings.default_account_id -> accounts (opcional). Se define despues de accounts.
alter table public.settings
  add constraint settings_default_account_fk
  foreign key (default_account_id) references public.accounts (id) on delete set null;

-- ---------------------------------------------------------------------------
-- categories (subcategorias = categoria con parent_id; un solo nivel en el MVP)
-- ---------------------------------------------------------------------------
create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  name          text not null,
  parent_id     uuid references public.categories (id) on delete set null,
  kind          text not null check (kind in ('expense', 'income', 'both')),
  color         text,
  icon          text,
  archived_at   timestamptz,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  revision      bigint not null default 0 check (revision >= 0)
);
create index categories_owner_profile_idx on public.categories (owner_user_id, profile_id);
create index categories_profile_parent_idx on public.categories (profile_id, parent_id);
create index categories_profile_kind_idx on public.categories (profile_id, kind);

-- ---------------------------------------------------------------------------
-- tags (nombre unico por perfil)
-- ---------------------------------------------------------------------------
create table public.tags (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  name          text not null,
  color         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  revision      bigint not null default 0 check (revision >= 0),
  unique (profile_id, name)
);
create index tags_owner_profile_idx on public.tags (owner_user_id, profile_id);

-- ---------------------------------------------------------------------------
-- transactions (entidad central; incluye splits/transferencias/reembolsos por auto-ref)
-- ---------------------------------------------------------------------------
create table public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  owner_user_id       uuid not null references auth.users (id) on delete cascade,
  profile_id          uuid not null references public.profiles (id) on delete cascade,
  date                date not null,
  amount_cents        bigint not null,
  type                text not null check (type in ('expense', 'income', 'transfer')),
  concept             text not null,
  notes               text,
  account_id          uuid not null references public.accounts (id),
  category_id         uuid references public.categories (id) on delete set null,
  subcategory_id      uuid references public.categories (id) on delete set null,
  status              text not null check (status in ('cleared', 'pending', 'reconciled')),
  categorized_by      text not null check (categorized_by in ('manual', 'rule', 'import', 'none')),
  rule_id             uuid,
  transfer_group_id   uuid,
  parent_id           uuid references public.transactions (id) on delete set null,
  is_split_parent     boolean not null default false,
  refund_of_id        uuid references public.transactions (id) on delete set null,
  excluded_from_stats boolean not null default false,
  stats_flag          smallint not null default 0 check (stats_flag in (0, 1)),
  import_batch_id     uuid,
  dedupe_hash         text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  revision            bigint not null default 0 check (revision >= 0),
  -- Coherencia signo/tipo (DATA_MODEL 2.6): gasto no positivo, ingreso no negativo,
  -- transferencia segun pata (cualquier signo).
  constraint transactions_amount_sign_ck check (
    (type = 'expense' and amount_cents <= 0)
    or (type = 'income' and amount_cents >= 0)
    or (type = 'transfer')
  ),
  -- Coherencia categorizacion por regla (DATA_MODEL 2.6): rule <-> rule_id no nulo.
  constraint transactions_rule_link_ck check (
    (categorized_by = 'rule' and rule_id is not null)
    or (categorized_by <> 'rule' and rule_id is null)
  )
);
create index transactions_owner_profile_idx on public.transactions (owner_user_id, profile_id);
create index transactions_profile_date_idx on public.transactions (profile_id, date);
create index transactions_profile_account_idx on public.transactions (profile_id, account_id);
create index transactions_profile_category_idx on public.transactions (profile_id, category_id);
create index transactions_profile_type_idx on public.transactions (profile_id, type);
create index transactions_profile_statsflag_idx on public.transactions (profile_id, stats_flag);
create index transactions_profile_transfergroup_idx on public.transactions (profile_id, transfer_group_id);
create index transactions_profile_parent_idx on public.transactions (profile_id, parent_id);
create index transactions_profile_refund_idx on public.transactions (profile_id, refund_of_id);
create index transactions_profile_batch_idx on public.transactions (profile_id, import_batch_id);
create index transactions_profile_dedupe_idx on public.transactions (profile_id, dedupe_hash);

-- ---------------------------------------------------------------------------
-- transaction_tags (relacion N:M movimiento <-> etiqueta)
-- ---------------------------------------------------------------------------
create table public.transaction_tags (
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  tag_id         uuid not null references public.tags (id) on delete cascade,
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (transaction_id, tag_id)
);
create index transaction_tags_owner_profile_idx on public.transaction_tags (owner_user_id, profile_id);
create index transaction_tags_tag_idx on public.transaction_tags (tag_id);

-- ---------------------------------------------------------------------------
-- rules (condiciones y accion embebidas como jsonb)
-- ---------------------------------------------------------------------------
create table public.rules (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  name          text not null,
  enabled       boolean not null default true,
  priority      integer not null default 0,
  match_mode    text not null check (match_mode in ('all', 'any')),
  conditions    jsonb not null default '[]'::jsonb,
  action        jsonb not null default '{}'::jsonb,
  stop_on_match boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  revision      bigint not null default 0 check (revision >= 0)
);
create index rules_owner_profile_idx on public.rules (owner_user_id, profile_id);
create index rules_profile_enabled_idx on public.rules (profile_id, enabled);
create index rules_profile_priority_idx on public.rules (profile_id, priority);

-- transactions.rule_id -> rules (opcional). Se define despues de rules.
alter table public.transactions
  add constraint transactions_rule_fk
  foreign key (rule_id) references public.rules (id) on delete set null;

-- ---------------------------------------------------------------------------
-- budgets (presupuestos / metas). scope_id es polimorfico (categoria o cuenta): sin FK.
-- ---------------------------------------------------------------------------
create table public.budgets (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  name          text not null,
  scope         text not null check (scope in ('category', 'subcategory', 'account', 'overall')),
  scope_id      uuid,
  direction     text not null check (direction in ('expense', 'income')),
  limit_cents   bigint not null,
  period        text not null check (period in ('monthly', 'quarterly', 'yearly', 'custom')),
  custom_start  date,
  custom_end    date,
  rollover      boolean not null default false,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  revision      bigint not null default 0 check (revision >= 0)
);
create index budgets_owner_profile_idx on public.budgets (owner_user_id, profile_id);
create index budgets_profile_scope_idx on public.budgets (profile_id, scope);

-- ---------------------------------------------------------------------------
-- import_templates (mapeo de columnas embebido como jsonb)
-- ---------------------------------------------------------------------------
create table public.import_templates (
  id                 uuid primary key default gen_random_uuid(),
  owner_user_id      uuid not null references auth.users (id) on delete cascade,
  profile_id         uuid not null references public.profiles (id) on delete cascade,
  name               text not null,
  source_format      text not null check (source_format in ('csv', 'xlsx')),
  column_map         jsonb not null default '{}'::jsonb,
  date_format        text not null,
  decimal_separator  text not null check (decimal_separator in (',', '.')),
  thousand_separator text not null check (thousand_separator in (',', '.', '')),
  amount_strategy    text not null check (amount_strategy in ('signed', 'debitCredit')),
  default_account_id uuid references public.accounts (id) on delete set null,
  has_header_row     boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  revision           bigint not null default 0 check (revision >= 0)
);
create index import_templates_owner_profile_idx on public.import_templates (owner_user_id, profile_id);
create index import_templates_profile_name_idx on public.import_templates (profile_id, name);

-- ---------------------------------------------------------------------------
-- import_batches (lotes de importacion)
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id                     uuid primary key default gen_random_uuid(),
  owner_user_id          uuid not null references auth.users (id) on delete cascade,
  profile_id             uuid not null references public.profiles (id) on delete cascade,
  template_id            uuid references public.import_templates (id) on delete set null,
  file_name              text not null,
  imported_at            timestamptz not null,
  rows_total             integer not null default 0,
  rows_imported          integer not null default 0,
  rows_skipped_duplicate integer not null default 0,
  status                 text not null check (status in ('committed', 'undone')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  revision               bigint not null default 0 check (revision >= 0)
);
create index import_batches_owner_profile_idx on public.import_batches (owner_user_id, profile_id);
create index import_batches_profile_imported_idx on public.import_batches (profile_id, imported_at);
create index import_batches_profile_status_idx on public.import_batches (profile_id, status);

-- transactions.import_batch_id -> import_batches (opcional). Se define despues.
alter table public.transactions
  add constraint transactions_import_batch_fk
  foreign key (import_batch_id) references public.import_batches (id) on delete set null;

-- ---------------------------------------------------------------------------
-- backup_metadata (metadatos de backup; NUNCA contiene datos financieros ni secretos)
-- ---------------------------------------------------------------------------
create table public.backup_metadata (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  exported_at    timestamptz not null,
  schema_version integer not null,
  counts         jsonb not null default '{}'::jsonb,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  revision       bigint not null default 0 check (revision >= 0)
);
create index backup_metadata_owner_profile_idx on public.backup_metadata (owner_user_id, profile_id);

-- ---------------------------------------------------------------------------
-- Triggers de updated_at y revision en todas las tablas sincronizables
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  syncable text[] := array[
    'profiles', 'settings', 'accounts', 'categories', 'tags', 'transactions',
    'rules', 'budgets', 'import_templates', 'import_batches', 'backup_metadata'
  ];
begin
  foreach t in array syncable loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.tg_set_updated_at()',
      t || '_set_updated_at', t
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.tg_bump_revision()',
      t || '_bump_revision', t
    );
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.tg_init_revision()',
      t || '_init_revision', t
    );
    -- Bloqueo de propiedad en UPDATE: profiles (raiz) solo owner; hijas owner + profile.
    if t = 'profiles' then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.tg_lock_owner()',
        t || '_lock_owner', t
      );
    else
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.tg_lock_ownership()',
        t || '_lock_ownership', t
      );
    end if;
  end loop;

  -- transaction_tags (join, sin revision/updated_at) tambien fija propietario inmutable.
  execute 'create trigger transaction_tags_lock_ownership before update on public.transaction_tags '
    || 'for each row execute function public.tg_lock_ownership()';
end;
$$;

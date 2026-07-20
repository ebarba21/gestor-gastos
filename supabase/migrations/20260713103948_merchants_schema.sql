-- Fase 4 (comercios normalizados): esquema remoto de Merchant y MerchantAlias.
--
-- Reconocer que conceptos bancarios distintos ("AMZN Mktp ES", "AMAZON EU", "Amazon.es*1234")
-- corresponden al mismo comercio, sin perder el texto original (DATA_MODEL seccion 14).
--
-- Mismo patron que las tablas de fase 1-2 (initial_schema + composite_fk_integrity +
-- sync_last_mutation_id + advisors_hardening ya aplicados): owner_user_id + profile_id,
-- columnas de auditoria, revision gestionada por trigger, last_mutation_id desde el origen
-- (no hace falta una migracion de seguimiento aparte), unique(id, profile_id) desde la
-- creacion para poder usar FK compuestas en cuanto haga falta.
--
-- RLS y grants llegan en la migracion siguiente (20260713090100), igual que en fase 1.

-- ---------------------------------------------------------------------------
-- merchants
-- ---------------------------------------------------------------------------
create table public.merchants (
  id                     uuid primary key default gen_random_uuid(),
  owner_user_id          uuid not null references auth.users (id) on delete cascade,
  profile_id             uuid not null references public.profiles (id) on delete cascade,
  canonical_name         text not null check (char_length(canonical_name) between 1 and 120),
  normalized_name        text not null,
  default_category_id    uuid,
  default_subcategory_id uuid,
  default_tag_ids        uuid[] not null default '{}'::uuid[],
  notes                  text,
  archived_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  revision               bigint not null default 0 check (revision >= 0),
  last_mutation_id       uuid,
  unique (id, profile_id)
);
create index merchants_owner_profile_idx on public.merchants (owner_user_id, profile_id);
create index merchants_profile_normalized_idx on public.merchants (profile_id, normalized_name);
create index merchants_profile_archived_idx on public.merchants (profile_id, archived_at);
create index merchants_profile_updated_idx on public.merchants (profile_id, updated_at);

-- default_category_id / default_subcategory_id dentro del mismo perfil (integridad compuesta
-- desde el origen, coherente con composite_fk_integrity para el resto de entidades).
alter table public.merchants
  add constraint merchants_default_category_fk
  foreign key (default_category_id, profile_id) references public.categories (id, profile_id)
  on delete set null (default_category_id);
alter table public.merchants
  add constraint merchants_default_subcategory_fk
  foreign key (default_subcategory_id, profile_id) references public.categories (id, profile_id)
  on delete set null (default_subcategory_id);

-- ---------------------------------------------------------------------------
-- merchant_aliases
-- ---------------------------------------------------------------------------
create table public.merchant_aliases (
  id                uuid primary key default gen_random_uuid(),
  owner_user_id     uuid not null references auth.users (id) on delete cascade,
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  merchant_id       uuid not null,
  raw_alias         text not null check (char_length(raw_alias) between 1 and 200),
  normalized_alias  text not null,
  match_type        text not null check (match_type in ('exact', 'contains', 'startsWith', 'regex')),
  priority          integer not null default 0,
  enabled           boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  revision          bigint not null default 0 check (revision >= 0),
  last_mutation_id  uuid,
  unique (id, profile_id),
  constraint merchant_aliases_merchant_fk
    foreign key (merchant_id, profile_id) references public.merchants (id, profile_id)
    on delete cascade
);
create index merchant_aliases_owner_profile_idx on public.merchant_aliases (owner_user_id, profile_id);
create index merchant_aliases_profile_merchant_idx on public.merchant_aliases (profile_id, merchant_id);
create index merchant_aliases_profile_normalized_idx on public.merchant_aliases (profile_id, normalized_alias);
create index merchant_aliases_profile_enabled_idx on public.merchant_aliases (profile_id, enabled);
create index merchant_aliases_profile_updated_idx on public.merchant_aliases (profile_id, updated_at);

-- ---------------------------------------------------------------------------
-- Triggers de auditoria (mismo patron que initial_schema + advisors_hardening: search_path
-- vacio, revision gestionada por el servidor, propiedad inmutable).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  syncable text[] := array['merchants', 'merchant_aliases'];
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
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.tg_lock_ownership()',
      t || '_lock_ownership', t
    );
  end loop;
end;
$$;

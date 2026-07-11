-- Fase 1 (seguimiento): hardening a partir de los asesores de seguridad y rendimiento de
-- Supabase sobre el esquema ya aplicado. No cambia el modelo de datos ni la autorizacion;
-- solo endurece funciones y optimiza la evaluacion de RLS.
--
-- Hallazgos abordados:
--   - function_search_path_mutable (WARN): fija search_path en las 5 funciones de trigger.
--   - auth_rls_initplan (WARN): envuelve auth.uid() en (select auth.uid()) para que Postgres
--     lo evalue UNA vez por consulta en vez de por fila (mejor a escala).
--   - unindexed_foreign_keys (INFO): indices de cobertura para las FKs auto-referenciadas y
--     de plantilla (aceleran los ON DELETE SET NULL cuando hay volumen).
-- Se ignoran unused_index (esperado en base vacia) por no ser accionable.

-- ---------------------------------------------------------------------------
-- 1. search_path explicito en las funciones de trigger (create or replace conserva los
--    triggers ya asociados). Los cuerpos no referencian objetos sin cualificar, asi que
--    search_path = '' es seguro (now(), coalesce viven en pg_catalog).
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.tg_bump_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.revision := coalesce(old.revision, 0) + 1;
  return new;
end;
$$;

create or replace function public.tg_init_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.revision := 0;
  return new;
end;
$$;

create or replace function public.tg_lock_ownership()
returns trigger
language plpgsql
set search_path = ''
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

create or replace function public.tg_lock_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'owner_user_id es inmutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- profile_is_owned ya tenia search_path = ''. Se envuelve auth.uid() en (select ...) para que
-- se evalue una vez por consulta tambien dentro de la funcion.
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
      and pr.owner_user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. RLS: envolver auth.uid() en (select auth.uid()) en todas las politicas (auth_rls_initplan).
--    Se usa ALTER POLICY para reescribir las expresiones sin recrear las politicas.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  child_tables text[] := array[
    'settings', 'accounts', 'categories', 'tags', 'transactions',
    'rules', 'budgets', 'import_templates', 'import_batches', 'backup_metadata'
  ];
begin
  foreach t in array child_tables loop
    execute format(
      'alter policy %1$I_select on public.%1$I using (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id))',
      t
    );
    execute format(
      'alter policy %1$I_insert on public.%1$I with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id))',
      t
    );
    execute format(
      'alter policy %1$I_update on public.%1$I using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id))',
      t
    );
  end loop;
end;
$$;

alter policy profiles_select on public.profiles
  using (owner_user_id = (select auth.uid()));
alter policy profiles_insert on public.profiles
  with check (owner_user_id = (select auth.uid()));
alter policy profiles_update on public.profiles
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

alter policy transaction_tags_select on public.transaction_tags
  using (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));
alter policy transaction_tags_insert on public.transaction_tags
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));
alter policy transaction_tags_update on public.transaction_tags
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

-- ---------------------------------------------------------------------------
-- 3. Indices de cobertura para las FKs auto-referenciadas y de plantilla (unindexed_foreign_keys).
--    Aceleran la resolucion de ON DELETE SET NULL cuando hay muchos movimientos/categorias.
-- ---------------------------------------------------------------------------
create index if not exists transactions_subcategory_fk_idx on public.transactions (subcategory_id);
create index if not exists transactions_parent_fk_idx on public.transactions (parent_id);
create index if not exists transactions_refund_fk_idx on public.transactions (refund_of_id);
create index if not exists categories_parent_fk_idx on public.categories (parent_id);
create index if not exists import_batches_template_fk_idx on public.import_batches (template_id);

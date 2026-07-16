-- Fase 5 (deteccion avanzada de duplicados): esquema remoto de NoDuplicateDecision
-- (DATA_MODEL seccion 15.2). Recuerda que una pareja concreta de movimientos NO es duplicado,
-- para que el motor no vuelva a proponerla salvo cambio relevante (huellas distintas).
--
-- Mismo patron que fase 4 (merchants_schema.sql): owner_user_id + profile_id, columnas de
-- auditoria, revision gestionada por trigger, last_mutation_id desde el origen, unique(id,
-- profile_id) desde la creacion para poder usar FK compuestas. RLS y grants en la migracion
-- siguiente.
--
-- left_fingerprint/right_fingerprint son hashes de contenido (no ids): identifican la pareja
-- aunque los movimientos concretos cambien de id al remapear un backup. left_tx_id/
-- right_tx_id son referencias opcionales a los movimientos concretos que originaron la
-- decision (solo trazabilidad; se anulan si el movimiento se borra fisicamente, lo que nunca
-- ocurre por la app salvo cascada de perfil/usuario).

create table public.no_duplicate_decisions (
  id                uuid primary key default gen_random_uuid(),
  owner_user_id     uuid not null references auth.users (id) on delete cascade,
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  left_fingerprint  text not null,
  right_fingerprint text not null,
  left_tx_id        uuid,
  right_tx_id       uuid,
  reason            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  revision          bigint not null default 0 check (revision >= 0),
  last_mutation_id  uuid,
  unique (id, profile_id)
);
create index no_duplicate_decisions_owner_profile_idx on public.no_duplicate_decisions (owner_user_id, profile_id);
create index no_duplicate_decisions_profile_left_fp_idx on public.no_duplicate_decisions (profile_id, left_fingerprint);
create index no_duplicate_decisions_profile_right_fp_idx on public.no_duplicate_decisions (profile_id, right_fingerprint);
create index no_duplicate_decisions_profile_updated_idx on public.no_duplicate_decisions (profile_id, updated_at);

-- Referencias opcionales a movimientos concretos, dentro del mismo perfil (FK compuesta,
-- patron composite_fk_integrity). Se anulan si el movimiento se borra (no se pierde la
-- decision: las huellas siguen siendo la fuente de verdad de la pareja).
alter table public.no_duplicate_decisions
  add constraint no_duplicate_decisions_left_tx_fkey
  foreign key (left_tx_id, profile_id) references public.transactions (id, profile_id)
  on delete set null (left_tx_id);
alter table public.no_duplicate_decisions
  add constraint no_duplicate_decisions_right_tx_fkey
  foreign key (right_tx_id, profile_id) references public.transactions (id, profile_id)
  on delete set null (right_tx_id);

create index no_duplicate_decisions_left_tx_fk_idx on public.no_duplicate_decisions (left_tx_id);
create index no_duplicate_decisions_right_tx_fk_idx on public.no_duplicate_decisions (right_tx_id);

-- Triggers de auditoria (mismo patron que initial_schema + advisors_hardening: search_path
-- vacio, revision gestionada por el servidor, propiedad inmutable).
create trigger no_duplicate_decisions_set_updated_at before update on public.no_duplicate_decisions
  for each row execute function public.tg_set_updated_at();
create trigger no_duplicate_decisions_bump_revision before update on public.no_duplicate_decisions
  for each row execute function public.tg_bump_revision();
create trigger no_duplicate_decisions_init_revision before insert on public.no_duplicate_decisions
  for each row execute function public.tg_init_revision();
create trigger no_duplicate_decisions_lock_ownership before update on public.no_duplicate_decisions
  for each row execute function public.tg_lock_ownership();

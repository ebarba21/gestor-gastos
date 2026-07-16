-- Fase 5: RLS y privilegios de no_duplicate_decisions.
--
-- Mismo modelo de autorizacion que el resto de tablas hijas (rls_and_grants +
-- advisors_hardening + merchants_rls_and_grants ya aplicados): solo authenticated, sin DELETE
-- fisico (borrado logico via deleted_at), doble comprobacion owner_user_id +
-- profile_is_owned(profile_id) tanto en USING como en WITH CHECK, y auth.uid() envuelto en
-- (select ...) desde el origen (hardening de auth_rls_initplan aplicado desde la creacion).

revoke all on table public.no_duplicate_decisions from public;
revoke all on table public.no_duplicate_decisions from anon;
grant select, insert, update on table public.no_duplicate_decisions to authenticated;
alter table public.no_duplicate_decisions enable row level security;

create policy no_duplicate_decisions_select on public.no_duplicate_decisions
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy no_duplicate_decisions_insert on public.no_duplicate_decisions
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy no_duplicate_decisions_update on public.no_duplicate_decisions
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

-- Sin politica DELETE: borrado logico via UPDATE de deleted_at.

-- Fase 6: RLS y privilegios de review_items y reconciliations.
--
-- Mismo modelo de autorizacion que el resto de tablas hijas (rls_and_grants + advisors_hardening
-- + merchants_rls_and_grants + no_duplicate_decisions_rls_and_grants ya aplicados): solo
-- authenticated, sin DELETE fisico (borrado logico via deleted_at), doble comprobacion
-- owner_user_id + profile_is_owned(profile_id) tanto en USING como en WITH CHECK, y auth.uid()
-- envuelto en (select ...) desde el origen (hardening de auth_rls_initplan aplicado desde la
-- creacion).

revoke all on table public.review_items from public;
revoke all on table public.review_items from anon;
grant select, insert, update on table public.review_items to authenticated;
alter table public.review_items enable row level security;

create policy review_items_select on public.review_items
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy review_items_insert on public.review_items
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy review_items_update on public.review_items
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

-- Sin politica DELETE: borrado logico via UPDATE de deleted_at.

revoke all on table public.reconciliations from public;
revoke all on table public.reconciliations from anon;
grant select, insert, update on table public.reconciliations to authenticated;
alter table public.reconciliations enable row level security;

create policy reconciliations_select on public.reconciliations
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy reconciliations_insert on public.reconciliations
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy reconciliations_update on public.reconciliations
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

-- Sin politica DELETE: borrado logico via UPDATE de deleted_at.

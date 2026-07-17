-- Fase 7: RLS y privilegios de recurring_series y recurring_occurrences.
--
-- Mismo modelo de autorizacion que el resto de tablas hijas (review_items_and_reconciliations_
-- rls_and_grants ya aplicado): solo authenticated, sin DELETE fisico (borrado logico via
-- deleted_at), doble comprobacion owner_user_id + profile_is_owned(profile_id) tanto en USING
-- como en WITH CHECK, y auth.uid() envuelto en (select ...) desde el origen (hardening de
-- auth_rls_initplan aplicado desde la creacion).

revoke all on table public.recurring_series from public;
revoke all on table public.recurring_series from anon;
grant select, insert, update on table public.recurring_series to authenticated;
alter table public.recurring_series enable row level security;

create policy recurring_series_select on public.recurring_series
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy recurring_series_insert on public.recurring_series
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy recurring_series_update on public.recurring_series
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

-- Sin politica DELETE: borrado logico via UPDATE de deleted_at.

revoke all on table public.recurring_occurrences from public;
revoke all on table public.recurring_occurrences from anon;
grant select, insert, update on table public.recurring_occurrences to authenticated;
alter table public.recurring_occurrences enable row level security;

create policy recurring_occurrences_select on public.recurring_occurrences
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy recurring_occurrences_insert on public.recurring_occurrences
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy recurring_occurrences_update on public.recurring_occurrences
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

-- Sin politica DELETE: borrado logico via UPDATE de deleted_at.

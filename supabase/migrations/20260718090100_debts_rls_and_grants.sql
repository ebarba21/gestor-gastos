-- Fase 8: RLS y privilegios de debts, debt_payments y debt_scenarios.
--
-- Mismo modelo de autorizacion que el resto de tablas hijas (recurring_series_and_occurrences_
-- rls_and_grants ya aplicado): solo authenticated, sin DELETE fisico (borrado logico via
-- deleted_at), doble comprobacion owner_user_id + profile_is_owned(profile_id) tanto en USING
-- como en WITH CHECK, y auth.uid() envuelto en (select ...) desde el origen (hardening de
-- auth_rls_initplan aplicado desde la creacion).

revoke all on table public.debts from public;
revoke all on table public.debts from anon;
grant select, insert, update on table public.debts to authenticated;
alter table public.debts enable row level security;

create policy debts_select on public.debts
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy debts_insert on public.debts
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy debts_update on public.debts
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

-- Sin politica DELETE: borrado logico via UPDATE de deleted_at.

revoke all on table public.debt_payments from public;
revoke all on table public.debt_payments from anon;
grant select, insert, update on table public.debt_payments to authenticated;
alter table public.debt_payments enable row level security;

create policy debt_payments_select on public.debt_payments
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy debt_payments_insert on public.debt_payments
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy debt_payments_update on public.debt_payments
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

-- Sin politica DELETE: borrado logico via UPDATE de deleted_at.

revoke all on table public.debt_scenarios from public;
revoke all on table public.debt_scenarios from anon;
grant select, insert, update on table public.debt_scenarios to authenticated;
alter table public.debt_scenarios enable row level security;

create policy debt_scenarios_select on public.debt_scenarios
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy debt_scenarios_insert on public.debt_scenarios
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

create policy debt_scenarios_update on public.debt_scenarios
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));

-- Sin politica DELETE: borrado logico via UPDATE de deleted_at.

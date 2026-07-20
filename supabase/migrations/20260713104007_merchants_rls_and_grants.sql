-- Fase 4 (comercios normalizados): RLS y privilegios de merchants / merchant_aliases.
--
-- Mismo modelo de autorizacion que el resto de tablas hijas (rls_and_grants +
-- advisors_hardening ya aplicados): solo authenticated, sin DELETE fisico (borrado logico via
-- deleted_at), doble comprobacion owner_user_id + profile_is_owned(profile_id) tanto en USING
-- como en WITH CHECK, y auth.uid() envuelto en (select ...) desde el origen (ya con el
-- hardening de auth_rls_initplan aplicado, no hace falta una migracion de seguimiento).

grant usage on schema public to authenticated;

do $$
declare
  t text;
  child_tables text[] := array['merchants', 'merchant_aliases'];
begin
  foreach t in array child_tables loop
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
    execute format('alter table public.%I enable row level security', t);

    execute format($p$
      create policy %1$I_select on public.%1$I
        for select to authenticated
        using (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));
    $p$, t);

    execute format($p$
      create policy %1$I_insert on public.%1$I
        for insert to authenticated
        with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));
    $p$, t);

    execute format($p$
      create policy %1$I_update on public.%1$I
        for update to authenticated
        using (owner_user_id = (select auth.uid()))
        with check (owner_user_id = (select auth.uid()) and public.profile_is_owned(profile_id));
    $p$, t);
    -- Sin politica DELETE: borrado logico via UPDATE de deleted_at.
  end loop;
end;
$$;

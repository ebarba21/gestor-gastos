-- Fase 1: Row Level Security y privilegios.
--
-- Modelo de autorizacion (CLAUDE.md invariantes 4, 8, 9; CLOUD_SYNC_SECURITY seccion 4):
--   - RLS activa en TODAS las tablas financieras. Politicas explicitas por operacion.
--   - Un usuario solo lee/escribe filas cuyo owner_user_id = auth.uid().
--   - El propietario es INMUTABLE: el WITH CHECK de UPDATE exige que siga siendo auth.uid(),
--     asi nadie puede regalar ni robar una fila cambiando el propietario.
--   - Las tablas hijas verifican ADEMAS que profile_id pertenezca al usuario (profile_is_owned),
--     tanto en el USING de lectura como en el WITH CHECK de escritura: sin esa comprobacion un
--     cliente podria adjuntar una fila a un perfil ajeno aunque el SELECT lo ocultara.
--   - anon (usuario anonimo) NO recibe ningun privilegio: no lee ni escribe nada.
--   - Como la exposicion automatica de tablas esta desactivada, los privilegios se conceden
--     EXPLICITAMENTE solo a authenticated (no se depende de default privileges).
--   - Borrado LOGICO: no se concede DELETE fisico. Las bajas se hacen con UPDATE de
--     deleted_at (CLOUD_SYNC_SECURITY seccion 6, invariantes 10-11): nunca borrado fisico de
--     entidades sincronizables mientras otros dispositivos puedan reintroducirlas. El borrado
--     fisico definitivo ocurre solo en cascada al eliminar el usuario (auth.users).

-- ---------------------------------------------------------------------------
-- Privilegios: solo authenticated, sin DELETE. Revocacion explicita para anon y public.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;

do $$
declare
  t text;
  all_tables text[] := array[
    'profiles', 'settings', 'accounts', 'categories', 'tags', 'transactions',
    'transaction_tags', 'rules', 'budgets', 'import_templates', 'import_batches',
    'backup_metadata'
  ];
begin
  foreach t in array all_tables loop
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- La funcion de autorizacion solo la ejecuta authenticated (no anon ni public).
revoke all on function public.profile_is_owned(uuid) from public;
grant execute on function public.profile_is_owned(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- profiles: raiz de propiedad. Autorizacion directa por owner_user_id.
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (owner_user_id = auth.uid());

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (owner_user_id = auth.uid());

create policy profiles_update on public.profiles
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- Sin politica DELETE: el borrado es logico (UPDATE de deleted_at). No se concede DELETE fisico.

-- ---------------------------------------------------------------------------
-- Tablas hijas con owner_user_id + profile_id.
-- Se generan las 4 politicas por tabla con la doble comprobacion (owner + perfil propio).
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
    execute format($p$
      create policy %1$I_select on public.%1$I
        for select to authenticated
        using (owner_user_id = auth.uid() and public.profile_is_owned(profile_id));
    $p$, t);

    execute format($p$
      create policy %1$I_insert on public.%1$I
        for insert to authenticated
        with check (owner_user_id = auth.uid() and public.profile_is_owned(profile_id));
    $p$, t);

    -- USING exige que la fila sea del usuario; WITH CHECK impide cambiar el propietario y
    -- reasignar la fila a un perfil ajeno.
    execute format($p$
      create policy %1$I_update on public.%1$I
        for update to authenticated
        using (owner_user_id = auth.uid())
        with check (owner_user_id = auth.uid() and public.profile_is_owned(profile_id));
    $p$, t);
    -- Sin politica DELETE: borrado logico via UPDATE de deleted_at.
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- transaction_tags (join). Misma autorizacion doble; sin UPDATE habitual (se borra/crea).
-- ---------------------------------------------------------------------------
create policy transaction_tags_select on public.transaction_tags
  for select to authenticated
  using (owner_user_id = auth.uid() and public.profile_is_owned(profile_id));

create policy transaction_tags_insert on public.transaction_tags
  for insert to authenticated
  with check (owner_user_id = auth.uid() and public.profile_is_owned(profile_id));

create policy transaction_tags_update on public.transaction_tags
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid() and public.profile_is_owned(profile_id));

-- Sin politica DELETE. transaction_tags es una tabla puente sin deleted_at ni revision: la
-- relacion de etiquetas es la proyeccion de transactions.tag_ids (fuente de verdad), por lo que
-- no usa tombstone; se reescribe al cambiar las etiquetas del movimiento.

-- Fase 2 (sincronizacion): indices para el cursor de PULL.
--
-- El motor de sincronizacion descarga cambios remotos por entidad con un cursor por `updated_at`:
--   select ... where profile_id = ? and updated_at >= cursor order by updated_at asc limit N
-- (upsert idempotente por id en Dexie; nunca una consulta remota por render). Estos indices
-- (profile_id, updated_at) hacen ese barrido eficiente a escala. `profiles` ya tiene el equivalente
-- (owner_user_id, updated_at) creado en Fase 1, y no lleva profile_id (es la raiz).

do $$
declare
  t text;
  pull_tables text[] := array[
    'settings', 'accounts', 'categories', 'tags', 'transactions',
    'rules', 'budgets', 'import_templates', 'import_batches', 'backup_metadata'
  ];
begin
  foreach t in array pull_tables loop
    execute format(
      'create index if not exists %I on public.%I (profile_id, updated_at)',
      t || '_profile_updated_idx', t
    );
  end loop;
end;
$$;

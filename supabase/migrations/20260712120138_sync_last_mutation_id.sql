-- Fase 2 (sincronizacion): columna de idempotencia `last_mutation_id`.
--
-- Modelo de idempotencia elegido (DATA_MODEL 11, CLOUD_SYNC_SECURITY 6):
--   - El `id` (UUID) se reutiliza como PK local y remota: un insert se hace por upsert por PK, asi
--     que reenviarlo no duplica.
--   - Un update se envia GUARDADO por `revision` (where id = ? and revision = baseRevision). Si
--     afecta 0 filas puede ser (a) un conflicto real (otra revision remota) o (b) la REEJECUCION de
--     nuestra propia mutacion ya aplicada (la respuesta se perdio y reintentamos). Para distinguirlas
--     sin ambiguedad, el cliente graba en cada escritura el `last_mutation_id` de la mutacion que la
--     provoco; al releer la fila remota, si `last_mutation_id` coincide con la mutacion en curso, fue
--     nuestra reejecucion (exito idempotente) y no un conflicto.
--
-- La columna es informativa para el cliente; NO cambia la autorizacion (la fila ya esta protegida por
-- RLS) ni el control de `revision` (lo sigue fijando el trigger del servidor). Es nullable y aditiva.

do $$
declare
  t text;
  -- Tablas sincronizables (las que llevan revision). transaction_tags queda fuera: es una
  -- proyeccion derivada de transactions.tag_ids (ver migracion de tag_ids), no una entidad propia.
  syncable text[] := array[
    'profiles', 'settings', 'accounts', 'categories', 'tags', 'transactions',
    'rules', 'budgets', 'import_templates', 'import_batches', 'backup_metadata'
  ];
begin
  foreach t in array syncable loop
    execute format('alter table public.%I add column if not exists last_mutation_id uuid', t);
  end loop;
end;
$$;

-- Fase 5: hash/tamano del fichero de origen en import_batches (deteccion de "archivo
-- repetido", DATA_MODEL 15) y contador de filas resueltas con la decision "vincular"
-- (rows_linked: no crean movimiento nuevo, solo actualizan uno existente).

alter table public.import_batches
  add column if not exists source_file_hash text,
  add column if not exists source_file_size bigint,
  add column if not exists rows_linked integer;

update public.import_batches
set rows_linked = coalesce(rows_linked, 0)
where rows_linked is null;

alter table public.import_batches
  alter column rows_linked set not null,
  alter column rows_linked set default 0;

-- Busqueda de lotes previos con el mismo fichero (mismo contenido, aunque cambie el nombre).
create index import_batches_profile_source_file_hash_idx
  on public.import_batches (profile_id, source_file_hash);

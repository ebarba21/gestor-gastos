-- Fase 2 (sincronizacion): tags del movimiento como array en `transactions.tag_ids`.
--
-- Problema que resuelve: en local (Dexie) las etiquetas de un movimiento viven como un array
-- `tagIds: string[]` dentro del propio `Transaction` (DATA_MODEL 2.6). En remoto, la Fase 1 las
-- normalizo en la tabla puente `transaction_tags`, que NO tiene columnas de sincronizacion
-- (revision/updated_at/deleted_at) ni se le concede DELETE fisico al cliente. Sincronizar quitar una
-- etiqueta seria imposible (no hay forma de propagar la baja de una fila puente).
--
-- Solucion (aditiva, DATA_MODEL 12 "no reinterpretar campos existentes"): se anade
-- `transactions.tag_ids uuid[]` como FUENTE DE VERDAD de las etiquetas del movimiento (equivale al
-- `tagIds[]` local; viaja con la fila del movimiento y se sincroniza con su revision). La tabla
-- `transaction_tags` se conserva como PROYECCION derivada (util para consultas relacionales y RLS),
-- mantenida por un trigger a partir de `tag_ids`. No se sincroniza `transaction_tags` como entidad
-- propia.

alter table public.transactions
  add column if not exists tag_ids uuid[] not null default '{}'::uuid[];

-- Proyecta `transactions.tag_ids` en la puente `transaction_tags`. SECURITY DEFINER para poder
-- reescribir las filas derivadas (el cliente no tiene DELETE fisico sobre la puente) sin abrir un
-- borrado fisico al usuario. Fija owner_user_id/profile_id desde NEW (el movimiento), preservando el
-- aislamiento por propietario+perfil. search_path vacio y sin objetos sin cualificar (hardening).
create or replace function public.tg_project_transaction_tags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Reescritura completa de las filas derivadas de este movimiento (idempotente).
  delete from public.transaction_tags where transaction_id = new.id;
  if new.tag_ids is not null and array_length(new.tag_ids, 1) is not null then
    insert into public.transaction_tags (transaction_id, tag_id, owner_user_id, profile_id)
    select new.id, s.tid, new.owner_user_id, new.profile_id
    from (select distinct unnest(new.tag_ids) as tid) s
    where s.tid is not null;
  end if;
  return null; -- trigger AFTER: el valor de retorno se ignora.
end;
$$;

-- Una funcion SECURITY DEFINER no debe ser ejecutable como RPC por anon/authenticated (asesor de
-- seguridad). El trigger se dispara igualmente: no depende del privilegio EXECUTE de la funcion.
revoke execute on function public.tg_project_transaction_tags() from public;
revoke execute on function public.tg_project_transaction_tags() from anon;
revoke execute on function public.tg_project_transaction_tags() from authenticated;

create trigger transactions_project_tag_ids
  after insert or update of tag_ids on public.transactions
  for each row execute function public.tg_project_transaction_tags();

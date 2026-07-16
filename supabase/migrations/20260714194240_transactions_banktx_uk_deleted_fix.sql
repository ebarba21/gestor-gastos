-- Fase 5 (seguimiento, hallazgo critico de revision): el indice unico parcial
-- transactions_profile_account_banktx_uk (20260714190423_transactions_duplicate_fields.sql)
-- no excluia las filas borradas logicamente (deleted_at). El borrado en este esquema SIEMPRE
-- es logico (nunca fisico salvo cascada de perfil/usuario): cuando un confirmado sustituye a
-- un pendiente, el pendiente se tomb-stonea (deleted_at) pero conserva su bank_transaction_id.
-- Sin "and deleted_at is null", el alta del confirmado con el MISMO bank_transaction_id
-- violaba la restriccion unica contra el pendiente ya tomb-stoneado, aunque este ya no este
-- vivo. Se corrige recreando el indice con la condicion completa (DATA_MODEL 21.2: la
-- unicidad remota es por identificador bancario dentro de la cuenta, entre filas VIVAS).

drop index public.transactions_profile_account_banktx_uk;

create unique index transactions_profile_account_banktx_uk
  on public.transactions (profile_id, account_id, bank_transaction_id)
  where bank_transaction_id is not null and deleted_at is null;

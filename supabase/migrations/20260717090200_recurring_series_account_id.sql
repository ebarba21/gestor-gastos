-- Fase 7: anade recurring_series.account_id (aditivo, nullable). FINANCIAL_ALGORITHMS seccion
-- 7.1 exige agrupar la deteccion "por comercio, direccion y cuenta"; la seccion "Proximos
-- cobros" exige mostrar la cuenta de cada cobro esperado, incluso antes de que exista un
-- movimiento que la resuelva (una ocurrencia 'expected' aun no tiene transaction_id). Sin este
-- campo en la serie ninguna de las dos reglas es satisfacible. Se anade en una migracion
-- separada porque el esquema base ya se aplico al remoto en esta misma fase.
alter table public.recurring_series
  add column account_id uuid;

alter table public.recurring_series
  add constraint recurring_series_account_id_fkey
  foreign key (account_id, profile_id) references public.accounts (id, profile_id);

create index recurring_series_profile_account_idx on public.recurring_series (profile_id, account_id);
create index recurring_series_account_id_fk_idx on public.recurring_series (account_id);

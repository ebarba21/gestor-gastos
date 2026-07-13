-- Fase 4 (comercios normalizados): campos de comercio en transactions (DATA_MODEL 14.3).
--
-- Aditivo: rawConcept es INMUTABLE respecto a la importacion (invariante 12 de CLAUDE.md); el
-- concepto editable actual sigue viviendo en `concept` (ya existente). El backfill de
-- normalized_concept aqui es una aproximacion SQL razonable (minusculas + espacios colapsados)
-- para que la columna nunca quede nula; el algoritmo autoritativo y versionado
-- (normalizeConceptV1) vive en el cliente (src/lib/normalization.ts) y sincroniza el valor
-- exacto en el siguiente push de cada movimiento existente (la migracion local marca esas filas
-- como pendientes de subir). No se afirma equivalencia exacta entre este backfill y el algoritmo
-- cliente: solo evita una columna NULL entre la migracion de esquema y el primer push.

alter table public.transactions
  add column if not exists raw_concept text,
  add column if not exists normalized_concept text,
  add column if not exists normalization_version integer,
  add column if not exists merchant_id uuid,
  add column if not exists merchant_match_source text,
  add column if not exists merchant_match_confidence integer;

update public.transactions
set
  raw_concept = coalesce(raw_concept, concept),
  normalized_concept = coalesce(normalized_concept, lower(trim(regexp_replace(concept, '\s+', ' ', 'g')))),
  normalization_version = coalesce(normalization_version, 1),
  merchant_match_source = coalesce(merchant_match_source, 'none'),
  merchant_match_confidence = coalesce(merchant_match_confidence, 0)
where raw_concept is null
   or normalized_concept is null
   or normalization_version is null
   or merchant_match_source is null
   or merchant_match_confidence is null;

alter table public.transactions
  alter column raw_concept set not null,
  alter column normalized_concept set not null,
  alter column normalization_version set not null,
  alter column normalization_version set default 1,
  alter column merchant_match_source set not null,
  alter column merchant_match_source set default 'none',
  alter column merchant_match_confidence set not null,
  alter column merchant_match_confidence set default 0;

alter table public.transactions
  add constraint transactions_merchant_match_source_ck
  check (merchant_match_source in ('manual', 'alias', 'rule', 'import', 'suggested', 'none'));

alter table public.transactions
  add constraint transactions_merchant_match_confidence_ck
  check (merchant_match_confidence >= 0 and merchant_match_confidence <= 1000);

-- merchant_id dentro del mismo perfil (FK compuesta, patron composite_fk_integrity). Opcional:
-- se anula si el comercio se elimina fisicamente (nunca ocurre por la app; solo en cascada de
-- borrado de perfil/usuario, donde transactions ya desaparece con el mismo profile_id).
alter table public.transactions
  add constraint transactions_merchant_id_fkey
  foreign key (merchant_id, profile_id) references public.merchants (id, profile_id)
  on delete set null (merchant_id);

create index transactions_profile_merchant_idx on public.transactions (profile_id, merchant_id);
create index transactions_profile_normalized_concept_idx on public.transactions (profile_id, normalized_concept);

-- Fase 2 (sincronizacion): integridad referencial entre perfiles del MISMO usuario.
--
-- Deuda anotada en la migracion inicial (20260711090000): las FKs de Fase 1 referencian por PK sin
-- exigir el mismo profile_id, asi que un cliente defectuoso podria (en teoria) hacer que un
-- movimiento apunte a una cuenta/categoria/regla de OTRO perfil del mismo usuario. RLS no lo impide
-- (ambas filas son del usuario). Se cierra aqui con FK COMPUESTAS (id, profile_id): Postgres rechaza
-- cualquier referencia cruzada entre perfiles como ultima linea de defensa (invariantes 4 y 9).
--
-- Requisito: la columna referenciada de una FK debe ser UNIQUE. Se anade unique (id, profile_id) en
-- las tablas padre (id ya es PK, asi que el par tambien es unico; el par habilita la FK compuesta).
--
-- ON DELETE: se conserva la semantica de Fase 1. Donde antes era SET NULL sobre una columna nullable,
-- se usa la forma por columnas de PostgreSQL 15+ `ON DELETE SET NULL (col)` para anular SOLO la
-- columna hija y NO profile_id (que es NOT NULL e inmutable). El servidor corre PostgreSQL 17.

-- ---------------------------------------------------------------------------
-- 1. Unicidad del par (id, profile_id) en las tablas padre.
-- ---------------------------------------------------------------------------
alter table public.accounts         add constraint accounts_id_profile_uk         unique (id, profile_id);
alter table public.categories       add constraint categories_id_profile_uk       unique (id, profile_id);
alter table public.rules            add constraint rules_id_profile_uk            unique (id, profile_id);
alter table public.import_templates add constraint import_templates_id_profile_uk unique (id, profile_id);
alter table public.import_batches   add constraint import_batches_id_profile_uk   unique (id, profile_id);
alter table public.transactions     add constraint transactions_id_profile_uk     unique (id, profile_id);

-- ---------------------------------------------------------------------------
-- 2. transactions: sustituir FKs simples por compuestas (id, profile_id).
-- ---------------------------------------------------------------------------
alter table public.transactions drop constraint transactions_account_id_fkey;
alter table public.transactions
  add constraint transactions_account_id_fkey
  foreign key (account_id, profile_id) references public.accounts (id, profile_id);

alter table public.transactions drop constraint transactions_category_id_fkey;
alter table public.transactions
  add constraint transactions_category_id_fkey
  foreign key (category_id, profile_id) references public.categories (id, profile_id)
  on delete set null (category_id);

alter table public.transactions drop constraint transactions_subcategory_id_fkey;
alter table public.transactions
  add constraint transactions_subcategory_id_fkey
  foreign key (subcategory_id, profile_id) references public.categories (id, profile_id)
  on delete set null (subcategory_id);

alter table public.transactions drop constraint transactions_parent_id_fkey;
alter table public.transactions
  add constraint transactions_parent_id_fkey
  foreign key (parent_id, profile_id) references public.transactions (id, profile_id)
  on delete set null (parent_id);

alter table public.transactions drop constraint transactions_refund_of_id_fkey;
alter table public.transactions
  add constraint transactions_refund_of_id_fkey
  foreign key (refund_of_id, profile_id) references public.transactions (id, profile_id)
  on delete set null (refund_of_id);

alter table public.transactions drop constraint transactions_rule_fk;
alter table public.transactions
  add constraint transactions_rule_fk
  foreign key (rule_id, profile_id) references public.rules (id, profile_id)
  on delete set null (rule_id);

alter table public.transactions drop constraint transactions_import_batch_fk;
alter table public.transactions
  add constraint transactions_import_batch_fk
  foreign key (import_batch_id, profile_id) references public.import_batches (id, profile_id)
  on delete set null (import_batch_id);

-- ---------------------------------------------------------------------------
-- 3. categories: subcategoria (parent_id) dentro del mismo perfil.
-- ---------------------------------------------------------------------------
alter table public.categories drop constraint categories_parent_id_fkey;
alter table public.categories
  add constraint categories_parent_id_fkey
  foreign key (parent_id, profile_id) references public.categories (id, profile_id)
  on delete set null (parent_id);

-- ---------------------------------------------------------------------------
-- 4. settings / import_templates: cuenta por defecto dentro del mismo perfil.
-- ---------------------------------------------------------------------------
alter table public.settings drop constraint settings_default_account_fk;
alter table public.settings
  add constraint settings_default_account_fk
  foreign key (default_account_id, profile_id) references public.accounts (id, profile_id)
  on delete set null (default_account_id);

alter table public.import_templates drop constraint import_templates_default_account_id_fkey;
alter table public.import_templates
  add constraint import_templates_default_account_id_fkey
  foreign key (default_account_id, profile_id) references public.accounts (id, profile_id)
  on delete set null (default_account_id);

-- ---------------------------------------------------------------------------
-- 5. import_batches: plantilla dentro del mismo perfil.
-- ---------------------------------------------------------------------------
alter table public.import_batches drop constraint import_batches_template_id_fkey;
alter table public.import_batches
  add constraint import_batches_template_id_fkey
  foreign key (template_id, profile_id) references public.import_templates (id, profile_id)
  on delete set null (template_id);

-- Nota: budgets.scope_id es POLIMORFICO (categoria o cuenta segun `scope`); no lleva FK, igual que
-- en Fase 1 (DATA_MODEL 2.8). El motor de sincronizacion valida su coherencia por perfil.

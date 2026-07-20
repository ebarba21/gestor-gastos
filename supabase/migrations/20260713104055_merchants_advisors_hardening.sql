-- Fase 4 (comercios normalizados, seguimiento): indices de cobertura para las FKs
-- "huerfanas" de merchants/merchant_aliases (sin otro indice compuesto que las cubra),
-- mismo criterio que 20260711090200_advisors_hardening para categories_parent_id_fkey y las
-- FKs de transactions (subcategory_id, parent_id, refund_of_id). El resto de hallazgos INFO
-- (transactions_account_id_fkey, category_id_fkey, rule_fk, import_batch_fk,
-- transactions_merchant_id_fkey) ya tienen un indice compuesto (profile_id, columna) que
-- cubre las consultas de la app aunque no en el orden ideal para el borrado en cascada; es la
-- misma deuda ya aceptada para esas columnas, no una regresion nueva. unused_index se ignora
-- (esperado en base vacia).
create index if not exists merchants_default_category_fk_idx on public.merchants (default_category_id);
create index if not exists merchants_default_subcategory_fk_idx on public.merchants (default_subcategory_id);
create index if not exists merchant_aliases_merchant_fk_idx on public.merchant_aliases (merchant_id);

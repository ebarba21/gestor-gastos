-- Planificacion, tipos de presupuesto y marcado explicito de ahorro (noviembre 2026).
-- Puramente ADITIVA: columnas nuevas con valor por defecto o nullable. La version publicada
-- anterior no las envia ni las lee (el mapper solo trata los campos que conoce), asi que puede
-- seguir sincronizando mientras se despliega la nueva. Sin tablas nuevas: RLS y grants de las
-- tablas existentes cubren las columnas anadidas (las politicas son por fila y los grants por
-- tabla).

-- 1. Categorias: papel explicito en estadisticas. null = automatico por nombre (comportamiento
--    previo: "Ahorro"/"Ahorros" e "Inversion"/"Inversiones"); 'none' = gasto normal aunque el
--    nombre coincida.
alter table public.categories
  add column stats_role text
  check (stats_role is null or stats_role in ('savings', 'investment', 'none'));

-- 2. Configuracion del perfil: datos de planificacion.
--    pay_day: dia habitual de cobro de la nomina (1..31) o null.
--    safety_buffer_cents: colchon minimo que el disponible seguro nunca reparte.
--    budget_cycle: periodo de los presupuestos mensuales ('calendar' = mes natural,
--      'payday' = de nomina a nomina, usando pay_day).
--    extra_pay_months: meses (1..12) con paga extra, p. ej. {6,12}.
--    reserve_extra_pay: si una paga extra se aparta del disponible hasta el siguiente cobro.
alter table public.settings
  add column pay_day smallint check (pay_day is null or (pay_day between 1 and 31)),
  add column safety_buffer_cents bigint not null default 0 check (safety_buffer_cents >= 0),
  add column budget_cycle text not null default 'calendar' check (budget_cycle in ('calendar', 'payday')),
  add column extra_pay_months smallint[] not null default '{}'
    check (extra_pay_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]),
  add column reserve_extra_pay boolean not null default true;

-- 3. Presupuestos: tipo.
--    'limit' = limite de gasto u objetivo de ingreso (comportamiento previo).
--    'flex'  = limite del gasto variable (sin recibos fijos de recurrencias confirmadas).
--    'goal'  = objetivo de ahorro con fecha (periodo custom: inicio y fecha objetivo).
--    'fund'  = fondo para un gasto no mensual (periodo custom: inicio y vencimiento; se repite
--              cada ano en la misma fecha).
alter table public.budgets
  add column kind text not null default 'limit' check (kind in ('limit', 'flex', 'goal', 'fund'));

-- 4. Movimientos: importe que esperas recuperar de un gasto compartido (centimos, positivo).
alter table public.transactions
  add column reimbursable_cents bigint check (reimbursable_cents is null or reimbursable_cents > 0);

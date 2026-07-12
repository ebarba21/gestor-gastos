-- Prueba de aislamiento por RLS (pgTAP). Verifica los criterios de avance de la fase 1:
--   - dos usuarios autenticados no ven datos del otro;
--   - un usuario anonimo no lee nada;
--   - una fila hija no puede adjuntarse a un perfil ajeno;
--   - el propietario es inmutable (no se puede regalar/robar una fila).
--
-- Ejecucion (requiere stack local de Supabase, NO toca el proyecto remoto):
--   supabase start
--   supabase db reset            # aplica migraciones
--   supabase test db             # ejecuta los tests de supabase/tests
--
-- Patron estandar: se crean dos usuarios en auth.users como superusuario y luego se
-- cambia a rol authenticated fijando request.jwt.claims (auth.uid() = claim "sub") para
-- que las politicas RLS apliquen igual que desde supabase-js.

begin;
select plan(12);

-- Esquema para las funciones auxiliares del test (no lo crea el CLI por defecto).
create schema if not exists tests;

-- Identificadores fijos para los dos usuarios de prueba y sus perfiles.
\set user_a '11111111-1111-1111-1111-111111111111'
\set user_b '22222222-2222-2222-2222-222222222222'
\set profile_a '1a1a1a1a-1a1a-1a1a-1a1a-1a1a1a1a1a1a'
\set profile_b '2b2b2b2b-2b2b-2b2b-2b2b-2b2b2b2b2b2b'

-- --- Alta de usuarios (como superusuario; authenticated no puede escribir en auth.users) ---
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000', :'user_a', 'authenticated', 'authenticated',
   'a@test.local', '', now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', :'user_b', 'authenticated', 'authenticated',
   'b@test.local', '', now(), now(), now(), '', '', '', '');

-- Helper: cambia el contexto de autenticacion al usuario indicado.
create or replace function tests.authenticate_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function tests.authenticate_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end;
$$;

-- Los helpers se invocan tambien cuando el rol activo ya es authenticated/anon; por eso
-- necesitan USAGE del esquema y EXECUTE (si no, "permission denied for schema tests").
grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

-- =========================================================================
-- Usuario A crea su perfil y una cuenta hija.
-- =========================================================================
select tests.authenticate_as(:'user_a');

select lives_ok($$
  insert into public.profiles (id, owner_user_id, name, color)
  values ('1a1a1a1a-1a1a-1a1a-1a1a-1a1a1a1a1a1a',
          '11111111-1111-1111-1111-111111111111', 'Perfil A', '#111111')
$$, 'A puede crear su propio perfil');

select lives_ok($$
  insert into public.accounts (id, owner_user_id, profile_id, name, kind, currency)
  values ('acacacac-1111-1111-1111-111111111111',
          '11111111-1111-1111-1111-111111111111',
          '1a1a1a1a-1a1a-1a1a-1a1a-1a1a1a1a1a1a', 'Banco A', 'bank', 'EUR')
$$, 'A puede crear una cuenta en su propio perfil');

select is(
  (select count(*)::int from public.profiles),
  1,
  'A ve exactamente su perfil'
);

-- =========================================================================
-- Usuario B: aislamiento.
-- =========================================================================
select tests.authenticate_as(:'user_b');

select is(
  (select count(*)::int from public.profiles),
  0,
  'B no ve ningun perfil de A'
);

select is(
  (select count(*)::int from public.accounts),
  0,
  'B no ve ninguna cuenta de A'
);

-- B intenta insertar un perfil declarando a A como propietario: lo bloquea el WITH CHECK.
select throws_ok($$
  insert into public.profiles (owner_user_id, name, color)
  values ('11111111-1111-1111-1111-111111111111', 'Perfil robado', '#000000')
$$, '42501', null, 'B no puede insertar un perfil para otro propietario');

-- B intenta adjuntar una cuenta al perfil de A: lo bloquea profile_is_owned en el WITH CHECK.
select throws_ok($$
  insert into public.accounts (owner_user_id, profile_id, name, kind, currency)
  values ('22222222-2222-2222-2222-222222222222',
          '1a1a1a1a-1a1a-1a1a-1a1a-1a1a1a1a1a1a', 'Cuenta intrusa', 'bank', 'EUR')
$$, '42501', null, 'B no puede crear una cuenta en el perfil de A');

-- =========================================================================
-- Propietario inmutable: A no puede regalar su perfil a B.
-- =========================================================================
select tests.authenticate_as(:'user_a');
select throws_ok($$
  update public.profiles
  set owner_user_id = '22222222-2222-2222-2222-222222222222'
  where id = '1a1a1a1a-1a1a-1a1a-1a1a-1a1a1a1a1a1a'
$$, '42501', null, 'A no puede cambiar el propietario de su perfil');

-- profile_id inmutable: A no puede mover una fila a otro perfil, ni siquiera propio.
select lives_ok($$
  insert into public.profiles (id, owner_user_id, name, color)
  values ('1a1a1a1a-2a2a-2a2a-2a2a-2a2a2a2a2a2a',
          '11111111-1111-1111-1111-111111111111', 'Perfil A2', '#121212')
$$, 'A puede crear un segundo perfil propio');

select throws_ok($$
  update public.accounts
  set profile_id = '1a1a1a1a-2a2a-2a2a-2a2a-2a2a2a2a2a2a'
  where id = 'acacacac-1111-1111-1111-111111111111'
$$, '42501', null, 'A no puede mover una fila entre sus propios perfiles (profile_id inmutable)');

-- Borrado fisico denegado: solo borrado logico (UPDATE de deleted_at).
select throws_ok($$
  delete from public.accounts where id = 'acacacac-1111-1111-1111-111111111111'
$$, '42501', null, 'No se permite DELETE fisico (borrado logico via deleted_at)');

-- =========================================================================
-- Anonimo: sin acceso.
-- =========================================================================
-- Un anonimo no tiene ni privilegio SELECT (grants solo a authenticated): el acceso se
-- deniega de raiz, garantia mas fuerte que un RLS que devolveria 0 filas.
select tests.authenticate_anon();
select throws_ok(
  'select count(*) from public.profiles',
  '42501', null, 'Un usuario anonimo no puede leer perfiles (sin privilegios)'
);

select * from finish();
rollback;

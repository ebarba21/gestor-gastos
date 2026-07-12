-- Fase 1 (seguimiento de asesores): endurecer la funcion `public.rls_auto_enable`.
--
-- Contexto: el proyecto tiene activada la auto-activacion de RLS en tablas nuevas. Esa
-- funcionalidad la implementa un EVENT TRIGGER cuya funcion `public.rls_auto_enable()` es
-- SECURITY DEFINER. Por el privilegio EXECUTE por defecto a PUBLIC, queda expuesta como RPC de
-- PostgREST a los roles anon y authenticated (asesores de seguridad
-- anon_/authenticated_security_definer_function_executable, WARN).
--
-- Aunque llamarla directamente fallaria (solo tiene sentido dentro del contexto del event
-- trigger), una funcion SECURITY DEFINER no debe ser ejecutable publicamente. Se revoca
-- EXECUTE a PUBLIC/anon/authenticated. El EVENT TRIGGER sigue disparandose con normalidad: el
-- disparo no depende del privilegio EXECUTE de la funcion.
--
-- La funcion NO forma parte de este esquema (la crea la plataforma/Dashboard), asi que el
-- revoke se hace GUARDADO por existencia: es un no-op en entornos donde no existe (p. ej. el
-- stack local o un proyecto nuevo creado solo desde estas migraciones).

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public;
    revoke execute on function public.rls_auto_enable() from anon;
    revoke execute on function public.rls_auto_enable() from authenticated;
    raise notice 'rls_auto_enable: EXECUTE revocado de public/anon/authenticated';
  else
    raise notice 'rls_auto_enable no existe en este entorno; nada que revocar (no-op)';
  end if;
end;
$$;

# Supabase (persistencia remota privada opcional)

Este directorio contiene TODO lo reproducible del backend remoto: migraciones SQL, configuracion
del CLI y tests de RLS. La sincronizacion completa llega en la fase 2; la fase 1 deja preparados
esquema, RLS, autenticacion y abstracciones.

Proyecto de desarrollo (sin datos reales): `project_id = skwhlbwpnsdgmdsfozcr` (ver `config.toml`).

## Estructura

```
supabase/
  config.toml                         Configuracion del CLI (sin secretos)
  migrations/
    20260711090000_initial_schema.sql Tablas, tipos, checks, FKs, indices, triggers
    20260711090100_rls_and_grants.sql RLS + grants (solo authenticated) + politicas por operacion
  tests/
    rls_isolation_test.sql            Test pgTAP de aislamiento por usuario/perfil y anon
```

## Reglas del proyecto (obligatorias)

1. Todo cambio estructural va PRIMERO como migracion en Git. No se ejecuta DDL remoto sin su
   migracion equivalente. No se usa SQL ad hoc como sustituto de una migracion.
2. En el frontend solo la clave publicable. Nunca `service_role` ni secretos en el repo, logs o
   bundle.
3. RLS activa en todas las tablas financieras, con politicas explicitas por SELECT/INSERT/UPDATE/
   DELETE. `anon` sin acceso; propietario inmutable; tablas hijas validadas por pertenencia del
   perfil (`profile_is_owned`).
4. Centimos en `BIGINT`; tipos de interes en micro-fraccion 1e-6 (fases posteriores). Nunca floats.

## Aplicar migraciones

```bash
# Contra el proyecto vinculado
supabase link --project-ref skwhlbwpnsdgmdsfozcr   # requiere login del propietario
supabase db push

# Entorno local para pruebas (Docker)
supabase start
supabase db reset     # aplica todas las migraciones desde cero
```

Alternativamente, la herramienta MCP de migraciones aplica el contenido de estos archivos.

## Regenerar tipos

```bash
supabase gen types typescript --project-id skwhlbwpnsdgmdsfozcr --schema public \
  > ../src/lib/supabase/database.types.ts
```

El resultado debe coincidir campo a campo con las migraciones. Estos tipos son de TRANSPORTE
(snake_case, bigint); los de dominio (camelCase, centimos number) viven en `src/db/schema.ts`.

## Probar la seguridad (RLS)

```bash
supabase start
supabase db reset
supabase test db      # ejecuta supabase/tests/*.sql (pgTAP)
```

El test crea dos usuarios y verifica: aislamiento entre usuarios, que `anon` no lee nada, que una
fila hija no puede adjuntarse a un perfil ajeno y que el propietario es inmutable.

Ademas, ejecuta los asesores de seguridad y rendimiento (MCP de Supabase o Dashboard > Advisors) y
comprueba el acceso real desde `supabase-js` con dos sesiones distintas.

## URLs de autenticacion

Dashboard > Authentication > URL configuration:

- Site URL: URL publica de la PWA (desarrollo: `http://localhost:5173`).
- Redirect URLs: incluir `<site-url>/cuenta`.

## Notas operativas (tras aplicar por MCP)

- **Realineado de `version`**: si las migraciones se aplican con la herramienta MCP, el
  `version` registrado en `supabase_migrations.schema_migrations` puede ser el timestamp de
  aplicacion en vez del prefijo del archivo. El CLI (`supabase db push`) compara por ese
  `version`, asi que veria las migraciones como no aplicadas e intentaria re-ejecutarlas. Si se
  va a usar el CLI, realinear los `version` al prefijo del archivo (UPDATE puntual sobre
  `supabase_migrations.schema_migrations`). Si solo se usa el MCP, es cosmetico.
- **Asesores**: tras aplicar, ejecutar los asesores de seguridad y rendimiento. La migracion
  `20260711090200_advisors_hardening.sql` cierra los WARN de `function_search_path_mutable` y
  `auth_rls_initplan`; los INFO restantes (`unused_index` en base vacia) son ignorables.

## Alcance del esquema (fase 1)

Se representan las entidades locales actuales (`DATA_MODEL.md` secciones 1-8) mas los campos de
sincronizacion y propiedad (`owner_user_id`, `profile_id`, `created_at`, `updated_at`,
`deleted_at`, `revision`). Las columnas y tablas de fases posteriores (comercios, duplicados
avanzados, recurrencias, deudas) se anadiran en las migraciones de SUS fases, no aqui.

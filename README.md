# Gestor de Gastos

Gestor de gastos personales. PWA responsive (PC y movil), **local-first**, multiusuario por
perfiles locales, con **sincronizacion privada opcional** mediante Supabase.

**App publicada:** https://ebarba21.github.io/gestor-gastos/ (se instala en iPhone desde Safari >
Compartir > Anadir a pantalla de inicio). Despliegue, usuarios e historico:
`docs/PUESTA_EN_MARCHA.md`.

- Sin cuenta: la app funciona 100% en local (IndexedDB/Dexie), offline, y ningun dato financiero
  sale del dispositivo. Registrar, importar, categorizar, analizar, exportar y hacer backup no
  requieren red ni cuenta.
- Con cuenta (opcional): se guarda una copia privada de los datos procesados en Supabase,
  protegida por Supabase Auth y Row Level Security. No es privacidad total ni coste cero
  perpetuo: depende de los limites del proveedor.

Modelo de datos, seguridad y algoritmos: ver `specs/` (`DATA_MODEL.md`, `CLOUD_SYNC_SECURITY.md`,
`ARCHITECTURE.md`, `IMPLEMENTATION_ROADMAP.md`, `FINANCIAL_ALGORITHMS.md`, `PRD.md`).

## Stack

React + TypeScript + Vite · Tailwind CSS · IndexedDB (Dexie) · SheetJS (xlsx) · Recharts ·
Vitest · PWA (vite-plugin-pwa) · Supabase (Postgres + Auth + RLS, opcional).

## Desarrollo

```bash
npm install
npm run dev        # servidor de desarrollo (Vite)
npm run test       # tests unitarios (Vitest). NO requieren Supabase.
npm run typecheck  # tsc --noEmit
npm run build      # tsc -b && vite build
```

Los tests unitarios locales no necesitan Supabase funcionando: la capa remota se prueba con
clientes simulados y las politicas RLS con un test SQL (ver mas abajo).

## Sincronizacion con Supabase (opcional)

La ampliacion esta implementada de extremo a extremo (Auth + RLS, sincronizacion local-first con
outbox idempotente y resolucion de conflictos, migracion, reconstruccion de dispositivo, PIN, sesion
cifrada, passkeys, comercios, duplicados, bandeja, conciliacion, recurrencias, forecast y deudas). El
estado de verificacion y las pruebas manuales pendientes estan en `docs/CHECKLIST_AMPLIACION_FINAL.md`.
La cuenta es OPCIONAL: sin ella la app funciona 100% en local. Para habilitar la cuenta autenticada:

### 1. Variables de entorno

Copia `.env.example` a `.env.local` (ignorado por git) y rellena:

```
VITE_SUPABASE_URL=https://<tu-proyecto>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<clave publicable / anon public>
```

- Solo la **clave publicable** llega al frontend. **Nunca** pongas `service_role` ni ningun
  secreto de servicio en variables `VITE_*` ni en el repo (invariantes 7 y 15 de `CLAUDE.md`).
- Sin estas variables, la app arranca en modo local y la pantalla **Cuenta** lo indica.
- Obten los valores en el Dashboard: Project Settings > API (Project URL y Publishable key), o con
  el servidor MCP de Supabase.

### 2. Aplicar las migraciones

El esquema remoto vive versionado en `supabase/migrations/`:

- `..._initial_schema.sql`: tablas, tipos, checks, FKs, indices y triggers (`updated_at`,
  `revision`). Centimos en `BIGINT`. Splits/transferencias/reembolsos como auto-referencias de
  `transactions`; condiciones/acciones de reglas como `jsonb`.
- `..._rls_and_grants.sql`: RLS activa en todas las tablas, privilegios solo a `authenticated`
  (sin acceso para `anon`), politicas por operacion y propietario inmutable.

Aplicalas con el flujo oficial (una de estas):

```bash
# Supabase CLI (proyecto vinculado)
supabase db push

# o entorno local para probar
supabase start && supabase db reset
```

o mediante la herramienta MCP de migraciones. Regla del proyecto: **todo cambio estructural va
primero como migracion en Git**; no se ejecuta DDL remoto sin su migracion equivalente.

### 3. Regenerar los tipos TypeScript

Tras aplicar migraciones, regenera `src/lib/supabase/database.types.ts` desde el remoto:

```bash
supabase gen types typescript --project-id <project-ref> --schema public > src/lib/supabase/database.types.ts
```

Los tipos de TRANSPORTE (snake_case, `bigint`) viven en ese archivo; los tipos de DOMINIO
(camelCase, centimos como number) viven en `src/db/schema.ts`. La frontera de importes pasa
siempre por `src/remote/cents.ts` (nunca floats para dinero).

### 4. Configurar las URLs de autenticacion

En el Dashboard: Authentication > URL configuration.

- **Site URL**: la URL publica de la PWA (en desarrollo, `http://localhost:5173`).
- **Redirect URLs**: incluye `<site-url>/cuenta` (la app redirige alli tras verificar email o
  recuperar contrasena). Ver tambien `supabase/config.toml`.

### 5. Verificar la seguridad

- Ejecuta los asesores de seguridad y rendimiento (MCP de Supabase o Dashboard > Advisors).
- Ejecuta el test de aislamiento RLS: `supabase test db` (usa `supabase/tests/rls_isolation_test.sql`).
- Comprueba desde `supabase-js` que un usuario no ve datos de otro y que `anon` no lee nada.

## Pasos manuales pendientes (propietario del proyecto)

Estos pasos requieren credenciales reales / acceso al proyecto remoto y no se pueden automatizar
desde el repositorio:

1. Crear `.env.local` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` reales.
2. Aplicar las migraciones de `supabase/migrations/` al proyecto (CLI o MCP) y listar las
   migraciones remotas para comparar con Git.
3. Regenerar `src/lib/supabase/database.types.ts` desde el remoto.
4. Configurar Site URL y Redirect URLs en el Dashboard.
5. Ejecutar los asesores de seguridad y rendimiento y el test de RLS con dos usuarios y uno anonimo.

Detalle de Supabase en `supabase/README.md`.

## Privacidad y coste (modelo real)

Local-first con copia remota privada **opcional** protegida por Auth y RLS. No se afirma
privacidad total ni coste cero perpetuo: los limites y la continuidad del plan los fija el
proveedor. Los archivos bancarios originales no se suben por defecto: solo datos procesados.

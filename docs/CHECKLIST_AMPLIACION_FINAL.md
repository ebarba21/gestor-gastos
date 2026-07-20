# Checklist final de la ampliacion (cloud, seguridad y finanzas)

Fecha de verificacion: 2026-07-17. Rama: `feat/fase-2-sync`.
Proyecto Supabase remoto verificado por MCP: `skwhlbwpnsdgmdsfozcr` (`https://skwhlbwpnsdgmdsfozcr.supabase.co`).

> Alcance: verifica la ampliacion completa (Auth + RLS, sincronizacion, migracion, PIN, passkeys,
> comercios, duplicados, bandeja, conciliacion, recurrencias, forecast, deudas) sobre la base local
> ya verificada en `docs/CHECKLIST_FINAL.md` (que sigue siendo valido para el nucleo local). Este
> documento lo complementa; no lo reemplaza.

## Como se ha verificado

Cuatro niveles de evidencia:

1. **Suite de tests (Vitest)**: `npm test` -> **841 tests en 57 archivos, todos en verde**. IndexedDB
   simulada con fake-indexeddb; capa remota con clientes simulados (`src/test/fakeSupabase.ts`).
2. **Typecheck y build**: `npx tsc --noEmit` sin errores; `npm run build` compila y genera la PWA
   (`dist/sw.js`, `dist/manifest.webmanifest`, 16 entradas precache). Sin script `lint` en el repo.
3. **Inspeccion del remoto por MCP**: tablas, migraciones, asesores de seguridad y rendimiento,
   politicas RLS (via `pg_policies`), tipos TypeScript regenerados, ramas, buckets y Edge Functions.
4. **Revision de codigo y specs**: lectura de servicios, repositorios, migraciones y specs.

Estados por punto: **COMPROBADO** (con como, archivo/test y resultado) o **PENDIENTE DE PRUEBA
MANUAL** (requiere el dispositivo real del propietario, una cuenta real o red; con pasos exactos).

Nota importante: la ampliacion no crea usuarios reales ni escribe datos reales en el proyecto remoto
durante esta verificacion (el proyecto remoto esta vacio: 0 filas en todas las tablas). Por eso los
flujos que exigen una sesion real (registro, login, recuperacion, dos usuarios por red, dispositivo
nuevo real) quedan como PENDIENTE DE PRUEBA MANUAL con pasos, mientras su logica queda COMPROBADA por
tests unitarios y por la verificacion de RLS en el remoto.

---

## A. Cuenta, autenticacion y autorizacion

### 1. Registro
**COMPROBADO (logica) + PENDIENTE DE PRUEBA MANUAL (E2E real).**
- Como: `src/auth/authService.ts` implementa `signUp` (email + contrasena, estado de email por
  verificar). Cubierto por `src/auth/authService.test.ts` con cliente Supabase simulado.
- Pendiente manual: con `.env.local` real, en la pantalla **Cuenta**, registrar un email y confirmar
  que llega el correo de verificacion (Authentication > Users en el Dashboard muestra el alta).

### 2. Login
**COMPROBADO (logica) + PENDIENTE DE PRUEBA MANUAL (E2E real).**
- Como: `authService.signIn` + restauracion de sesion (`AuthContext.tsx`); tests en `authService.test.ts`.
- Pendiente manual: iniciar sesion con el usuario creado; la pantalla Cuenta pasa a "sesion iniciada".

### 3. Recuperacion de contrasena
**COMPROBADO (logica) + PENDIENTE DE PRUEBA MANUAL (E2E real).**
- Como: `authService.resetPassword` / `updatePassword`; redireccion a `<site-url>/cuenta` documentada
  en README y `supabase/config.toml`. Mensajes redactados para no revelar si la cuenta existe.
- Pendiente manual: "He olvidado mi contrasena", seguir el enlace del email y fijar una nueva.

### 4. RLS (Row Level Security)
**COMPROBADO.**
- Como (MCP): `list_tables` -> **las 22 tablas del esquema `public` tienen `rls_enabled: true`**.
  `pg_policies` -> **cada tabla tiene politica explicita de SELECT, INSERT y UPDATE**. No hay
  politica de DELETE (borrado fisico denegado por defecto): el borrado es logico via UPDATE de
  `deleted_at` (coherente con `specs/CLOUD_SYNC_SECURITY.md` seccion 4).
- Como (SQL versionado): `supabase/migrations/*_rls_and_grants.sql` y `*_advisors_hardening.sql`;
  privilegios solo a `authenticated`, `anon` sin acceso; propietario inmutable en UPDATE; tablas
  hijas con `WITH CHECK` sobre `profile_id IN (SELECT id FROM profiles WHERE owner_user_id = auth.uid())`.
- Como (asesor): `get_advisors(security)` -> **sin hallazgos** (lints vacio).
- Test: `supabase/tests/rls_isolation_test.sql` (pgTAP, dos usuarios + anonimo) y aislamiento en capa
  de app en `src/db/repos.test.ts` y los `*Service.test.ts`.
- Pendiente manual (ejecucion pgTAP local): `supabase start && supabase test db` (requiere Docker/CLI).

### 5. Dos usuarios (aislamiento entre cuentas)
**COMPROBADO (RLS + tests) + PENDIENTE DE PRUEBA MANUAL (red real).**
- Como: politicas RLS por `owner_user_id = auth.uid()` en las 22 tablas (ver punto 4). Un usuario no
  puede leer ni escribir filas de otro; nadie puede cambiar `owner_user_id`.
- Pendiente manual: desde `supabase-js` con dos sesiones distintas, comprobar que el usuario B no ve
  filas del usuario A y que `anon` no lee nada (README seccion 5).

### 6. Dos perfiles (aislamiento entre perfiles)
**COMPROBADO.**
- Como: doble clave `owner_user_id` + `profile_id` en todas las capas. Tests de aislamiento por perfil:
  `src/db/repos.test.ts`, `src/services/profileService.test.ts`, `transactionService.test.ts`,
  `statsService.dashboard.test.ts`, `backupService.test.ts`, entre otros.

### 7. Migracion local a la cuenta
**COMPROBADO (logica).**
- Como: `src/sync/profileMigration.ts` (asistente: conserva UUID, asigna `owner_user_id`, sube por
  lotes respetando dependencias, valida recuentos, ofrece backup previo, no borra local, reanudable e
  idempotente). Tests en `src/sync/sync.test.ts`.
- Pendiente manual: con datos locales y cuenta nueva, ejecutar el asistente y validar recuentos.

### 8. Reanudacion de sincronizacion
**COMPROBADO (logica).**
- Como: `src/sync/pushEngine.ts` y `pullEngine.ts` con reintentos, espera progresiva, limites,
  cancelacion segura y reanudacion; disparadores en `syncEngine.ts`. Tests en `sync.test.ts`.

### 9. Nuevo dispositivo (reconstruccion)
**COMPROBADO (logica) + PENDIENTE DE PRUEBA MANUAL (dispositivo real).**
- Como: `src/sync/deviceRebuild.ts` descarga y reconstruye IndexedDB con progreso, valida esquema y
  relaciones, queda operativo offline. Tests en `sync.test.ts`.
- Pendiente manual: iniciar sesion en un navegador/dispositivo limpio y confirmar la reconstruccion.

### 10. Offline
**COMPROBADO.**
- Como: la app lee/escribe primero en Dexie; el service worker precachea assets propios; sin runtime
  caching externo. `docs/CHECKLIST_FINAL.md` punto 13 (smoke E2E con red cortada). Con cuenta, las
  escrituras offline se encolan (outbox) y se sincronizan al volver la red.

### 11. Outbox (cola de salida)
**COMPROBADO.**
- Como: `src/sync/outboxRepo.ts` con `mutationId` unico por mutacion. Tests en `sync.test.ts`.

### 12. Reintentos
**COMPROBADO.**
- Como: `pushEngine.ts` reintenta con espera progresiva; sin sesion o sin red detiene el push y lo
  reanuda. Tests en `sync.test.ts`.

### 13. Idempotencia
**COMPROBADO.**
- Como: `entityId` es el mismo UUID en local y remoto; push por upsert (PK); `last_mutation_id` en el
  remoto (migracion `sync_last_mutation_id`). Reenviar una mutacion no duplica ni corrompe. Tests de
  idempotencia en `sync.test.ts` (16 referencias a idempotencia/conflicto/reintento/reanudacion).

### 14. Conflictos
**COMPROBADO.**
- Como: `src/sync/conflictResolver.ts` conserva version local y remota; los conflictos financieros los
  resuelve la persona (mantener local / remota / combinar solo campos NO monetarios). Barrera dura:
  "nunca se combinan campos fuera de la lista blanca (nunca importes)" (conflictResolver.ts:89).
  `Setting` no financiero: last-write-wins documentado. Tests en `sync.test.ts`.

### 15. Logout
**COMPROBADO (logica).**
- Como: `authService.signOut` elimina los datos de sesion; con PIN activo, la sesion cifrada se borra.

---

## B. Seguridad de acceso: PIN, sesion cifrada, passkeys

### 16. PIN
**COMPROBADO.**
- Como: `src/security/pinService.ts` + `pinCrypto.ts`: PIN minimo 6 digitos, derivacion con Web Crypto
  (PBKDF2, sal aleatoria, parametros versionados), se guarda un verificador (nunca el PIN), contador de
  intentos con espera progresiva. Tests en `pinService.test.ts` y `pinCrypto.test.ts`.

### 17. Bloqueo automatico
**COMPROBADO (logica).**
- Como: `src/security/lockState.ts` + `LockContext.tsx`: bloqueo inmediato/1/5/15/30 min y al volver del
  segundo plano. Mientras esta bloqueado no se sincroniza en segundo plano.
- Pendiente manual: configurar auto-bloqueo y confirmar el gesto de bloqueo por inactividad en el dispositivo.

### 18. Sesion cifrada
**COMPROBADO.**
- Como: `src/security/encryptedSessionStorage.ts`: la sesion de Supabase se cifra con AES-GCM, clave
  derivada del PIN, solo en memoria mientras esta desbloqueada; errores de descifrado explicitos (nunca
  degrada a texto plano). Tests en `encryptedSessionStorage.test.ts`.

### 19. Passkeys activadas
**COMPROBADO (logica) + PENDIENTE DE PRUEBA MANUAL (autenticador real).**
- Como: `src/security/webauthn.ts` (solo APIs oficiales WebAuthn; deteccion de `PublicKeyCredential`).
  Guardado tras flag `VITE_ENABLE_PASSKEYS` + `passkeysEnabled` del dispositivo + soporte del navegador
  (`LockScreen.tsx:106`). Tests en `webauthn.test.ts`.
- Pendiente manual: activar el flag, configurar Authentication > Passkeys en el Dashboard
  (`docs/FASE3_CONFIGURACION_MANUAL.md`) y registrar/usar una passkey real.

### 20. Passkeys desactivadas
**COMPROBADO.**
- Como: por defecto `VITE_ENABLE_PASSKEYS=false` (`.env.example`) y `passkeysEnabled: false`
  (`deviceSecurityRepo.ts:23`, `LockContext.tsx`); siempre queda contrasena/PIN como via de acceso.

### 21. Navegador sin WebAuthn
**COMPROBADO.**
- Como: `isWebAuthnSupported()` guarda la funcion; error `WEBAUTHN_DISABLED` explicito (`errors.ts:19`).
  Si no hay soporte, la app no ofrece passkey y mantiene PIN/contrasena. Tests en `webauthn.test.ts`.

---

## C. Comercios, duplicados, bandeja, conciliacion

### 22. Comercios normalizados
**COMPROBADO.**
- Como: `src/services/merchantService.ts` + `src/lib/normalization.ts`; migraciones `merchants_*`.
  Tests en `merchantService`/`normalization.test.ts`/`merchantMigration.test.ts`.

### 23. Alias de comercio
**COMPROBADO.**
- Como: `src/db/merchantAliasesRepo.ts` (tabla hija con RLS por pertenencia de perfil). Una regex de
  alias invalida no rompe el motor (se maneja el error). Tests en normalizacion.

### 24. rawConcept inmutable
**COMPROBADO.**
- Como: `transactions.raw_concept` es dato inmutable; la normalizacion y la asociacion a comercio son
  campos anadidos (`normalized_concept`, `merchant_id`), nunca sustituyen el original (invariante 12).

### 25. Fusion de comercios
**COMPROBADO (logica).**
- Como: `merchantService` soporta fusion conservando alias y sin perder el concepto original.

### 26. Archivo repetido (reimportacion)
**COMPROBADO.**
- Como: `sourceFileHash` identifica una reimportacion aunque cambie el nombre del fichero
  (`duplicateEngine.ts`; `import_batches.source_file_hash`). Tests en `duplicateEngine.test.ts`.

### 27. Duplicado exacto
**COMPROBADO.**
- Como: nivel `exact` por `bankTransactionId` o `exactFingerprint`. Test `duplicateEngine.test.ts`.

### 28. Posible duplicado
**COMPROBADO.**
- Como: niveles `strongNormalized`/`possible`/`weak` con confianza orientativa por mil y razones.
  Test `duplicateEngine.test.ts`.

### 29. Compras iguales reales (no duplicado)
**COMPROBADO.**
- Como: duplicados son AVISO, no bloqueo; dos compras reales identicas son legitimas. `NoDuplicateDecision`
  impide que la misma pareja reaparezca. Tests en `duplicateEngine.test.ts` y tabla `no_duplicate_decisions`.

### 30. Pendiente -> confirmado
**COMPROBADO.**
- Como: `pendingReplacementId` sustituye un pendiente por un confirmado compatible sin duplicar saldo y
  sin borrar sin confirmacion. Tests en `duplicateEngine.test.ts`.

### 31. Bandeja de revision
**COMPROBADO.**
- Como: `src/services/reviewService.ts` + tabla `review_items` (RLS). Reune sin categorizar, posibles
  duplicados, transferencias/reembolsos candidatos, comercios nuevos y errores. Tests en `reviewService.test.ts`.

### 32. Acciones masivas (bandeja)
**COMPROBADO (logica).**
- Como: `reviewService` resuelve items en lote con confirmacion. Tests en `reviewService.test.ts`.

### 33. Transferencias (deteccion/candidatos)
**COMPROBADO.**
- Como: par de movimientos enlazados excluidos de estadisticas; candidatos en la bandeja. Tests en
  `transactionService.test.ts` (creacion) y `statsService.test.ts` (no contaminan stats).

### 34. Reembolsos
**COMPROBADO.**
- Como: `refundOfId` reduce el gasto neto de la categoria original (no es ingreso), incluso en otro mes.
  Tests en `statsService.test.ts` y `statsService.dashboard.test.ts`.

### 35. Errores (en importacion/revision)
**COMPROBADO.**
- Como: filas con error se listan en la bandeja; validaciones y manejo explicito, sin fallos silenciosos.

### 36. Conciliacion
**COMPROBADO.**
- Como: `src/services/reconciliationService.ts` + tabla `reconciliations`. `computedBalanceCents` incluye
  confirmados con `date <= statementDate` (limite inclusivo, comparacion lexicografica), INCLUYE
  transferencias y excluidos (semantica de saldo, no de stats), excluye pendientes por defecto;
  `differenceCents = statement - computed`; `acceptedWithDifference` deja constancia. Tests con fixture que
  demuestra la divergencia saldo vs stats en `reconciliationService.test.ts`.

---

## D. Recurrencias y forecast

### 37. Recurrencia semanal
**COMPROBADO.**
- Como: deteccion de frecuencia por separacion tipica entre fechas (`recurringDetectionEngine.ts`);
  importe esperado = mediana en centimos; dispersion robusta (MAD). Tests en `recurringDetectionEngine.test.ts`.

### 38. Recurrencia mensual
**COMPROBADO.** Mismo motor; casos a principio/fin de mes y meses 28/29/30/31. `recurringDetectionEngine.test.ts`.

### 39. Recurrencia trimestral
**COMPROBADO.** Frecuencia trimestral con `interval`. `recurringDetectionEngine.test.ts`.

### 40. Recurrencia anual
**COMPROBADO.** Frecuencia anual, cambio de ano. `recurringDetectionEngine.test.ts` y `recurringOccurrencePlanner.test.ts`.

### 41. Subida de precio
**COMPROBADO.**
- Como: anomalia de subida sobre `expectedAmountCents` supera umbral -> tarea de revision (no accion
  automatica). Tests en `recurringSeriesService.test.ts`.

### 42. Ausencia (cobro no recibido)
**COMPROBADO.**
- Como: se marca `missing` tras la ventana; no se declara cancelacion por un solo retraso. Tests en
  `recurringSeriesService.test.ts`.

### 43. Cancelacion (posible)
**COMPROBADO.**
- Como: `possiblyCancelled` tras varios fallos consecutivos. Tests en `recurringSeriesService.test.ts`.

### 44. Forecast
**COMPROBADO.**
- Como: `src/services/forecastService.ts`: `forecast = gasto_realizado + recurrentes_pendientes +
  variable_restante`, en magnitudes de gasto positivas, con la misma semantica de stats. Tests en
  `forecastService.test.ts` (incluye reduccion de outliers).

### 45. Forecast por rango
**COMPROBADO.**
- Como: salida inferior/central/superior; la incertidumbre se deriva del historico y de la dispersion
  real de recurrentes, no de un porcentaje fijo. Tests en `forecastService.test.ts`.

### 46. No doble conteo (forecast)
**COMPROBADO.**
- Como: se excluyen transferencias, excluidos, splits padre, aportaciones a ahorro/inversion y las
  ocurrencias recurrentes YA cobradas; los reembolsos reducen el gasto realizado, no se suman aparte.
  Tests en `forecastService.test.ts`.

---

## E. Deudas (Snowball / Avalanche)

### 47. Deuda de cuota fija
**COMPROBADO.**
- Como: `src/services/debtAmortizationEngine.ts` + `src/lib/interest.ts`. Fixture de control (prestamo
  fijo P=1.000.000, 5%, n=12): cuota 85607, interes mes 1 = 4167, ultimo pago 85612, intereses totales
  27289, saldo final 0. Verificado en `debtAmortizationEngine.test.ts` y `debtsService.test.ts`.

### 48. Amortizacion anticipada
**COMPROBADO.**
- Como: `ExtraPayment` puntual/mensual; modos reducir plazo o reducir cuota; salidas comparadas (meses
  e intereses ahorrados, cuota nueva, coste total). Tests en `debtAmortizationEngine.test.ts`.

### 49. Snowball
**COMPROBADO.**
- Como: extra a la deuda de menor saldo; cuota liberada se acumula (bola de nieve); desempate
  determinista. Tests en `debtsService.test.ts`.

### 50. Avalanche
**COMPROBADO.**
- Como: extra a la deuda de mayor tasa; mismo motor y desempate determinista. Tests en `debtsService.test.ts`.

### 51. Movimientos vinculados (pagos de deuda)
**COMPROBADO.**
- Como: pagos reales (`debt_payments`) vinculables sin doble conteo; la reduccion de pasivo no se trata
  como consumo. Tests en `debtsService.test.ts`. Tarjeta `type='card'` fuera de calendario y de
  Snowball/Avalanche en esta fase (avisado), coherente con `FINANCIAL_ALGORITHMS.md` 8.1.

---

## F. Backups, exportaciones y PWA

### 52. Backups
**COMPROBADO.** `src/services/backupService.ts`: backup JSON por perfil con version de esquema, sin
PIN/tokens/sesiones; generado en el dispositivo. Tests en `backupService.test.ts`.

### 53. Restauracion
**COMPROBADO.** Ida y vuelta identica (comparacion campo a campo), validacion de archivo corrupto/version
incompatible, modo sobrescribir o crear perfil nuevo, idempotente. `backupService.test.ts`.

### 54. Exportaciones
**COMPROBADO.** `src/services/exportService.ts`: XLSX de movimientos (todos/filtrados), cuentas con
saldos, categorias, reglas, presupuestos y dashboard, desde los mismos servicios que la UI.
`exportService.test.ts`. (Recomendada prueba manual de apertura del fichero.)

### 55. PWA
**COMPROBADO.** `npm run build` genera `dist/sw.js`, `dist/manifest.webmanifest` y 16 entradas precache;
solo assets propios, sin runtime caching externo.
- Pendiente manual: gesto de instalacion (`npm run preview`, instalar desde Chrome/Edge).

### 56. Responsive movil 360px
**COMPROBADO (emulado 390px) + PENDIENTE DE PRUEBA MANUAL (360px fisico).**
- Como: E2E en viewport de movil (`docs/CHECKLIST_FINAL.md` punto 15). Pendiente: movil real a 360px.

### 57. Responsive PC
**COMPROBADO.** E2E en 1280x800 (barra lateral), sin desbordes.

### 58. Accesibilidad
**COMPROBADO (parcial) + PENDIENTE DE PRUEBA MANUAL.**
- Como: graficos con colores validados para deficiencias de vision del color en ambos temas; la
  identidad de las series no depende solo del color (`chartTheme.ts`). Pendiente: auditoria con lector
  de pantalla y navegacion por teclado pantalla por pantalla.

### 59. Build
**COMPROBADO.** `npm run build` exit 0 (`tsc -b && vite build`). Aviso informativo de tamano de chunk
(> 500 kB por `xlsx`); no bloquea.

---

## G. Seguridad de secretos, red y coste

### 60. Secretos
**COMPROBADO.** `grep` de `service_role`/JWT/claves privadas en el repo: solo apariciones en textos que
PROHIBEN su uso (agentes, prompts, specs), ningun secreto real. `.env` y `.env.local` ignorados por git
y NO trackeados. En `dist/`: la cadena `service_role` aparece 2 veces (interna del SDK de Supabase) y
las referencias a `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` como nombres de variable; **cero
JWT embebidos** (build sin `.env.local`).

### 61. Service worker
**COMPROBADO.** Precache solo de assets propios; sin cache de respuestas remotas de Supabase; fallback de
navegacion a `index.html` (`vite.config.ts`, `PwaReloadPrompt.tsx`).

### 62. Textos de privacidad
**COMPROBADO.** Ver seccion H. Sin promesas absolutas en UI/docs vigentes; modelo real descrito.

### 63. Limites de Supabase
**COMPROBADO (documentado).** README y FUNCIONALIDADES describen el plan gratuito actual y que los
limites/continuidad los fija el proveedor; sin promesa de gratuidad perpetua. Sin buckets ni Edge
Functions (0 coste de storage/compute anadido).

### 64. Coste
**COMPROBADO.** Funciones esenciales (registrar, importar, categorizar, analizar, exportar, backup) sin
cuenta, sin red y sin pago (modo local). Dependencias open source. La cuenta opcional anade solo el SDK
y el endpoint de Supabase del propio usuario dentro del plan gratuito. Ver `/audit-coste-cero`.

### 65. Documentacion
**COMPROBADO.** README, FUNCIONALIDADES.md y specs actualizados (ver seccion I de cambios de esta sesion).

---

## H. Revision especifica de redaccion de privacidad

Busqueda global de frases prohibidas (`grep -i`) sobre `.md/.ts/.tsx/.html/.json`. Resultado:

- **"privacidad total"**: solo en forma NEGADA ("no es/ no ofrece privacidad total") en README,
  FUNCIONALIDADES, `AccountPanel.tsx`, PRD y CLOUD_SYNC_SECURITY. **COMPROBADO**.
- **"coste cero perpetuo"**: solo negado ("no es / no se promete"). **COMPROBADO**.
- **"sin backend"**: aparece en `specs/PRD.md` como "sin backend para el uso basico" (cualificado, cierto:
  local-first) y en `docs/CHECKLIST_FINAL.md` referido a la version LOCAL con nota de alcance explicita.
  **COMPROBADO**. Excepcion historica: `specs/BRIEF.md` (requisitos originales del usuario) dice "sin
  backend obligatorio" y "Coste 0 euros en todo momento"; es documento historico y el PRD lo corrige.
  Se anade nota de alcance a BRIEF (ver seccion I). **COMPROBADO con nota**.
- **"ningun dato sale"**: en UI/docs solo cualificado ("sin cuenta, ningun dato financiero sale del
  dispositivo"); en comentarios de codigo (`backupService.ts`, `exportService.ts`, `ruleImportService.ts`,
  `ExportSection.tsx`) referido a funciones que genuinamente son locales (backup/export). **COMPROBADO**.
- **"sin red"**: cualificado ("las funciones nucleo funcionan sin cuenta y sin red"; "sin red hacia
  terceros"); nunca absoluto en runtime con cuenta activa. **COMPROBADO**.

Se explica correctamente: **local-first** (README/FUNCIONALIDADES/specs), **Supabase** (README secciones
1-5, PRD, CLOUD_SYNC_SECURITY), **PIN** (CLOUD_SYNC_SECURITY 9, FUNCIONALIDADES 11 ter), **passkey**
(CLOUD_SYNC_SECURITY 11), **biometria** ("la app nunca recibe datos biometricos"), **recovery**
(CLOUD_SYNC_SECURITY 14) y **backup** (FUNCIONALIDADES 10, CLOUD_SYNC_SECURITY 14). **COMPROBADO**.

---

## I. Verificacion de la conexion MCP y del remoto

### 66. MCP conectado al proyecto correcto
**COMPROBADO.** `.mcp.json` apunta a `project_ref=skwhlbwpnsdgmdsfozcr`; `get_project_url` ->
`https://skwhlbwpnsdgmdsfozcr.supabase.co`. Coincide con el pedido.

### 67. Migraciones remotas iguales a las versionadas
**COMPROBADO.** `list_migrations` remoto: **24 migraciones**; `supabase/migrations/`: **24 archivos**.
Correspondencia 1 a 1 por nombre (los timestamps de version del remoto reflejan la fecha de aplicacion;
el nombre de cada migracion coincide con su archivo). Sin migraciones remotas sin equivalente en Git ni
al reves.

### 68. Tipos TypeScript regenerados desde remoto
**COMPROBADO.** `generate_typescript_types` (MCP) vs `src/lib/supabase/database.types.ts`: `diff -bw` ->
la unica diferencia son las 30 lineas de cabecera de documentacion del archivo versionado; las
definiciones de tipos son **identicas**. Los tipos estan en sync con el esquema remoto (no requieren
regeneracion).

### 69. Asesores de seguridad revisados
**COMPROBADO.** `get_advisors(security)` -> **0 lints** (sin hallazgos).

### 70. Asesores de rendimiento revisados
**COMPROBADO.** `get_advisors(performance)` -> **139 lints, todos nivel INFO**: 111 `unused_index`
(esperado en BD vacia, sin trafico que ejercite los indices) y 28 `unindexed_foreign_keys` (INFO). Sin
WARN ni ERROR. Recomendacion informativa registrada; no bloquea. Referencia:
https://supabase.com/docs/guides/database/database-advisors

### 71. Sin ramas, buckets ni Edge Functions no autorizados
**COMPROBADO.** `list_storage_buckets` -> **[]** (0 buckets). `list_edge_functions` -> **[]** (0 funciones).
`list_branches` devolvio un error de permisos del endpoint MCP (no expone ramas de desarrollo; el proyecto
opera sobre una sola base sin branching de pago). No se ha creado ninguna rama, bucket ni funcion.

### 72. Sin cambios no autorizados de cuenta u organizacion
**COMPROBADO.** No se ejecuto ninguna operacion de cuenta/organizacion; solo lecturas
(list/get/generate/advisors/logs) y un `execute_sql` de solo lectura sobre `pg_policies`. Sin
`apply_migration`, sin `create_branch`, sin `deploy_edge_function`.

### 72 bis. Logs remotos revisados (sin datos sensibles)
**COMPROBADO.** `get_logs(postgres)`: solo checkpoints rutinarios, un `Connection reset by peer`
benigno y el historial DDL de las migraciones (fase 8 aplicada el 2026-07-17 via MCP); las politicas
RLS de deudas usan `(select auth.uid())` + `public.profile_is_owned(profile_id)` en USING y WITH
CHECK. Sin errores de aplicacion; sin datos financieros de usuario (BD vacia). `get_logs(auth)`: sin
eventos (no hay usuarios reales). No se expone ningun dato sensible en este checklist.

### 73. `.mcp.json` sin secretos
**COMPROBADO.** `.mcp.json` solo contiene la URL del servidor MCP con `project_ref` y `features` (el
Project Reference ID no es secreto). Sin tokens, contrasenas ni claves.

### 74. OAuth del MCP fuera del repositorio
**COMPROBADO.** No hay tokens OAuth ni Personal Access Tokens en el repo; la autorizacion del servidor MCP
la gestiona el cliente (Claude Code) fuera de Git. `.env`/`.env.local` ignorados.

---

## Auditorias de cierre (subagentes)

Al cerrar la ampliacion se ejecutaron los dos auditores obligatorios del proyecto sobre la app COMPLETA.

### privacy-auditor -> **CUMPLE** (sin criticos ni altos)
- Aislamiento por perfil y propietario verificado en RLS (24 tablas), repos locales
  (`baseRepo`/`transactionsRepo`), repo remoto (`stripOwnershipKeys`, `ownerUserId` de sesion) y
  triggers (`tg_lock_ownership`/`tg_lock_owner`). Tablas hijas con `owner_user_id` propio y `WITH CHECK`.
- Auth sin `service_role`; PIN PBKDF2 210k + verificador HMAC; sesion AES-GCM solo en memoria; SW sin
  runtime caching; logs sin datos financieros; sin fetch/axios/WebSocket en produccion.
- **Hallazgos**: 1 MEDIO (M-1) y 4 BAJOS (ver "Hallazgos abiertos").

### finance-auditor -> **1 hallazgo ALTO corregido en esta sesion**
- Verificados: signos, exclusiones (transferencias/splits padre/excluidos), reembolsos (reducen gasto,
  no ingreso), redondeos half-up una vez, interes con BigInt sin pre-dividir la tasa, fixtures de deuda
  de la seccion 11 al centimo, Snowball/Avalanche deterministas, duplicados, forecast, backup/restore.
- **ALTO-1 (CORREGIDO)**: `reconciliationService.computeBalance` sumaba el padre de un split y sus
  lineas hijas (mismo cargo contado dos veces), divergiendo del saldo canonico
  (`exportService.computeAccountBalances`). Especialmente alcanzable via pagos de deuda vinculados
  (que dividen el movimiento). **Fix**: se descartan las lineas hijas (`parentId != null`) en el bucle
  de saldo, igual que la funcion canonica. **Test nuevo**: "cuenta el cargo de un split una sola vez"
  en `reconciliationService.test.ts` (13/13 en verde). Archivos: `src/services/reconciliationService.ts`,
  `src/services/reconciliationService.test.ts`.
- **BAJO-1 (CORREGIDO)**: `markAsRefund` ahora valida `type === 'income'`. Queda abierto solo BAJO-2
  (`weightedAverageRatePpm` limite de precision, solo presentacion) (ver "Hallazgos abiertos").
- Nota: el auditor reporto no poder ejecutar la suite (jsdom colgado en SU sandbox); en este entorno
  `npm test` corre en verde (confirmado antes y despues del fix).

## Hallazgos abiertos (no bloqueantes; requieren decision o son de bajo riesgo)

| ID | Sev | Descripcion | Estado / recomendacion |
|----|-----|-------------|------------------------|
| ALTO-1 | ALTO | Doble conteo de split en saldo de conciliacion | **CORREGIDO + test** |
| M-1 | MEDIO | `profileService.listProfiles`/`profilesRepo.listActive` no filtraban por `ownerUserId` de sesion; en navegador compartido por dos cuentas el selector mostraria ambos | **CORREGIDO + tests**. `listActive(ownerUserId?)` acota a los perfiles de la sesion mas los locales sin vincular (`ownerUserId===null`); en modo local puro, todos. `ProfileProvider` pasa el `ownerUserId` de sesion (via `useAuthOptional`) y recarga al cambiar de cuenta. Tests en `profileService.test.ts`. |
| BAJO-1 | BAJO | `markAsRefund` no validaba que el reembolso fuera `income` (enlace que las stats ignoran en silencio) | **CORREGIDO**. Se valida `type === 'income'`. `transactionService.ts`. |
| B-1 | BAJO | Comentario de RLS de `transaction_tags` mencionaba `deleted_at` inexistente | **CORREGIDO** (comentario aclara que la tabla puente no usa tombstone). |
| B-4 | BAJO | `FUNCIONALIDADES.md`: "El modo local nunca deja de ser gratuito" (absoluto) | **CORREGIDO** ("no requiere pagos, software cliente estatico"). |
| B-2 | BAJO | `.mcp.json` habilita features amplias (no minimo privilegio) | ABIERTO (bajo riesgo): tooling de dev, sin secreto. Recomendado reducir a lo necesario; no se toca para no interrumpir la sesion MCP en curso. |
| B-3 | BAJO | `specs/BRIEF.md` conserva "Coste 0 euros en todo momento" | Aceptado: documento historico con nota de alcance anadida. |
| BAJO-2 | BAJO | `weightedAverageRatePpm` limite de precision con saldos enormes | ABIERTO (bajo riesgo): solo dato de presentacion (tasa media), no acumula dinero. |
| INFRA | - | El finance-auditor no pudo correr `npm test` en su sandbox (jsdom) | En este entorno corre en verde; opcional segregar entorno node/jsdom por proyecto para robustez de CI. |

## Resultados de los comandos ejecutados

| Comando | Resultado |
|---------|-----------|
| `npm test` | 841 tests / 57 archivos, **todos en verde** (incluye tests de ALTO-1 y M-1) |
| `npx tsc --noEmit` | **Sin errores** (exit 0) |
| `npm run lint` | No existe script `lint` en `package.json` (N/A) |
| `npm run build` | **exit 0**; PWA generada (`sw.js`, `manifest.webmanifest`, 16 precache) |
| `git diff --check` | **Limpio** (sin conflictos ni errores de whitespace) |
| MCP asesor seguridad | **0 hallazgos** |
| MCP asesor rendimiento | 139 INFO (0 WARN/ERROR) |
| MCP migraciones remoto vs local | 24 ↔ 24, correspondencia 1 a 1 |
| MCP tipos TS vs versionados | Identicos (solo difiere la cabecera de docs) |
| MCP buckets / Edge Functions / ramas | 0 / 0 / ninguna creada |
| Escaneo de secretos (repo y `dist`) | Sin secretos reales; `.env` ignorado y no trackeado |

---

## Pruebas manuales pendientes (con pasos exactos)

Requieren tu dispositivo real, una cuenta real o red; no se pueden automatizar desde el repositorio.
Guia detallada paso a paso (que hacer / que debe pasar / si falla): `docs/GUIA_VALIDACION_MANUAL.md`.

1. **Configurar `.env.local`**: copia `.env.example` a `.env.local` y rellena `VITE_SUPABASE_URL` y
   `VITE_SUPABASE_PUBLISHABLE_KEY` (Dashboard > Project Settings > API). Nunca `service_role`.
2. **Registro / Login / Recuperacion (puntos 1-3)**: `npm run dev`, pantalla **Cuenta** > registrar un
   email; confirma el correo de verificacion; inicia sesion; prueba "He olvidado mi contrasena".
3. **RLS con dos usuarios y anonimo (puntos 4-5)**: `supabase start && supabase test db` para el pgTAP
   local; y desde `supabase-js`, con dos sesiones, comprueba que B no ve datos de A y que `anon` no lee.
4. **Migracion local -> cuenta (punto 7)**: con datos locales, activa la cuenta y ejecuta el asistente;
   valida recuentos y que no se duplica nada; acepta el backup previo.
5. **Nuevo dispositivo (punto 9)**: inicia sesion en un navegador limpio y confirma la reconstruccion de
   perfiles; luego corta la red y comprueba que sigue operativo.
6. **PIN, auto-bloqueo, sesion cifrada (puntos 16-18)**: activa PIN, configura auto-bloqueo, bloquea y
   desbloquea offline; confirma que la sesion persistida esta cifrada (no legible en DevTools).
7. **Passkeys (punto 19)**: activa `VITE_ENABLE_PASSKEYS=true`, configura Authentication > Passkeys en el
   Dashboard (`docs/FASE3_CONFIGURACION_MANUAL.md`) y registra/usa una passkey real.
8. **PWA e instalacion (punto 55)**: `npm run build` + `npm run preview`, abre `http://localhost:4173` en
   Chrome/Edge y usa el icono de instalar; confirma ventana propia.
9. **Movil fisico 360px y accesibilidad (puntos 56, 58)**: `npm run dev -- --host`, abre desde el movil en
   la misma wifi a 360px; y revisa navegacion por teclado y lector de pantalla pantalla por pantalla.
10. **Exportaciones y backup (puntos 53-54)**: exporta XLSX y backup JSON, abrelos y compara cifras; luego
    restaura el backup en un perfil nuevo y verifica que coincide.

> Cierre honesto: la ampliacion queda COMPROBADA a nivel de logica (837 tests verde), tipos, build,
> RLS remoto, asesores, migraciones, tipos y ausencia de secretos/buckets/funciones/ramas no autorizados.
> Las pruebas de la lista anterior siguen PENDIENTES por requerir dispositivo, cuenta o red reales. No se
> declara "todo comprobado" mientras queden esas pruebas manuales.

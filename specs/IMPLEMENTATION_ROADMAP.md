# IMPLEMENTATION_ROADMAP: fases de la ampliacion

Plan de construccion de la ampliacion (cuenta, sincronizacion, seguridad y funciones financieras nuevas) sobre el MVP local ya completo. Refleja el orden y las dependencias del documento `PROMPTS_AMPLIACION_APP_GASTOS.md`.

Relacionado: `PRD.md` (alcance y criterios de aceptacion), `ARCHITECTURE.md`, `DATA_MODEL.md`, `CLOUD_SYNC_SECURITY.md`, `FINANCIAL_ALGORITHMS.md`. Ante contradiccion con `CLAUDE.md`, mandan los invariantes.

## Reglas transversales de todas las fases

- IndexedDB sigue siendo la base operativa; nunca se convierte la app en online-only.
- Todo aditivo: nuevas tablas/columnas nullable; no se elimina ni reinterpreta un campo existente.
- No se avanza de fase sin: tests en verde, `npx tsc --noEmit` limpio, `npm run build` OK, auditorias sin hallazgos criticos abiertos y commit+push correctos.
- No `git reset --hard`, no `push --force`, no secretos en el repo, no `service_role` en frontend, no desactivar RLS.
- Cada fase cierra con `/review-critico`, `privacy-auditor` y, si toca calculos, `finance-auditor`/`/audit-financiero`, mas `/review-ux` en las que tienen UI relevante.

## Grafo de dependencias

```
Sesion A (docs)  ->  F1 Supabase/Auth/RLS
F1  ->  F2 Sync local-first + migracion
F2  ->  F3 PIN / bloqueo / passkeys        (requiere sesion y su almacenamiento)
F2  ->  F4 Comercios normalizados          (sincronizables desde el inicio)
F4  ->  F5 Duplicados avanzados            (usan comercio normalizado)
F5  ->  F6 Bandeja de revision + conciliacion
F4 + F6 ->  F7 Recurrencias + forecast     (usan comercios, duplicados y bandeja)
F7  ->  F8 Deudas (Snowball/Avalanche)
todas -> Sesion Final (verificacion, privacidad, coste, docs)
```
Reglas duras: no duplicados avanzados antes de comercios; no bandeja antes del nuevo motor de duplicados; no forecast nuevo antes de recurrencias + comercios; no PIN/passkeys antes de resolver autenticacion y almacenamiento de sesion.

---

## Sesion A: rediseno documental (esta sesion)

- **Objetivo**: dejar specs coherentes y honestos (esta ampliacion). Sin codigo funcional.
- **Entregables**: PRD, ARCHITECTURE, DATA_MODEL, CLOUD_SYNC_SECURITY, FINANCIAL_ALGORITHMS, este roadmap, CLAUDE.md, FUNCIONALIDADES.md, y barrido de GUIA/CHECKLIST.
- **Migraciones**: ninguna (solo documentacion).
- **Riesgo**: contradicciones entre documentos. **Mitigacion**: relectura cruzada final.
- **Criterio para avanzar**: documentos sin contradicciones y decisiones aprobadas.

## Fase 1: Supabase, autenticacion y RLS

- **Objetivo**: persistencia remota privada + Auth + RLS, sin sincronizacion completa aun. Deja preparados esquema remoto, RLS, tipos y abstracciones.
- **Alcance**: SDK Supabase; `.env.example` con `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` (sin valores, sin `service_role`); migraciones SQL versionadas de todas las entidades actuales + campos de ampliacion (`owner_user_id`, `profile_id`, `created_at`, `updated_at`, `deleted_at`, `revision`), UUID, `BIGINT` para centimos, checks, FKs, indices; Auth completo (registro, login, restauracion, logout, recuperacion, cambio de contrasena, email por verificar, rutas privadas); distincion cuenta vs perfil (`owner_user_id`); RLS por operacion en todas las tablas; capa de acceso (repos local/remoto/futuro sincronizado); tipos TS reproducibles; pantallas de cuenta; textos revisados; tests (auth, rutas protegidas, RLS, aislamiento, imposibilidad de cambiar propietario); docs (README, Supabase, migraciones, tipos).
- **Migraciones de datos**: creacion del esquema remoto; Dexie gana columnas de sync con defaults (`syncStatus='local'`, `revision=0`, `deletedAt=null`) y `Profile.ownerUserId=null`. Sin subir datos aun.
- **Riesgos**: RLS mal definida (fuga entre usuarios); `service_role` filtrado; tests que exijan Supabase real. **Mitigacion**: pruebas de RLS; revision de que solo la clave publicable esta en el cliente; tests unitarios sin dependencia de red.
- **Rollback**: revertir el commit de fase; el esquema remoto es nuevo y aislado; IndexedDB intacto. El modo local sigue funcionando sin cuenta.
- **Criterio para avanzar**: dos usuarios no ven datos del otro por API; anon sin acceso; propietario inmutable; build/tests/typecheck OK; sin `service_role` en frontend.

## Fase 2: sincronizacion local-first y migracion

- **Objetivo**: IndexedDB base operativa + Supabase copia sincronizada; trabajar offline, migrar datos existentes y reconstruir en otro dispositivo.
- **Alcance**: outbox (mutationId, idempotencia); campos de sync + borrado logico; flujo de escritura optimista; lectura de local; sincronizacion por disparadores, por lotes, con reintentos/espera/cancelacion/reanudacion/progreso; conflictos explicitos (sin merge financiero silencioso); asistente de migracion de perfiles locales; dispositivo nuevo (descarga y reconstruye); importaciones atomicas + mutaciones agrupadas + deshacer sincronizado; estados de sync en UI + panel; backups actualizados (nuevas entidades, sin secretos, restauracion idempotente); seguridad (RLS, sin `service_role`, sin cachear datos financieros en SW, respetar logout); tests extensos (offline, reintentos, idempotencia, dos dispositivos, conflicto, migracion interrumpida, dispositivo vacio, miles de movimientos, aislamiento).
- **Migraciones de datos**: promocion de filas locales a sincronizables; migracion inicial de perfiles a la cuenta (idempotente, reanudable, con verificacion de recuentos). Archivos bancarios originales no se suben.
- **Riesgos** (los mas altos del proyecto): perdida/duplicacion silenciosa de datos; sobrescritura entre dispositivos; migracion a medias. **Mitigacion**: idempotencia por UUID/mutationId; borrado logico; conflictos explicitos; backup previo a migrar; validacion de recuentos; finance-auditor sobre integridad.
- **Rollback**: la app puede seguir en modo local; si la sincronizacion falla, los datos locales no se tocan (nunca se borran por migracion). Revertir el commit deja el modo local operativo.
- **Criterio para avanzar**: crear offline y sincronizar no duplica; conflicto real produce resolucion manual; migracion conserva recuentos y no borra local; sin riesgo conocido de perdida/duplicacion.

## Fase 3: PIN, bloqueo y passkeys

- **Objetivo**: proteccion de acceso real sin confundir contrasena de cuenta, PIN, passkey y biometria.
- **Alcance**: completar contrasena de cuenta (cambio, recuperacion, reautenticacion, logout); PIN local (min 6, activacion/cambio/desactivacion, bloqueo manual/automatico/por segundo plano, intentos + espera progresiva, recuperacion via cuenta); almacenamiento del PIN con Web Crypto (sal, KDF robusta, parametros versionados, verificador, nunca en claro, nunca a Supabase); cifrado de sesion AES-GCM (clave del PIN, solo en memoria, sin copia sin cifrar); pantalla bloqueada accesible sin datos detras; passkeys via WebAuthn oficial con feature flag `VITE_ENABLE_PASSKEYS` (off si experimental), terminologia honesta, fallback siempre; ajustes de seguridad; offline (PIN desbloquea sin red; acciones remotas informan); backup sin PIN/tokens/credenciales/sesiones; tests (bypass, sesion no legible sin desbloqueo, sin copia sin cifrar, WebAuthn no disponible, cancelacion, fallback, accesibilidad).
- **Migraciones de datos**: ninguna sobre datos financieros; se anaden estructuras locales de seguridad (`DeviceSecurity`, `EncryptedSession`, refs WebAuthn), no sincronizables ni en backup.
- **Riesgos**: bypass del bloqueo; copia de sesion sin cifrar; PIN debil; dependencia obligatoria de passkeys. **Mitigacion**: privacy-auditor especifico; verificar ausencia de copia sin cifrar; passkeys opcionales; conservar PIN/contrasena.
- **Rollback**: desactivar PIN/passkeys deja la app usable con solo cuenta; revertir el commit no afecta a datos.
- **Criterio para avanzar**: no hay bypass conocido; la app funciona con passkeys desactivadas y sin WebAuthn; PIN desbloquea offline; nadie se queda sin metodo de acceso.

## Fase 4: normalizacion de comercios y conceptos

- **Objetivo**: agrupar conceptos distintos del mismo comercio sin perder el texto original.
- **Alcance**: `Merchant`, `MerchantAlias`, campos de comercio en `Transaction` (`rawConcept` inmutable, `normalizedConcept`, `normalizationVersion`, `merchantId`, `merchantMatchSource`, `merchantMatchConfidence`); funcion de normalizacion pura y versionada; motor de asociacion por orden determinista; UI de comercios (listado, alias, activar/desactivar, fusion transaccional y reversible, reasignacion); integracion en filtros/reglas/importacion/rankings/exportaciones/backup; migracion de movimientos existentes (calcular normalizedConcept, candidatos, por lotes, sin fusiones debiles, conservar originales); Supabase + RLS + outbox + offline + backup; tests (tildes, mayusculas, alias exacto/contains/regex, prioridades, manual prevalece, fusion, rollback, rawConcept intacto, aislamiento).
- **Migraciones de datos**: rellenar `rawConcept` con el concepto actual, calcular `normalizedConcept`/version; crear tablas de comercios. Reanudable.
- **Riesgos**: fusiones erroneas; perder el concepto original; regex maliciosa. **Mitigacion**: `rawConcept` inmutable; fusion transaccional y reversible; compilacion segura de regex.
- **Rollback**: comercios son datos anadidos; desasociar no borra movimientos; revertir el commit conserva `rawConcept`.
- **Criterio para avanzar**: tres conceptos de Amazon asociables; `rawConcept` intacto; fusion reversible; aislamiento.

## Fase 5: deteccion avanzada de duplicados

- **Objetivo**: motor multinivel explicable (ver `FINANCIAL_ALGORITHMS.md` seccion 5).
- **Alcance**: campos opcionales de importacion (bankTransactionId, fechas contable/valor, pendiente, comercio, moneda, saldo posterior, referencia, tipo); metadatos y huellas versionadas; hashes locales (fichero/fila/huella); generacion acotada de candidatos; niveles + puntuacion determinista con razones; pendiente-confirmado; decisiones (omitir, importar, sustituir, vincular, no duplicado, aplicar a equivalentes, deshacer); aviso de archivo repetido; rendimiento (indices, lotes, virtualizacion, worker); sincronizacion (hashes y decisiones, idempotencia, unique solo sobre identificadores fiables); API para la bandeja; tests (mismo archivo otro nombre, misma fila, dos compras iguales reales, pendiente-confirmado, identificador bancario, rendimiento con miles).
- **Migraciones de datos**: calcular huellas versionadas para movimientos existentes (por lotes). El `dedupeHash` FNV-1a se conserva como primer nivel.
- **Riesgos**: falsos positivos que borren dinero; falsos negativos que dupliquen saldo; UNIQUE mal puesto. **Mitigacion**: finance-auditor; nunca borrar sin confirmacion; nunca UNIQUE sobre huella normalizada general.
- **Rollback**: el motor solo marca y propone; sin borrado automatico; revertir el commit vuelve al dedupe simple.
- **Criterio para avanzar**: fixtures de duplicados pasan; el sistema no elimina ni sustituye movimientos sin confirmacion.

## Fase 6: bandeja de revision y conciliacion

- **Objetivo**: flujo Importar -> Revisar -> Conciliar -> Resultados.
- **Alcance**: `ReviewItem` (tipos, estados, generacion idempotente por evento, metadata minima con referencias); UI (contadores, filtros, busqueda, orden, seleccion multiple, acciones masivas, detalle, deshacer, estados vacios, responsive, accesibilidad); acciones por tipo (categorizar, aceptar/corregir regla, duplicado, transferencia candidata, reembolso candidato, pendiente antiguo, comercio nuevo, error de importacion); conciliacion (cuenta, fecha, saldo extracto, calculado, diferencia, aceptar con diferencia, historial); resumen final; navegacion; offline + sync (resoluciones en outbox, conflictos explicitos, sin doble resolucion); tests (idempotencia, resolver/reabrir/masivas/deshacer, conciliacion cuadra/diferencia, aislamiento, movil, teclado).
- **Migraciones de datos**: creacion de `ReviewItem` y `Reconciliation`; generacion inicial de tareas a partir del estado actual (idempotente).
- **Riesgos**: doble resolucion; alterar saldo/estadisticas dos veces. **Mitigacion**: idempotencia; finance-auditor sobre conciliacion/transferencias/reembolsos.
- **Rollback**: la bandeja son tareas sobre entidades existentes; descartarlas no altera datos; revertir el commit no toca movimientos.
- **Criterio para avanzar**: generacion idempotente; conciliacion cuadra a 0; saldo/estadisticas no se alteran dos veces.

## Fase 7: recurrencias y forecast

- **Objetivo**: series confirmables + forecast compuesto por rango (ver `FINANCIAL_ALGORITHMS.md` seccion 7).
- **Alcance**: `RecurringSeries`/`RecurringOccurrence`; deteccion con mediana + dispersion robusta; gestion (confirmar, tolerancias, pausar, cancelar, omitir ocurrencia, dividir, fusionar); proximos cobros; deteccion de subida de precio; ausencias (sin declarar cancelacion por un retraso); forecast por rango con exclusiones correctas; gasto variable con historico comparable; UI (listado, calendario, detalle, grafico, alertas, desglose, metodologia); Supabase + offline + backup; tests (semanal/mensual/trimestral/anual, precio, ausencia, no doble conteo, poco historico, outlier, reembolso/transferencia/split).
- **Migraciones de datos**: deteccion inicial de series candidatas a partir del historico (no se confirman solas).
- **Riesgos**: doble conteo en forecast; mezclar transferencias/reembolsos; floats. **Mitigacion**: finance-auditor + `/audit-financiero`; exclusiones explicitas; fixtures.
- **Rollback**: series y forecast son analiticas derivadas; revertir el commit no afecta a movimientos.
- **Criterio para avanzar**: forecast no mezcla transferencias, no duplica recurrentes, no usa floats; con poco historico lo explica.

## Fase 8: calculadora y planificador de deudas

- **Objetivo**: registrar deudas, calcular amortizacion, simular anticipos y comparar Snowball/Avalanche (ver `FINANCIAL_ALGORITHMS.md` secciones 8-9).
- **Alcance**: `Debt`/`DebtPayment`/`DebtScenario`/`ExtraPayment`; exactitud (centimos, tasa 1e-6, redondeo documentado, ultimo pago, determinismo); calendario base + deteccion de casos degenerados; amortizacion anticipada (reducir plazo/cuota); Snowball; Avalanche; comparador (sin declarar una mejor); UI (resumen, CRUD, calendario, simulador, comparador, graficos, tabla descargable, responsive, accesible); vinculacion con movimientos (sin doble conteo, separar principal/interes/comision, reduccion de pasivo no es consumo); escenarios que no modifican datos reales; Supabase + offline + backup + XLSX; tests con fixtures verificables (prestamo fijo, ultimo pago, extras, reducir plazo/cuota, Snowball, Avalanche, tipos/saldos iguales, cero interes, cuota insuficiente).
- **Migraciones de datos**: creacion de tablas de deudas; sin transformacion de movimientos.
- **Riesgos**: errores de calculo financiero; doble conteo con movimientos; floats. **Mitigacion**: finance-auditor + `/audit-financiero`; verificacion contra formula/hoja independiente; determinismo.
- **Rollback**: modulo aislado; revertir el commit no afecta al resto.
- **Criterio para avanzar**: fixtures cuadran; casos degenerados detectados; Snowball/Avalanche deterministas; sin doble conteo.

## Sesion final: verificacion, privacidad, coste y documentacion

- **Objetivo**: verificacion integral y `docs/CHECKLIST_AMPLIACION_FINAL.md` con estado (COMPROBADO/como o PENDIENTE MANUAL/pasos).
- **Alcance**: recorrer los 65 puntos del plan; ejecutar tests, typecheck, lint, build, pruebas de RLS/sync/migracion/financieras; revisar textos de privacidad/coste; actualizar README, FUNCIONALIDADES, docs, pantalla de privacidad, FAQ.
- **Criterio de cierre**: no afirmar "todo comprobado" si queda una prueba manual pendiente; sin promesas absolutas de privacidad/coste.

## Riesgos abiertos globales

1. Deteccion de ahorro/inversion por nombre de categoria (fragil): migrar a marcado explicito; documentado en `FINANCIAL_ALGORITHMS.md`.
2. `dedupeHash` de 32 bits: suficiente como aviso; el motor avanzado anade huellas versionadas sin UNIQUE sobre huella normalizada.
3. Passkeys en el SDK de Supabase posiblemente experimental: feature flag off por defecto.
4. Dependencia `xlsx` desde el CDN de SheetJS en instalacion (no runtime): mencionar en coste/red.
5. Coste "0" real dependiente de los limites del plan gratuito de Supabase: no prometer perpetuidad.
6. Migracion de datos locales sin cuenta: `ownerUserId` nullable; no bloquear el modo local.
7. Integridad financiera bajo sincronizacion/conflictos: la mayor superficie de riesgo; auditar cada fase con `finance-auditor`.

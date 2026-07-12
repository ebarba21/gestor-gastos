# ARCHITECTURE: arquitectura funcional

Arquitectura de la PWA de gestion de gastos. Local-first, aislada por perfil, con sincronizacion privada opcional. Este documento define modulos, responsabilidades, flujos, estructura de carpetas, comportamiento offline, PWA, sincronizacion y garantias de aislamiento.

Relacionado: `PRD.md` (que se construye), `DATA_MODEL.md` (entidades y persistencia), `CLOUD_SYNC_SECURITY.md` (auth, RLS, cifrado de sesion, PIN, passkeys) e `IMPLEMENTATION_ROADMAP.md` (fases). Ante contradiccion con los invariantes de `CLAUDE.md`, mandan los invariantes.

Estado: las secciones marcan lo VIGENTE (local puro, hoy) frente a lo OBJETIVO (ampliacion por fases). La ampliacion es aditiva: IndexedDB sigue siendo la base operativa; Supabase es una copia remota privada opcional.

---

## 1. Principios de arquitectura

1. **Local-first**: toda la logica de negocio corre en el navegador y opera contra IndexedDB (Dexie). La app lee y escribe primero en local y funciona offline. Sin cuenta, ningun dato financiero sale del dispositivo. Con cuenta (opcional), IndexedDB sigue siendo la base operativa y Supabase guarda una copia remota privada sincronizada; la app no depende de la red para su uso normal.
2. **Coste contenido, sin APIs de pago para lo esencial**: sin IA externa, sin servicios de pago obligatorios. La sincronizacion usa Supabase dentro de su plan gratuito actual (limites y precios los fija el proveedor; no se promete gratuidad perpetua). Las unicas peticiones de red en runtime son: (a) los assets propios de la PWA (service worker) y (b) el endpoint de Supabase del usuario cuando la cuenta esta activada. Ningun otro dominio.
3. **Separacion en capas estricta**: UI -> servicios -> repositorios locales / repositorios remotos / motor de sincronizacion -> Dexie / Supabase. Los componentes nunca tocan Dexie ni Supabase directamente.
4. **Aislamiento por perfil y propietario por diseno**: `profileId` obligatorio en toda la capa de datos; con cuenta, tambien `ownerUserId`. Verificado en todas las capas, incluida RLS en el servidor (ver `DATA_MODEL.md` secciones 4 y 23). La UI nunca es la unica barrera.
5. **Dinero en centimos enteros** y tipos de interes en micro-fraccion 1e-6 en toda la logica; el formateo a euros/porcentaje solo en presentacion.
6. **Sin telemetria ni analytics**. Sin errores silenciosos: validacion y manejo de errores explicitos. Ningun conflicto financiero se resuelve en silencio.

---

## 2. Capas y responsabilidades

```
┌───────────────────────────────────────────────────┐
│ UI:  pages/ + components/ + hooks/                 │  React, Tailwind. Sin logica de negocio.
├───────────────────────────────────────────────────┤
│ Estado app: context/ (perfil activo, sesion, ...)  │  Contextos ligeros + hooks de datos.
├───────────────────────────────────────────────────┤
│ Servicios: services/                               │  Logica de negocio: import, reglas,
│                                                    │  stats, export, backup, comercios,
│                                                    │  duplicados, recurrencias, deudas...
├───────────────────────────────────────────────────┤
│ Repos locales db/ │ Repos remotos sync/remote │    │  Local exige profileId; remoto exige
│                   │ + Motor de sincronizacion  │    │  ownerUserId+profileId. Nunca en UI.
├───────────────────────────────────────────────────┤
│ Dexie / IndexedDB     │  Supabase (Postgres+Auth)  │  Base operativa local  |  copia remota
│  (base operativa)     │  con RLS (opcional)        │  privada sincronizada.
└───────────────────────────────────────────────────┘
```

La UI SIEMPRE lee de la base operativa local (Dexie). El motor de sincronizacion es un proceso aparte que reconcilia local <-> remoto en segundo plano; nunca se hace una consulta remota por render o interaccion.

- **`db/` (repositorios locales)**: unico punto que abre Dexie. Un repositorio por entidad (`transactionsRepo`, `accountsRepo`, etc.). Todos los metodos reciben `profileId` como primer parametro obligatorio. Nada de logica de negocio aqui: solo CRUD, queries por indice y transacciones Dexie. Con la ampliacion, mantienen ademas los campos de sincronizacion (`revision`, `syncStatus`, `deletedAt`) y encolan mutaciones en la outbox.
- **`sync/` y `remote/` (ampliacion)**: capa remota y motor de sincronizacion. `remote/` son repositorios remotos tipados sobre el cliente Supabase (exigen `ownerUserId` + `profileId`, nunca confian en el payload de UI). `sync/` contiene la outbox (cola de salida), el planificador de sincronizacion (por lotes, con reintentos y espera progresiva), el descargador de cambios remotos y el resolutor de conflictos. La UI no llama aqui directamente: interactua via servicios/hooks y observa el estado de sincronizacion.
- **`auth/` (ampliacion)**: cliente Supabase Auth (registro, login, restauracion/cierre de sesion, recuperacion y cambio de contrasena), guardas de ruta y almacenamiento de sesion (cifrado cuando hay PIN). No expone `service_role`; solo la clave publicable.
- **`security/` (ampliacion)**: PIN local (derivacion con Web Crypto, verificacion, bloqueo automatico), cifrado de la sesion persistida (AES-GCM) y passkeys via WebAuthn. Nunca guarda PIN ni biometria en claro.
- **`services/` (logica de negocio)**: orquestan repositorios y contienen los calculos. No conocen React. Se testean con Vitest de forma aislada. Modulos vigentes:
  - `profileService`: crear, cambiar, archivar, borrar perfil (con cascada).
  - `importService`: parseo CSV/XLSX (SheetJS), aplicar `ColumnMap`, normalizar importes a centimos, calcular `dedupeHash`, preview, commit, deshacer lote.
  - `ruleService`: motor de reglas (evaluar condiciones, prioridad, `matchMode`, `stopOnMatch`), aplicacion a movimientos nuevos, aplicacion retroactiva, simulacion (cuenta afectados sin escribir), import de reglas.
  - `statsService`: calculos del dashboard (gasto por categoria, evolucion mensual, ingresos vs gastos, ahorro neto, tasa de ahorro, top gastos, recurrentes, comparativa vs promedio, forecast). Respeta `excludedFromStats`, transferencias, splits y reembolsos.
  - `budgetService`: consumo de presupuestos/metas por periodo.
  - `exportService`: generar XLSX/CSV de movimientos, reglas, categorias, cuentas, metas, dashboard (SheetJS).
  - `backupService`: exportar/importar backup completo por perfil (JSON con version de esquema).
  - `moneyService` / `lib` de dinero: parseo y formateo centimos<->euros, sin floats.
  - Nota: `statsService` documenta hoy la deteccion de ahorro/inversion por NOMBRE de categoria (Ahorro/Inversion). Es deuda tecnica conocida; la ampliacion preve migrar a un marcado explicito (ver `IMPLEMENTATION_ROADMAP.md`, riesgos).
  - Modulos nuevos de la ampliacion: `merchantService` (normalizacion y asociacion de comercios), `dedupeService` (duplicados multinivel versionados), `reviewService` (bandeja), `reconciliationService` (conciliacion), `recurringService` (series y forecast compuesto), `debtService` (calendarios, amortizacion, Snowball/Avalanche). Los algoritmos financieros nucleo son funciones puras versionadas (ver `FINANCIAL_ALGORITHMS.md`).
- **`hooks/`**: puentes React <-> servicios (`useProfiles`, `useTransactions`, `useDashboard`, `useSyncStatus`, `useSession`, ...). Encapsulan carga, estados de loading/error y revalidacion. Un componente consume hooks, nunca servicios directamente para datos asincronos complejos (se permite llamar a servicios en handlers de accion).
- **`components/` y `pages/`**: presentacion e interaccion. Sin acceso a Dexie, Supabase ni calculos financieros.

---

## 3. Estructura de carpetas de `src/`

```
src/
├── main.tsx                 # bootstrap React + registro service worker
├── App.tsx                  # layout raiz + router + guard de perfil activo
├── db/
│   ├── index.ts             # instancia Dexie + db.version(n).stores(...)
│   ├── schema.ts            # tipos de entidades (Transaction, Account, ...)
│   ├── profilesRepo.ts
│   ├── accountsRepo.ts
│   ├── categoriesRepo.ts
│   ├── tagsRepo.ts
│   ├── transactionsRepo.ts
│   ├── rulesRepo.ts
│   ├── budgetsRepo.ts
│   ├── importTemplatesRepo.ts
│   └── importBatchesRepo.ts
├── services/
│   ├── profileService.ts
│   ├── importService.ts
│   ├── ruleService.ts
│   ├── statsService.ts
│   ├── budgetService.ts
│   ├── exportService.ts
│   └── backupService.ts
├── lib/
│   ├── money.ts             # centimos <-> euros, formateo, validacion
│   ├── dates.ts             # utilidades de fecha (YYYY-MM-DD, periodos)
│   ├── dedupe.ts            # hash de duplicados
│   ├── csvXlsx.ts           # wrappers SheetJS (parse/write)
│   └── validation.ts        # validadores y errores tipados
├── context/
│   ├── ProfileContext.tsx   # perfil activo + cambio de perfil
│   └── ToastContext.tsx     # avisos, confirmaciones, deshacer
├── hooks/
│   ├── useProfiles.ts
│   ├── useTransactions.ts
│   ├── useDashboard.ts
│   ├── useRules.ts
│   └── useBudgets.ts
├── components/
│   ├── common/              # botones, modales, confirmaciones, tabla virtual
│   ├── transactions/
│   ├── import/
│   ├── rules/
│   ├── dashboard/           # graficos Recharts + tarjetas de metricas
│   ├── budgets/
│   └── profile/
├── pages/
│   ├── DashboardPage.tsx
│   ├── TransactionsPage.tsx
│   ├── ImportPage.tsx
│   ├── RulesPage.tsx
│   ├── CategoriesPage.tsx
│   ├── AccountsPage.tsx
│   ├── BudgetsPage.tsx
│   ├── ExportPage.tsx
│   └── SettingsPage.tsx
├── pwa/
│   └── PwaReloadPrompt.tsx  # registro del SW + aviso de actualizacion y de offline listo
└── test/
    └── setup.ts             # setup Vitest + fake-indexeddb
```

Notas:
- `db/schema.ts` alberga los tipos TypeScript de `DATA_MODEL.md`. Fuente unica de tipos de datos.
- Los tests conviven junto al codigo (`*.test.ts`) o en carpeta espejo; la logica de `services/` y `lib/` es de test obligatorio (invariante CLAUDE.md).

---

## 4. Navegacion por secciones

Las 10 secciones del BRIEF, como rutas de una SPA (router client-side):

Rutas vigentes:

| Ruta | Seccion | Contenido |
|------|---------|-----------|
| `/` | Dashboard | Metricas y graficos del perfil activo |
| `/movimientos` | Movimientos | Lista virtualizada, filtros, CRUD, acciones masivas |
| `/importar` | Importar datos | Wizard: fichero -> mapeo/plantilla -> preview/duplicados -> commit |
| `/reglas` | Reglas | CRUD de reglas, simulacion, aplicacion retroactiva, import |
| `/categorias` | Categorias | Categorias, subcategorias y etiquetas |
| `/cuentas` | Cuentas | Cuentas/fuentes y saldos calculados |
| `/presupuestos` | Presupuestos y metas | Metas por categoria/cuenta/periodo y su consumo |
| `/exportar` | Exportaciones | Export selectivo y backups por perfil |
| `/ajustes` | Ajustes | Moneda, locale, gestion y borrado de perfil |
| (overlay) | Selector de perfil | Cambio/creacion de perfil, siempre accesible en la barra |

Rutas nuevas de la ampliacion (por fase):

| Ruta | Seccion | Contenido | Fase |
|------|---------|-----------|------|
| `/cuenta` | Cuenta | Login, registro, recuperacion, estado de email, cerrar sesion | 1 |
| `/ajustes/seguridad` | Seguridad | PIN, bloqueo automatico, passkeys, sesiones | 3 |
| `/sincronizacion` | Sincronizacion | Estado de sync, mutaciones pendientes, conflictos, reintentar, ultima sincronizacion | 2 |
| `(bloqueada)` | Pantalla bloqueada | Desbloqueo por PIN/passkey; sin datos detras; cerrar sesion | 3 |
| `/comercios` | Comercios | Listado, alias, fusion, reasignacion, revision de sugerencias | 4 |
| `/bandeja` | Bandeja de revision | Tareas por tipo, filtros, acciones masivas, detalle | 6 |
| `/conciliacion` | Conciliacion | Saldo de extracto vs calculado, diferencia, historial | 6 |
| `/recurrencias` | Recurrencias | Series, calendario de proximos cobros, alertas | 7 |
| `/deudas` | Deudas | CRUD de deudas, calendario, simulador, comparador Snowball/Avalanche | 8 |

El selector de perfil vive en el layout (barra superior/lateral) y es accesible desde cualquier seccion. Al no haber ningun perfil, la app fuerza la pantalla de creacion de perfil antes de dar acceso al resto. Con cuenta activada y PIN, la pantalla bloqueada precede a cualquier ruta. La cuenta autenticada es OPCIONAL: sin ella, las rutas de cuenta/sincronizacion invitan a activarla pero la app funciona en modo local.

---

## 5. Flujos de datos principales

### 5.1 Importacion
```
Fichero (CSV/XLSX)
  -> importService.parse (SheetJS)               [lib/csvXlsx]
  -> aplicar ColumnMap + dateFormat + separadores (plantilla o manual)
  -> normalizar importes a centimos              [lib/money]
  -> calcular dedupeHash por fila                 [lib/dedupe]
  -> PREVIEW: marcar posibles duplicados (lookup [profileId+dedupeHash])
  -> usuario revisa, decide saltar/importar
  -> COMMIT: crear ImportBatch + Transactions en una transaccion Dexie
  -> (opcional) aplicar reglas automaticas a los nuevos movimientos
```
Deshacer: borra los `Transaction` con ese `importBatchId` y marca el batch `undone`.

### 5.2 Categorizacion por reglas
```
Movimiento nuevo (o retroactivo)
  -> ruleService.evaluate: recorre reglas enabled por priority
  -> por cada regla: evalua conditions segun matchMode
  -> primera/las que casan aplican RuleAction (categoria, sub, tags, exclusion)
  -> marca categorizedBy='rule', ruleId=regla.id
  -> stopOnMatch corta la cadena si procede
```
Simulacion: mismo motor en modo "dry run", cuenta afectados sin escribir. Aplicacion retroactiva: recorre movimientos existentes del perfil (respetando que la categorizacion manual previa no se pisa salvo que el usuario lo pida).

### 5.3 Dashboard
```
useDashboard(profileId, periodo, filtros)
  -> statsService.compute
  -> transactionsRepo por [profileId+date] y [profileId+statsFlag]=0
  -> agrega en memoria (gasto por categoria, evolucion, ahorro, forecast, ...)
  -> excluye transferencias y padres de split; aplica reembolsos como reduccion de gasto
  -> devuelve series listas para Recharts
```

---

## 6. Estados principales de la app

- **Perfil activo** (`ProfileContext`): id del perfil abierto. Persistido en `localStorage` (solo el id, dato no financiero) para reabrir el mismo perfil al arrancar. Cambiar de perfil recarga todos los datos desde los repositorios con el nuevo `profileId`.
- **Filtros de movimientos**: fecha, concepto, categoria, subcategoria, cuenta, importe, tipo, etiquetas, estado. Estado local de la pagina de movimientos (opcionalmente en URL para compartir/enlazar dentro del dispositivo).
- **Lote de importacion en curso**: estado efimero del wizard (fichero parseado, mapeo, filas y marcas de duplicado) hasta commit o cancelacion.
- **Cola de deshacer / toasts** (`ToastContext`): mensajes de exito/error y accion "deshacer" temporal tras operaciones reversibles.

---

## 7. Comportamiento offline y estrategia PWA

- **Offline completo**: tras la primera carga, la app funciona sin red. Todos los datos operativos estan en IndexedDB; no hay llamadas a servidor para el uso normal. Con cuenta, las escrituras se guardan en local y se encolan para sincronizar cuando vuelva la red.
- **Service worker** (vite-plugin-pwa, estrategia de precache):
  - Precache de los assets propios (JS, CSS, HTML, iconos, manifest).
  - `NavigationFallback` a `index.html` para rutas de la SPA.
  - **Sin runtime caching de dominios externos**: no se cachea nada de terceros. Fuentes e iconos se empaquetan localmente.
  - **Nunca se cachean respuestas financieras remotas de Supabase** en el service worker: los datos vienen de IndexedDB, no del cache HTTP. El SW no intercepta ni almacena las peticiones a la API del usuario. Asi el offline no depende del cache de red y no quedan datos financieros en el cache del SW.
- **Manifest**: nombre, iconos (varios tamanos), `display: standalone`, `theme_color`, `start_url`. App instalable en PC y movil.
- **Actualizaciones**: `PwaReloadPrompt` gestiona nueva version disponible y ofrece recargar. Sin autorefresh silencioso que interrumpa una edicion.
- **Instalabilidad real**: requiere HTTPS. En desarrollo se usa `--host` en LAN; para instalar como PWA, hosting estatico gratuito (p. ej. GitHub Pages). El hosting estatico no anade coste. La sincronizacion, si se activa, requiere conexion al endpoint de Supabase del usuario.

---

## 8. Acciones: confirmacion y deshacer

| Accion | Confirmacion previa | Deshacer |
|--------|--------------------|---------|
| Crear/editar un movimiento | No | Sí (edicion revertible mientras el toast este activo) |
| Borrar un movimiento | Sí | Sí (undo temporal) |
| Borrado masivo de movimientos | Sí (con recuento) | Sí (undo del lote) |
| Edicion masiva de movimientos | Sí (con recuento) | Sí (undo del lote) |
| Import commit | No (preview ya es la revision) | Sí (deshacer ImportBatch) |
| Aplicacion retroactiva de reglas | Sí (muestra simulacion antes) | Parcial (registra snapshot de los cambios para revertir) |
| Borrar categoria/cuenta/etiqueta con uso | Sí (obliga a reasignar o bloquear) | No (se previene, no se deshace) |
| Borrar perfil | Sí (doble confirmacion, escribe el nombre) | No (destructivo, irreversible) |
| Restaurar backup | Sí (advierte de sobrescritura) | No directamente (se recomienda backup previo) |

Principio: toda accion destructiva o masiva confirma con recuento explicito; las reversibles ofrecen "deshacer" via toast. Sin errores silenciosos.

---

## 9. Garantia de aislamiento por perfil

Se implementa en cuatro puntos (detalle en `DATA_MODEL.md` seccion 4):
1. **Contexto de perfil activo** (`ProfileContext`) es la unica fuente del `profileId` en uso.
2. **Repositorios** exigen `profileId` como primer parametro obligatorio; no existen metodos "todos los perfiles".
3. **Indices** siempre encabezados por `profileId`.
4. **Componentes** no acceden a Dexie; solo a hooks/servicios que ya llevan `profileId`.

No existe ninguna vista, calculo ni exportacion que combine datos de varios perfiles. Una eventual "vista global" solo se anadiria con autorizacion expresa del usuario (fuera del MVP). El subagente `privacy-auditor` audita esto al cerrar cada fase.

---

## 10. Seguridad de acceso local: PIN, bloqueo y cifrado de sesion (ampliacion, fase 3)

Detalle en `CLOUD_SYNC_SECURITY.md`. Resumen arquitectonico:

- **Distincion de credenciales**: contrasena de cuenta (Supabase, identifica a la persona) != PIN local (protege el acceso en el dispositivo) != passkey/biometria (verificacion del sistema via WebAuthn). No se confunden en la UI.
- **PIN local**: opcional, minimo 6 digitos. Se deriva con Web Crypto (sal aleatoria, parametros versionados); se guarda un verificador, nunca el PIN. Bloqueo automatico configurable (inmediato, 1, 5, 15, 30 min) y al volver del segundo plano; contador de intentos con espera progresiva.
- **Cifrado de sesion**: cuando hay PIN, la sesion de Supabase persistida se cifra con AES-GCM usando una clave derivada del PIN. La clave vive solo en memoria mientras la app esta desbloqueada y se borra al bloquear. No existe una copia sin cifrar en otro storage.
- **Passkeys**: solo WebAuthn/APIs oficiales, tras feature flag `VITE_ENABLE_PASSKEYS` (desactivada por defecto si la integracion sigue experimental). La biometria la gestiona el SO; la app nunca recibe datos biometricos. Siempre se conservan contrasena y PIN como fallback; nadie puede quedarse sin metodo de acceso.
- **Pantalla bloqueada**: sin datos ni cifras detras, sin overlay transparente; permite PIN, passkey si esta disponible y cerrar sesion; accesible con teclado y lector de pantalla. Mientras esta bloqueada no se sincroniza en segundo plano.
- **Preparacion previa (vigente)**: los repositorios son el unico punto de lectura/escritura; `Setting.encryptionEnabled` ya existe en el modelo. El cifrado de la BASE local completa (mas alla de la sesion) sigue fuera de alcance, con la arquitectura lista para envolver `get`/`put`.

---

## 11. Testing (resumen)

- `services/` y `lib/`: cobertura obligatoria con Vitest (calculos financieros, motor de reglas, parseo de import, dedupe, aislamiento).
- Repositorios: tests con `fake-indexeddb` que demuestran que las queries de un perfil no devuelven datos de otro.
- Ampliacion: tests de outbox e idempotencia, resolucion de conflictos, migracion de perfiles locales, dispositivo nuevo, cifrado de sesion (sesion no legible sin desbloqueo, sin copia sin cifrar), normalizacion de comercios, duplicados multinivel, bandeja idempotente, conciliacion, recurrencias, y fixtures financieros de deudas (calendario, Snowball, Avalanche). RLS verificada con entorno local, pruebas SQL o estrategia automatizada.
- Cada fase cierra con `privacy-auditor` y, si toca calculos, `finance-auditor` (segun CLAUDE.md).

---

# ARQUITECTURA DE LA AMPLIACION (secciones 12 en adelante)

Todo aditivo. IndexedDB sigue siendo la base operativa. Detalle de seguridad en `CLOUD_SYNC_SECURITY.md`; fases y dependencias en `IMPLEMENTATION_ROADMAP.md`.

## 12. Modelo local-first con copia remota

- **Fuente operativa**: IndexedDB. Toda lectura de la app viene de local. Toda escritura del usuario se valida, se guarda en local primero, genera una mutacion en la outbox y actualiza la UI sin esperar a la red. Un movimiento no se presenta como "sincronizado" hasta la confirmacion remota.
- **Copia remota**: Supabase guarda una copia privada por usuario. Se usa para: descargar cambios de otros dispositivos, confirmar mutaciones, reconstruir un dispositivo nuevo y resolver conflictos. No es la fuente de la UI.
- **Modo local**: sin cuenta, todo funciona igual salvo que no hay outbox activa ni sincronizacion; `syncStatus = 'local'`.

## 13. Motor de sincronizacion

Flujo (resumen):
```
Escritura del usuario
  -> validar -> escribir en Dexie (base operativa) -> encolar mutacion en outbox (mutationId unico)
  -> UI actualizada al instante (optimista, marcada 'pending')
Planificador de sync (disparadores: login, recuperar conexion, tras mutacion local,
                       volver a primer plano, boton manual)
  -> PUSH por lotes: envia mutaciones 'queued' respetando dependencias
      -> si baseRevision coincide: el servidor aplica, incrementa revision, responde -> 'synced'
      -> si baseRevision es vieja: rechazo -> se crea Conflict (seccion 15)
  -> PULL: descarga filas remotas con revision mayor a la conocida -> upsert en Dexie por UUID
  -> reintentos con espera progresiva, limites, cancelacion segura, reanudacion y progreso
```
- **Idempotencia**: el `mutationId` y el reuso del UUID como PK remota garantizan que reenviar no duplica. Las importaciones grandes se agrupan por `importBatchId` y se procesan por lotes.
- **Borrado logico**: `delete` es set `deletedAt`; nunca borrado fisico de entidades sincronizables mientras otros dispositivos puedan reintroducirlas.
- **Mientras la app esta bloqueada (PIN)** no se sincroniza en segundo plano.

## 14. Almacenamiento de sesion y comportamiento en otro dispositivo

- **Sesion**: la maneja Supabase Auth. Con PIN, se persiste cifrada (AES-GCM, clave derivada del PIN, solo en memoria al desbloquear). Sin PIN, se usa el almacenamiento estandar del SDK. El cierre de sesion borra la sesion local y detiene la sincronizacion.
- **Iniciar sesion en un dispositivo con datos locales sin vincular**: se ofrece el asistente de MIGRACION (seccion 16). No se mezcla en silencio.
- **Iniciar sesion en un dispositivo vacio**: se detectan los perfiles remotos, se descargan por lotes y se reconstruye IndexedDB con progreso; no se muestra un dashboard vacio mientras carga; se valida esquema y relaciones; queda operativo offline despues.

## 15. Resolucion de conflictos

- Un conflicto surge cuando el `baseRevision` de una mutacion ya no es la revision remota vigente.
- Se conservan version local y remota; se muestran entidad y diferencias. Opciones: mantener local, mantener remota, o combinar solo campos seguros no monetarios.
- **Nunca** se fusionan importes de movimientos campo a campo de forma automatica (invariante 11). La resolucion la decide la persona para entidades financieras; se registra y genera una mutacion idempotente sobre la revision remota.
- `Setting` (no financiero) puede resolverse last-write-wins sin conflicto visible.

## 16. Migracion inicial de perfiles locales

Al iniciar sesion y detectar datos locales no vinculados, asistente que: lista perfiles con recuentos (cuentas, movimientos, categorias, reglas, presupuestos, plantillas, lotes); permite elegir cuales migrar; ofrece backup previo; conserva los UUID; asigna `ownerUserId`; sube por lotes respetando dependencias; valida recuentos y relaciones; permite reanudar; evita duplicar si se repite (upsert por UUID); no borra datos locales; y solo marca el perfil como migrado tras verificar. Registrado en la tabla de migracion (ver `DATA_MODEL.md` seccion 13.2).

## 17. Eventos que generan tareas de revision (bandeja)

La bandeja (ruta `/bandeja`, `ReviewItem`) se alimenta de eventos, no de sondeos. Generacion idempotente. Eventos:
- Importar: movimiento sin categorizar, error de fila, comercio nuevo, posible duplicado.
- Ejecutar reglas: regla con baja confianza.
- Sincronizar: conflicto de sincronizacion.
- Deteccion: transferencia candidata, reembolso candidato, pendiente antiguo, anomalia recurrente (subida de precio, cobro ausente, cobro duplicado).

Flujo posterior a importar: `Importar -> Revisar excepciones (bandeja) -> Conciliar -> Ver resultados`. Si no hay tareas, se puede ir directo a conciliacion o al resumen.

## 18. Backups, auditoria y trazabilidad

- **Backups**: siguen siendo por perfil (JSON con version de esquema). Con la ampliacion incluyen las nuevas entidades y los campos de sincronizacion, y EXCLUYEN siempre PIN, contrasenas, tokens, credenciales WebAuthn y sesiones. La restauracion es idempotente (upsert por UUID) y genera mutaciones sin duplicar. Los archivos bancarios originales no forman parte del backup ni se suben por defecto.
- **Trazabilidad**: cada movimiento conserva `rawConcept` (original), `categorizedBy`/`ruleId` (como se categorizo), `merchantMatchSource` (como se asocio el comercio), `duplicateStatus`/`duplicateReasonCodes` (decision de duplicado) e `importBatchId` (origen). Los datos derivados llevan version de algoritmo (seccion 20 de `DATA_MODEL.md`). Las resoluciones de conflicto y las decisiones de no-duplicado quedan registradas. Nada se altera dos veces (idempotencia) ni en silencio.

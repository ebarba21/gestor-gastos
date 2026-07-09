# ARCHITECTURE: arquitectura funcional

Arquitectura de la PWA de gestion de gastos. Local-first, coste 0, aislada por perfil. Este documento define modulos, responsabilidades, flujos, estructura de carpetas, comportamiento offline, PWA y garantias de aislamiento.

Relacionado: `PRD.md` (que se construye) y `DATA_MODEL.md` (entidades y persistencia). Ante contradiccion con los invariantes de `CLAUDE.md`, mandan los invariantes.

---

## 1. Principios de arquitectura

1. **Local-first / client-side puro**: toda la logica corre en el navegador. No hay backend. Los datos financieros viven en IndexedDB (Dexie) del dispositivo y nunca salen de el.
2. **Coste 0**: sin APIs de pago, sin BBDD cloud, sin auth cloud, sin IA externa. Las unicas peticiones de red permitidas en runtime son los assets propios de la PWA (los sirve el service worker).
3. **Separacion en capas estricta**: UI -> servicios -> repositorios -> Dexie. Los componentes nunca tocan Dexie directamente.
4. **Aislamiento por perfil por diseno**: `profileId` obligatorio en toda la capa de datos (ver `DATA_MODEL.md` seccion 4).
5. **Dinero en centimos enteros** en toda la logica; el formateo a euros solo en presentacion.
6. **Sin telemetria ni analytics**. Sin errores silenciosos: validacion y manejo de errores explicitos.

---

## 2. Capas y responsabilidades

```
┌─────────────────────────────────────────────┐
│ UI:  pages/ + components/ + hooks/           │  React, Tailwind. Sin logica de negocio.
├─────────────────────────────────────────────┤
│ Estado app: context/ (perfil activo, etc.)   │  Contextos ligeros + hooks de datos.
├─────────────────────────────────────────────┤
│ Servicios: services/                         │  Logica de negocio: import, reglas,
│                                              │  stats/calculo, export, backup, perfiles.
├─────────────────────────────────────────────┤
│ Repositorios: db/                            │  Unico acceso a Dexie. Exigen profileId.
├─────────────────────────────────────────────┤
│ Dexie / IndexedDB                            │  Persistencia local del dispositivo.
└─────────────────────────────────────────────┘
```

- **`db/` (repositorios)**: unico punto que abre Dexie. Un repositorio por entidad (`transactionsRepo`, `accountsRepo`, etc.). Todos los metodos reciben `profileId` como primer parametro obligatorio. Nada de logica de negocio aqui: solo CRUD, queries por indice y transacciones Dexie.
- **`services/` (logica de negocio)**: orquestan repositorios y contienen los calculos. No conocen React. Se testean con Vitest de forma aislada. Modulos:
  - `profileService`: crear, cambiar, archivar, borrar perfil (con cascada).
  - `importService`: parseo CSV/XLSX (SheetJS), aplicar `ColumnMap`, normalizar importes a centimos, calcular `dedupeHash`, preview, commit, deshacer lote.
  - `ruleService`: motor de reglas (evaluar condiciones, prioridad, `matchMode`, `stopOnMatch`), aplicacion a movimientos nuevos, aplicacion retroactiva, simulacion (cuenta afectados sin escribir), import de reglas.
  - `statsService`: calculos del dashboard (gasto por categoria, evolucion mensual, ingresos vs gastos, ahorro neto, tasa de ahorro, top gastos, recurrentes, comparativa vs promedio, forecast). Respeta `excludedFromStats`, transferencias, splits y reembolsos.
  - `budgetService`: consumo de presupuestos/metas por periodo.
  - `exportService`: generar XLSX/CSV de movimientos, reglas, categorias, cuentas, metas, dashboard (SheetJS).
  - `backupService`: exportar/importar backup completo por perfil (JSON con version de esquema).
  - `moneyService` / `lib` de dinero: parseo y formateo centimos<->euros, sin floats.
- **`hooks/`**: puentes React <-> servicios (`useProfiles`, `useTransactions`, `useDashboard`, ...). Encapsulan carga, estados de loading/error y revalidacion. Un componente consume hooks, nunca servicios directamente para datos asincronos complejos (se permite llamar a servicios en handlers de accion).
- **`components/` y `pages/`**: presentacion e interaccion. Sin acceso a Dexie ni calculos financieros.

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

El selector de perfil vive en el layout (barra superior/lateral) y es accesible desde cualquier seccion. Al no haber ningun perfil, la app fuerza la pantalla de creacion de perfil antes de dar acceso al resto.

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

- **Offline completo**: tras la primera carga, la app funciona sin red. Todos los datos estan en IndexedDB; no hay llamadas a servidor para leer/escribir.
- **Service worker** (vite-plugin-pwa, estrategia de precache):
  - Precache de los assets propios (JS, CSS, HTML, iconos, manifest).
  - `NavigationFallback` a `index.html` para rutas de la SPA.
  - **Sin runtime caching de dominios externos**: no se cachea nada de terceros porque no se piden recursos de terceros (invariante 3 de CLAUDE.md). Fuentes e iconos se empaquetan localmente.
- **Manifest**: nombre, iconos (varios tamanos), `display: standalone`, `theme_color`, `start_url`. App instalable en PC y movil.
- **Actualizaciones**: `PwaReloadPrompt` gestiona nueva version disponible y ofrece recargar. Sin autorefresh silencioso que interrumpa una edicion.
- **Instalabilidad real**: requiere HTTPS. En desarrollo se usa `--host` en LAN; para instalar como PWA, hosting estatico gratuito (p. ej. GitHub Pages) en fase 7. El hosting estatico no rompe el coste 0.

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

## 10. Preparacion para cifrado local (fase 2, no implementar)

- Los repositorios son el unico punto de lectura/escritura, asi que una futura capa de cifrado (Web Crypto) puede envolver `get`/`put` sin tocar la UI ni los servicios.
- `Setting.encryptionEnabled` ya existe en el modelo. En MVP siempre `false`.
- No se diseña ningun campo en claro que impida cifrar despues: los importes y conceptos pasan siempre por el repositorio.
- La contrasena/clave nunca se persistiria en claro; derivacion en memoria. Esto es fase 2; aqui solo se deja la arquitectura lista.

---

## 11. Testing (resumen)

- `services/` y `lib/`: cobertura obligatoria con Vitest (calculos financieros, motor de reglas, parseo de import, dedupe, aislamiento).
- Repositorios: tests con `fake-indexeddb` que demuestran que las queries de un perfil no devuelven datos de otro.
- Cada fase cierra con `privacy-auditor` y, si toca calculos, `finance-auditor` (segun CLAUDE.md).

# DATA_MODEL: modelo de datos (Dexie local + Supabase remoto)

Fuente de verdad de entidades y campos. Todo el codigo de `src/db/` y `src/services/` debe respetar este documento. Si una implementacion contradice este modelo, hay que avisar al usuario antes de continuar.

Relacionado: ver `ARCHITECTURE.md` (capa de acceso a datos y aislamiento), `CLOUD_SYNC_SECURITY.md` (RLS, cola de salida, cifrado), `FINANCIAL_ALGORITHMS.md` (semantica de calculo) y `PRD.md` (alcance funcional).

Estructura de este documento:

- Secciones 1 a 8: modelo LOCAL vigente (Dexie v1), tal como esta implementado hoy en `src/db/schema.ts` y `src/db/index.ts`. Es la base operativa y no cambia su semantica.
- Secciones 9 en adelante: modelo OBJETIVO de la ampliacion (marcado como "ampliacion"). Anade campos de sincronizacion, entidad de usuario, comercios, duplicados avanzados, bandeja, conciliacion, recurrencias y deudas. Se implementa por fases (ver `IMPLEMENTATION_ROADMAP.md`); mientras una fase no llega, sus campos/tablas no existen todavia en el codigo.

Los campos de la ampliacion se anaden de forma ADITIVA (nuevas tablas, columnas nullable con valor por defecto). Nunca se elimina ni se reinterpreta un campo existente.

---

## 1. Convenciones generales

- **Dinero**: siempre entero en centimos (`amountCents: number`, entero). Nunca floats para importes. 12,34 euros se guarda como `1234`. Formateo a euros solo en la capa de presentacion.
- **Tipos de interes (ampliacion, deudas)**: siempre entero, nunca float. Representacion documentada en **micro-fraccion 1e-6**: se guarda la fraccion anual multiplicada por 1.000.000. Ejemplo: 3,25% anual = 0,0325 -> `32500`. Resolucion 0,0001%. Los porcentajes de tolerancia (recurrencias) usan la misma escala entera (`amountTolerancePpm`). Ver `FINANCIAL_ALGORITHMS.md`.
- **Signo del importe**: gasto negativo, ingreso positivo. Las transferencias usan signo segun sean salida (negativo) o entrada (positivo). El campo `type` es la fuente de verdad del tipo; el signo es coherente con `type` y se valida al escribir.
- **Moneda**: `EUR` por defecto, a nivel de perfil (`Setting.currency`). El MVP asume una unica moneda por perfil. No se hace conversion de divisas.
- **Identificadores**: `id: string` generado con `crypto.randomUUID()`. Claves primarias no autoincrementales para que los backups sean portables entre dispositivos sin colisiones.
- **profileId obligatorio**: toda entidad de datos (salvo `Profile`, que es la raiz) lleva `profileId: string` y es el primer campo de sus indices compuestos. Ningun repositorio expone metodos sin `profileId`.
- **Fechas**:
  - `date` de un movimiento: string `YYYY-MM-DD` (fecha contable, sin hora ni zona horaria, para evitar desfases). Ordenable lexicograficamente.
  - Timestamps de auditoria (`createdAt`, `updatedAt`): numero epoch en milisegundos (`Date.now()`).
- **Timestamps**: toda entidad persistente lleva `createdAt` y `updatedAt` (epoch ms).
- **Enums**: se modelan como uniones de string literales en TypeScript. Se listan los valores validos por campo.
- **Booleans**: en indices Dexie, los booleanos no se indexan bien; cuando haga falta filtrar por un flag se usa un campo indexable derivado (ver `Transaction.excludedFromStats` y nota de indices).
- **Sin datos calculados persistidos** salvo los expresamente indicados (p. ej. `dedupeHash`). Los totales del dashboard se calculan en runtime.

---

## 2. Entidades

### 2.1 Profile

Perfil local de usuario. Es la raiz del aislamiento: no tiene `profileId` propio.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `name` | `string` | Nombre visible del perfil |
| `color` | `string` | Color/acento para la UI (hex) |
| `avatarEmoji` | `string \| null` | Emoji opcional como avatar |
| `createdAt` | `number` | epoch ms |
| `updatedAt` | `number` | epoch ms |
| `archivedAt` | `number \| null` | Si esta archivado (no borrado) |

Notas:
- Borrar un perfil implica borrar en cascada todas sus entidades hijas (transaccion Dexie que barre por `profileId`). Accion destructiva: requiere confirmacion (ver `ARCHITECTURE.md`). Con sincronizacion activa, el borrado es logico (`deletedAt`) para que no reaparezca desde otro dispositivo (ver seccion 9).
- La preferencia de "perfil activo" NO vive aqui; vive en `localStorage` (clave no sensible, solo un id) para saber que perfil abrir al arrancar. Ver `ARCHITECTURE.md`.
- Ampliacion: el perfil gana `ownerUserId: string | null` (id del usuario Supabase propietario) y campos de sincronizacion. `ownerUserId` es `null` mientras el perfil solo existe en local sin cuenta; al migrar/vincular pasa a ser el `auth.users.id`. Ver secciones 9 y 10.

### 2.2 Setting

Configuracion por perfil. Un registro por perfil (relacion 1:1).

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile. Unico por perfil |
| `currency` | `string` | ISO 4217, por defecto `'EUR'` |
| `locale` | `string` | Formato de numeros/fechas en UI, p. ej. `'es-ES'` |
| `weekStart` | `'monday' \| 'sunday'` | Inicio de semana para agrupaciones |
| `defaultAccountId` | `string \| null` | Cuenta por defecto al crear movimientos |
| `encryptionEnabled` | `boolean` | Reservado fase 2 (Web Crypto). En MVP siempre `false` |
| `createdAt` / `updatedAt` | `number` | epoch ms |

Nota cifrado (fase 2): `encryptionEnabled` se define ahora para no migrar el esquema despues. En el MVP no se usa; la capa de cifrado envolvera la lectura/escritura en los repositorios sin cambiar campos. Ver `ARCHITECTURE.md`.

### 2.3 Account

Cuenta o fuente de dinero (banco principal, tarjeta, efectivo, PayPal, cuenta conjunta, etc.).

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `name` | `string` | Nombre visible |
| `kind` | `'bank' \| 'card' \| 'cash' \| 'wallet' \| 'shared' \| 'other'` | Tipo de fuente |
| `currency` | `string` | Por defecto igual a `Setting.currency` |
| `color` | `string \| null` | Acento en UI |
| `openingBalanceCents` | `number` | Saldo inicial en centimos (entero, puede ser 0) |
| `archivedAt` | `number \| null` | Archivada sin borrar |
| `createdAt` / `updatedAt` | `number` | epoch ms |

Notas:
- El saldo actual de una cuenta se calcula (`openingBalanceCents + suma de movimientos de esa cuenta`), no se persiste.
- No se puede borrar una cuenta con movimientos sin resolver primero (reasignar o borrar movimientos). Se ofrece archivar como alternativa.

### 2.4 Category

Categoria de clasificacion. Las subcategorias se modelan como categorias con `parentId` (un unico nivel de anidamiento en el MVP).

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `name` | `string` | Nombre visible |
| `parentId` | `string \| null` | `null` = categoria raiz; con valor = subcategoria |
| `kind` | `'expense' \| 'income' \| 'both'` | Para que tipos de movimiento aplica |
| `color` | `string \| null` | Acento en UI |
| `icon` | `string \| null` | Nombre de icono o emoji |
| `archivedAt` | `number \| null` | Archivada sin borrar |
| `sortOrder` | `number` | Orden manual en UI |
| `createdAt` / `updatedAt` | `number` | epoch ms |

Notas:
- Decision: subcategoria = `Category` con `parentId`. Evita una tabla extra y da flexibilidad. Se restringe a un solo nivel en el MVP (una subcategoria no puede tener hijos); se valida al crear.
- Un movimiento referencia `categoryId` (raiz o sub) y opcionalmente `subcategoryId` cuando se quiera guardar el par explicito. Ver `Transaction`.

### 2.5 Tag

Etiqueta libre para clasificacion transversal (independiente de categoria).

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `name` | `string` | Nombre visible, unico por perfil (normalizado) |
| `color` | `string \| null` | Acento en UI |
| `createdAt` / `updatedAt` | `number` | epoch ms |

Nota: en `Transaction`, las etiquetas se guardan como `tagIds: string[]` (multivaluado). Dexie soporta indice `multiEntry` sobre ese array para filtrar por etiqueta.

### 2.6 Transaction (movimiento)

Entidad central. Un extracto bancario se materializa como muchos `Transaction`.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `date` | `string` | `YYYY-MM-DD` (fecha contable) |
| `amountCents` | `number` | Entero en centimos. Gasto negativo, ingreso positivo |
| `type` | `'expense' \| 'income' \| 'transfer'` | Fuente de verdad del tipo |
| `concept` | `string` | Descripcion original o editada |
| `notes` | `string \| null` | Nota libre del usuario |
| `accountId` | `string` | FK a Account |
| `categoryId` | `string \| null` | FK a Category (raiz o sub) |
| `subcategoryId` | `string \| null` | FK a Category con parentId. Opcional |
| `tagIds` | `string[]` | FKs a Tag (multiEntry) |
| `status` | `'cleared' \| 'pending' \| 'reconciled'` | Estado del movimiento |
| `categorizedBy` | `'manual' \| 'rule' \| 'import' \| 'none'` | Como se categorizo (invariante CLAUDE.md) |
| `ruleId` | `string \| null` | Regla que lo categorizo, si `categorizedBy === 'rule'` |
| `transferGroupId` | `string \| null` | Enlaza las dos patas de una transferencia interna |
| `parentId` | `string \| null` | Si es una linea hija de un split, apunta al movimiento padre |
| `isSplitParent` | `boolean` | `true` si tiene lineas hijas (split) |
| `refundOfId` | `string \| null` | Si es un reembolso, apunta al gasto original |
| `excludedFromStats` | `boolean` | `true` = no cuenta en estadisticas de gasto/ingreso |
| `statsFlag` | `0 \| 1` | Espejo indexable de `excludedFromStats` (1 = excluido). Ver indices |
| `importBatchId` | `string \| null` | Lote de importacion de origen (para deshacer) |
| `dedupeHash` | `string` | Hash para deteccion de duplicados (ver seccion 5) |
| `createdAt` / `updatedAt` | `number` | epoch ms |

Reglas de integridad:
- `type` coherente con signo de `amountCents`: `expense` no positivo, `income` no negativo, `transfer` segun pata. Se valida al escribir.
- Si `categorizedBy === 'rule'` entonces `ruleId` no es `null`. Si `!== 'rule'` entonces `ruleId` es `null`.
- Si `parentId !== null`, el movimiento es una linea de split y su `amountCents` suma (con las demas lineas) el importe del padre. El padre lleva `isSplitParent = true`.
- `transferGroupId` agrupa exactamente dos movimientos (salida y entrada) en el MVP.
- `statsFlag` se mantiene sincronizado con `excludedFromStats` en cada escritura (responsabilidad del repositorio).

### 2.7 Rule (regla de autocategorizacion)

Regla con una o varias condiciones y una accion de categorizacion/etiquetado.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `name` | `string` | Nombre visible |
| `enabled` | `boolean` | Activa o no |
| `priority` | `number` | Menor numero = mayor prioridad. Orden de evaluacion |
| `matchMode` | `'all' \| 'any'` | Todas las condiciones o al menos una |
| `conditions` | `RuleCondition[]` | Ver estructura abajo (embebido) |
| `action` | `RuleAction` | Ver estructura abajo (embebido) |
| `stopOnMatch` | `boolean` | Si al casar se detiene la evaluacion de reglas siguientes |
| `createdAt` / `updatedAt` | `number` | epoch ms |

`RuleCondition` (objeto embebido, no tabla):

| Campo | Tipo | Notas |
|-------|------|-------|
| `field` | `'concept' \| 'amount' \| 'date' \| 'account' \| 'type'` | Campo sobre el que evalua |
| `operator` | ver abajo | Operador segun `field` |
| `value` | `string \| number` | Valor de comparacion |
| `value2` | `string \| number \| null` | Segundo valor (rangos) |
| `caseSensitive` | `boolean` | Solo para texto |

Operadores por campo:
- `concept` (texto): `contains`, `notContains`, `startsWith`, `endsWith`, `equals`, `regex`.
- `amount` (centimos): `gt`, `lt`, `gte`, `lte`, `eq`, `between` (usa `value` y `value2`).
- `date`: `between` (rango `value`..`value2`, formato `YYYY-MM-DD`), `before`, `after`.
- `account`: `equals` (value = accountId).
- `type`: `equals` (value = `expense|income|transfer`).

`RuleAction` (objeto embebido):

| Campo | Tipo | Notas |
|-------|------|-------|
| `setCategoryId` | `string \| null` | Categoria a asignar |
| `setSubcategoryId` | `string \| null` | Subcategoria a asignar |
| `addTagIds` | `string[]` | Etiquetas a anadir |
| `setExcludedFromStats` | `boolean \| null` | Forzar exclusion, o `null` para no tocar |

Notas:
- La regex es opcional y se valida/compila con manejo de error explicito. Una regex invalida no rompe el motor: la condicion se marca como no casada y se avisa.
- Al aplicar una regla, el movimiento pasa a `categorizedBy = 'rule'` y `ruleId = regla.id`. La categorizacion manual posterior tiene prioridad y cambia `categorizedBy` a `'manual'`.
- Import de reglas desde CSV/XLSX: se mapean columnas a esta estructura; ver `PRD.md`.

### 2.8 Budget (presupuesto / meta)

Meta o limite por dimension y periodo.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `name` | `string` | Nombre visible |
| `scope` | `'category' \| 'subcategory' \| 'account' \| 'overall'` | Sobre que se mide |
| `scopeId` | `string \| null` | Id de la categoria/subcategoria/cuenta segun scope (`null` si overall) |
| `direction` | `'expense' \| 'income'` | Meta de gasto (limite) o de ingreso/ahorro (objetivo) |
| `limitCents` | `number` | Importe objetivo/limite en centimos |
| `period` | `'monthly' \| 'quarterly' \| 'yearly' \| 'custom'` | Periodicidad |
| `customStart` | `string \| null` | `YYYY-MM-DD` si period = custom |
| `customEnd` | `string \| null` | `YYYY-MM-DD` si period = custom |
| `rollover` | `boolean` | Si el sobrante/deficit pasa al periodo siguiente (fase 2: solo se guarda el flag) |
| `archivedAt` | `number \| null` | Archivada sin borrar |
| `createdAt` / `updatedAt` | `number` | epoch ms |

Nota: el consumo del presupuesto (cuanto se lleva gastado) se calcula en runtime sobre los movimientos del periodo, respetando `excludedFromStats`.

### 2.9 ImportTemplate (plantilla de importacion)

Mapeo reutilizable de columnas de un fichero a campos internos.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `name` | `string` | Nombre visible (p. ej. "Banco X CSV") |
| `sourceFormat` | `'csv' \| 'xlsx'` | Formato esperado |
| `columnMap` | `ColumnMap` | Mapeo columna->campo (embebido) |
| `dateFormat` | `string` | Formato de fecha del fichero, p. ej. `'dd/MM/yyyy'` |
| `decimalSeparator` | `',' \| '.'` | Separador decimal del fichero |
| `thousandSeparator` | `',' \| '.' \| '' ` | Separador de miles |
| `amountStrategy` | `'signed' \| 'debitCredit'` | Un campo con signo, o dos columnas debe/haber |
| `defaultAccountId` | `string \| null` | Cuenta destino por defecto |
| `hasHeaderRow` | `boolean` | Si la primera fila es cabecera |
| `createdAt` / `updatedAt` | `number` | epoch ms |

`ColumnMap` (embebido): asocia nombre/indice de columna del fichero a `date`, `concept`, `amount` (o `debit`/`credit`), `account`, `notes`. Campos no mapeados se ignoran.

### 2.10 ImportBatch (lote de importacion)

Registro de una importacion para permitir deshacer y para trazabilidad de duplicados.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `templateId` | `string \| null` | Plantilla usada, si aplica |
| `fileName` | `string` | Nombre del fichero importado |
| `importedAt` | `number` | epoch ms |
| `rowsTotal` | `number` | Filas leidas del fichero |
| `rowsImported` | `number` | Movimientos creados |
| `rowsSkippedDuplicate` | `number` | Filas saltadas por duplicado |
| `status` | `'committed' \| 'undone'` | Si el lote sigue vigente o se deshizo |
| `createdAt` / `updatedAt` | `number` | epoch ms |

Nota: deshacer un lote borra los `Transaction` con ese `importBatchId` (transaccion Dexie) y marca el batch como `undone`. Ver `ARCHITECTURE.md`.

---

## 3. Indices Dexie (esquema version 1)

Regla: todo indice de datos empieza por `profileId` para que el filtrado por perfil sea barato y por diseno. `&` = unico, `*` = multiEntry, `[a+b]` = compuesto.

```ts
db.version(1).stores({
  profiles:        'id, archivedAt, name',
  settings:        'id, &profileId',
  accounts:        'id, profileId, [profileId+kind], [profileId+archivedAt]',
  categories:      'id, profileId, [profileId+parentId], [profileId+kind], [profileId+archivedAt]',
  tags:            'id, profileId, [profileId+name]',
  transactions:    'id, profileId, ' +
                   '[profileId+date], [profileId+accountId], [profileId+categoryId], ' +
                   '[profileId+type], [profileId+statsFlag], [profileId+transferGroupId], ' +
                   '[profileId+parentId], [profileId+refundOfId], [profileId+importBatchId], ' +
                   '[profileId+dedupeHash], *tagIds',
  rules:           'id, profileId, [profileId+enabled], [profileId+priority]',
  budgets:         'id, profileId, [profileId+scope], [profileId+archivedAt]',
  importTemplates: 'id, profileId, [profileId+name]',
  importBatches:   'id, profileId, [profileId+importedAt], [profileId+status]',
});
```

Notas de indexacion:
- `*tagIds` es multiEntry: permite `where('tagIds').equals(tagId)` pero siempre se combina con filtro de perfil en la query (ver seccion 4). Para consultas por etiqueta dentro de un perfil, se filtra `profileId` en memoria o con `filter`, porque `multiEntry` no compone bien con compuestos. Es aceptable: las etiquetas son de baja cardinalidad.
- `statsFlag` (0/1) permite `[profileId+statsFlag]` para traer rapido los movimientos que cuentan en estadisticas (`statsFlag = 0`). Los booleanos puros no se indexan de forma fiable en IndexedDB, por eso el espejo numerico.
- `[profileId+date]` es el indice de trabajo del dashboard y de la lista de movimientos (rango de fechas + orden).
- `[profileId+dedupeHash]` da deteccion de duplicados en O(log n) por lookup.

---

## 4. Materializacion del filtrado por profileId

Invariante 4 de CLAUDE.md: ninguna query, calculo, exportacion ni vista cruza perfiles. Se garantiza por capas:

1. **Indices**: `profileId` es siempre el primer campo del indice compuesto. Ninguna consulta de datos usa un indice que no arranque por `profileId`.
2. **Repositorios** (`src/db/`): cada metodo recibe `profileId` como primer parametro obligatorio (no opcional). Ejemplo de contrato:
   ```ts
   listTransactions(profileId: string, filter: TxFilter): Promise<Transaction[]>
   ```
   No existe ningun metodo `listAllTransactions()` sin perfil.
3. **Escritura**: al crear/actualizar, el repositorio fija `profileId` desde el contexto de perfil activo; nunca lo toma del payload del componente sin validar.
4. **Borrado de perfil**: barrido por `profileId` en una unica transaccion Dexie sobre todas las tablas hijas.
5. **Prohibido en componentes**: los componentes nunca abren Dexie directamente (ver `ARCHITECTURE.md`); solo llaman a repositorios que ya exigen `profileId`.

Auditoria: el subagente `privacy-auditor` verifica que no haya accesos a Dexie fuera de `src/db/` ni queries sin `profileId`.

---

## 5. Deteccion de duplicados (dedupeHash)

Objetivo: al importar, detectar filas que probablemente ya existen sin bloquear importaciones legitimas de movimientos identicos reales.

- `dedupeHash = hash(profileId + accountId + date + amountCents + normalize(concept))`.
  - `normalize(concept)`: minusculas, trim, colapso de espacios, quitar acentos.
  - Hash local (p. ej. FNV-1a o SHA-256 truncado via SubtleCrypto disponible offline; sin librerias de red).
- En la previsualizacion de import, para cada fila se calcula el hash y se busca en `[profileId+dedupeHash]`.
  - Coincidencia => se marca la fila como "posible duplicado"; el usuario decide importar igualmente o saltar.
- No es una clave unica dura: dos compras reales identicas el mismo dia en la misma cuenta pueden ser legitimas. Por eso es aviso, no bloqueo.
- El hash se persiste en el `Transaction` para acelerar futuras importaciones.

---

## 6. Casos especiales (modelado detallado)

### 6.1 Transferencias internas
- Dos `Transaction` con el mismo `transferGroupId`:
  - Pata de salida: `type='transfer'`, `amountCents` negativo, `accountId` = cuenta origen.
  - Pata de entrada: `type='transfer'`, `amountCents` positivo, `accountId` = cuenta destino.
- Ambas con `excludedFromStats = true` (y `statsFlag = 1`): una transferencia no es gasto ni ingreso, solo mueve dinero entre cuentas propias. Si afectara a estadisticas, inflaria gasto e ingreso a la vez.
- El saldo por cuenta si las tiene en cuenta (cada pata afecta a su cuenta).
- MVP: el usuario crea el par manualmente (elige cuenta origen, destino, importe, fecha). Fase 2: deteccion inteligente de pares candidatos.

### 6.2 Splits (movimientos divididos)
- Un movimiento padre (`isSplitParent = true`) se reparte en N lineas hijas (`parentId = padre.id`), cada una con su `categoryId`/`subcategoryId` y su porcion de `amountCents`.
- Invariante: suma de `amountCents` de las hijas = `amountCents` del padre. Se valida al guardar.
- En estadisticas cuentan las **hijas** (tienen la categoria real); el **padre** se excluye del computo de gasto por categoria para no duplicar (`excludedFromStats` del padre o exclusion logica en el service de stats; se documenta la eleccion en el service). Decision MVP: el padre queda `excludedFromStats = true` cuando tiene hijas, y las hijas cuentan.
- MVP: soporte de datos y reparto simple en formulario. UI avanzada de splits: fase 2.

### 6.3 Reembolsos
- Un movimiento con `refundOfId = gasto.id` representa la devolucion parcial o total de un gasto anterior.
- Regla canonica (unica, compartida con `FINANCIAL_ALGORITHMS.md` seccion 3): el reembolso NO cuenta como ingreso; reduce el gasto neto de la **categoria del gasto original** (el referenciado por `refundOfId`), aunque el gasto original sea de otro mes. La categoria de imputacion es siempre la del gasto original, no la del propio reembolso.
- Periodo de imputacion: lo fija `statsService` (fuente de verdad de la semantica vigente), que soporta reembolsos entre periodos; un fixture de `FINANCIAL_ALGORITHMS.md` congela la regla exacta y `finance-auditor` la valida. Ambos documentos deben describirla igual.
- MVP: enlace simple `refundOfId`. Logica avanzada (matching automatico, reembolsos multiples encadenados): fase 2. El campo se define ahora.

### 6.4 Exclusion de estadisticas
- `excludedFromStats = true` saca al movimiento de todos los calculos de gasto/ingreso/ahorro/forecast, pero sigue visible en la lista de movimientos y afecta al saldo de cuenta.
- Se aplican por defecto a: transferencias (ambas patas) y padres de split. El usuario puede marcar cualquier movimiento como excluido manualmente.
- `statsFlag` es el espejo indexable; el service de stats consulta `[profileId+statsFlag]=0` para el conjunto que si cuenta.

---

## 7. Versionado y migraciones

- El esquema arranca en `db.version(1)` (seccion 3).
- Cada cambio de esquema incrementa la version y, si transforma datos, incluye `.upgrade()`:
  ```ts
  db.version(2).stores({
    transactions: 'id, profileId, /* ...indices nuevos... */',
  }).upgrade(async (tx) => {
    await tx.table('transactions').toCollection().modify((t) => {
      // rellenar/transformar campos nuevos con valores por defecto
    });
  });
  ```
- Reglas de migracion:
  - Anadir un campo opcional con valor por defecto no requiere `upgrade` si se rellena de forma perezosa; aun asi se prefiere `upgrade` explicito para consistencia.
  - Nunca renombrar destructivamente sin migracion que preserve datos.
  - Los backups (export/import JSON) incluyen el numero de version del esquema; al restaurar en una version mayor, se aplican migraciones; al restaurar en una version menor, se avisa y se bloquea (no se degrada el dato).
- Preparacion cifrado fase 2: la version que active cifrado no cambia los campos de negocio; envuelve valores en los repositorios. El esquema ya contempla `Setting.encryptionEnabled`.

---

## 8. Resumen de relaciones

- `Profile 1..* Setting` (1:1 efectivo), `Account`, `Category`, `Tag`, `Transaction`, `Rule`, `Budget`, `ImportTemplate`, `ImportBatch`.
- `Transaction.accountId -> Account`.
- `Transaction.categoryId / subcategoryId -> Category`.
- `Transaction.tagIds -> Tag[]`.
- `Transaction.ruleId -> Rule`.
- `Transaction.importBatchId -> ImportBatch`.
- `Transaction.transferGroupId` agrupa 2 `Transaction`.
- `Transaction.parentId -> Transaction` (split).
- `Transaction.refundOfId -> Transaction` (reembolso).
- `Budget.scopeId -> Category | Account` segun `scope`.
- `ImportBatch.templateId -> ImportTemplate`.

Todas las relaciones estan confinadas dentro del mismo `profileId`. Nunca hay referencias cruzadas entre perfiles.

---

# MODELO OBJETIVO DE LA AMPLIACION (secciones 9 en adelante)

Todo lo siguiente es aditivo. Se implementa por fases (ver `IMPLEMENTATION_ROADMAP.md`). Importes en centimos enteros; tipos e intereses en micro-fraccion 1e-6. Cada entidad nueva sincronizable lleva los campos de la seccion 9. El aislamiento pasa a ser por `ownerUserId` + `profileId` en todas las capas (local, remota y RLS).

## 9. Campos de sincronizacion (mixin en entidades sincronizables)

Se anaden a: `Profile`, `Account`, `Category`, `Tag`, `Transaction`, `Rule`, `Budget`, `ImportTemplate`, `ImportBatch`, y a todas las entidades nuevas de la ampliacion (`Merchant`, `MerchantAlias`, `ReviewItem`, `Reconciliation`, `RecurringSeries`, `RecurringOccurrence`, `Debt`, `DebtPayment`, `DebtScenario`, `ExtraPayment`). `Setting` tambien los lleva (se sincroniza con politica last-write-wins, no es dato financiero critico).

| Campo | Tipo | Notas |
|-------|------|-------|
| `updatedAt` | `number` | epoch ms. Ya existe en las entidades actuales; pasa a ser tambien senal de cambio para sync |
| `deletedAt` | `number \| null` | Borrado logico. `null` = viva. Con sync, nunca se borra fisicamente una entidad sincronizable mientras haya dispositivos que puedan reintroducirla |
| `revision` | `number` | Contador de version de la fila. Autoritativo en el servidor (lo incrementa un trigger en cada UPDATE). En local refleja la ultima revision confirmada |
| `syncStatus` | `'local' \| 'pending' \| 'synced' \| 'conflict'` | Estado local de la fila respecto al remoto. `local` = solo local (sin cuenta o sin subir aun); `pending` = con mutacion en cola; `synced` = confirmada; `conflict` = divergencia sin resolver |
| `lastSyncedAt` | `number \| null` | epoch ms de la ultima confirmacion remota, o `null` |

Reglas:
- Las lecturas de la app IGNORAN por defecto las filas con `deletedAt != null` (se filtran en repositorio). El borrado logico existe para propagar la baja, no para mostrarla.
- `revision` NUNCA lo fija el cliente de forma autoritativa: el cliente envia `baseRevision` (la revision sobre la que edito) y el servidor decide. Ver seccion 11 y 12.
- En modo local sin cuenta, `syncStatus = 'local'`, `revision = 0`, `lastSyncedAt = null`. Al activar cuenta, la migracion (seccion 13) los promueve.

## 10. Usuario autenticado y propiedad

### 10.1 AuthUser (gestionado por Supabase Auth, no por la app)

La identidad vive en `auth.users` de Supabase. La app NO crea ni gestiona esta tabla; solo lee el usuario de la sesion. Campos relevantes que consume la app (solo lectura): `id` (UUID), `email`, estado de verificacion de email.

Distincion clave (invariante de producto):
- **Cuenta autenticada** (`auth.users`): identifica a la PERSONA. Una por email.
- **Perfil financiero** (`Profile`): organiza DATOS dentro de la app. Una cuenta puede poseer varios perfiles (yo, pareja, hogar).
- Relacion: `Profile.ownerUserId -> auth.users.id`. Un perfil pertenece como mucho a una cuenta. No hay perfiles compartidos entre cuentas (fuera de alcance).

### 10.2 Preferencias de dispositivo y seguridad local (no sincronizables, no financieras)

Se guardan solo en local (IndexedDB o storage cifrado del dispositivo), NUNCA en Supabase, NUNCA en backups:

| Entidad/clave | Contenido | Notas |
|---------------|-----------|-------|
| `DeviceSecurity` | `pinEnabled`, `pinKdfParams` (algoritmo, iteraciones, version), `pinSalt`, `pinVerifier` (verificador derivado, no el PIN), `autoLockMs`, `passkeysEnabled` | Nunca el PIN en claro. Ver `CLOUD_SYNC_SECURITY.md` |
| `EncryptedSession` | Sesion de Supabase cifrada con AES-GCM (clave derivada del PIN, solo en memoria al desbloquear) | Sin copia sin cifrar en otro storage |
| `WebAuthnCredentialRef` | Referencia local (credentialId, nombre de dispositivo, createdAt) a passkeys registradas | La credencial vive en el autenticador del SO, no en la app |

## 11. Cola de salida local (Outbox)

Tabla local (Dexie) que persiste cada mutacion pendiente de enviar. Garantiza escritura local primero, funcionamiento offline e idempotencia.

| Campo | Tipo | Notas |
|-------|------|-------|
| `mutationId` | `string` (PK) | UUID unico. Clave de idempotencia: el servidor descarta un `mutationId` ya aplicado |
| `userId` | `string` | Propietario. La cola nunca mezcla usuarios |
| `profileId` | `string` | Perfil afectado |
| `entityType` | `string` | Tabla objetivo (`transaction`, `account`, ...) |
| `entityId` | `string` | Id de la fila afectada (UUID, el mismo local y remoto) |
| `operation` | `'insert' \| 'update' \| 'delete'` | `delete` es borrado logico (set `deletedAt`) |
| `payload` | `object` | Datos de la mutacion (solo campos cambiados en update). Nunca incluye PIN, tokens ni secretos |
| `baseRevision` | `number` | Revision remota conocida al crear la mutacion. Base para deteccion de conflicto |
| `createdAt` | `number` | epoch ms |
| `attempts` | `number` | Reintentos realizados |
| `lastAttemptAt` | `number \| null` | epoch ms del ultimo intento |
| `lastError` | `string \| null` | Ultimo error (mensaje corto, sin datos financieros completos) |
| `status` | `'queued' \| 'inflight' \| 'failed' \| 'done' \| 'conflict'` | Estado de la mutacion en la cola |

Reglas:
- Idempotencia: aplicar dos veces el mismo `mutationId` no duplica. El upsert remoto usa el `entityId` (UUID reutilizado de local) como clave primaria.
- Una importacion grande genera muchas mutaciones agrupadas por `importBatchId`; se procesan por lotes.
- La cola respeta dependencias (una cuenta antes que sus movimientos) mediante orden por `entityType` y `createdAt`.

## 12. Conflictos

Cuando el servidor rechaza una mutacion porque `baseRevision` ya no es la actual (otro dispositivo cambio la fila), se materializa un conflicto.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `userId` / `profileId` | `string` | Propietario y perfil |
| `entityType` / `entityId` | `string` | Fila en conflicto |
| `localPayload` | `object` | Version local (la que intentaba subir) |
| `remotePayload` | `object` | Version remota vigente |
| `baseRevision` | `number` | Revision comun de partida |
| `remoteRevision` | `number` | Revision remota que provoco el choque |
| `status` | `'open' \| 'resolved'` | |
| `resolution` | `'keepLocal' \| 'keepRemote' \| 'merged' \| null` | Como se resolvio |
| `resolvedAt` | `number \| null` | epoch ms |
| campos de sync | | (seccion 9) |

Reglas (invariante 11 de CLAUDE.md):
- Ningun conflicto financiero se resuelve en silencio. Para movimientos, splits, transferencias, reembolsos, deudas y pagos, la resolucion la decide la persona.
- Nunca se hace merge automatico campo a campo de importes. `merged` solo se permite en campos seguros no monetarios (p. ej. notas, etiquetas) y se registra.
- Entidades no financieras (`Setting`) pueden resolverse con last-write-wins documentado, sin crear conflicto visible.
- La resolucion genera una nueva mutacion idempotente sobre `remoteRevision`.

## 13. Migraciones de datos (registro)

### 13.1 Migraciones de esquema local (Dexie)

Ver seccion 7. La ampliacion introduce nuevas versiones `db.version(2..n).stores(...).upgrade(...)` que anaden tablas nuevas y rellenan los campos de sync con valores por defecto (`syncStatus='local'`, `revision=0`, `deletedAt=null`) y `Profile.ownerUserId=null`. Nunca destructivas.

### 13.2 Migracion de perfiles locales a la cuenta (proceso de datos)

Tabla local que registra el estado de la migracion inicial de un perfil local a Supabase (idempotente y reanudable):

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | Perfil que se migra |
| `userId` | `string` | Cuenta destino |
| `status` | `'pending' \| 'inProgress' \| 'verified' \| 'failed'` | Solo `verified` marca el perfil como migrado |
| `counts` | `object` | Recuentos esperados por entidad (accounts, transactions, ...) para validar tras subir |
| `uploadedCounts` | `object` | Recuentos confirmados en remoto |
| `startedAt` / `finishedAt` | `number \| null` | epoch ms |
| `lastError` | `string \| null` | |

Reglas: conserva los UUID locales (no remapea), asigna `ownerUserId`, sube por lotes respetando dependencias, valida recuentos y relaciones, no borra datos locales y solo marca `verified` tras la validacion. Puede reanudarse sin duplicar (upsert por UUID).

## 14. Comercios normalizados (ampliacion, fase 4)

Reconocer que conceptos bancarios distintos ("AMZN Mktp ES", "AMAZON EU", "Amazon.es*1234") son el mismo comercio, sin perder el texto original.

### 14.1 Merchant

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `canonicalName` | `string` | Nombre visible ("Amazon") |
| `normalizedName` | `string` | Normalizado para busqueda/comparacion |
| `defaultCategoryId` | `string \| null` | Categoria sugerida por defecto |
| `defaultSubcategoryId` | `string \| null` | Subcategoria sugerida |
| `defaultTagIds` | `string[]` | Etiquetas sugeridas |
| `notes` | `string \| null` | |
| `archivedAt` | `number \| null` | Archivado sin borrar |
| campos de sync | | (seccion 9) |
| `createdAt` / `updatedAt` | `number` | epoch ms |

### 14.2 MerchantAlias

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `merchantId` | `string` | FK a Merchant |
| `profileId` | `string` | FK a Profile (redundante para RLS/indices) |
| `rawAlias` | `string` | Texto tal cual aparece en el banco |
| `normalizedAlias` | `string` | Normalizado (funcion pura versionada) |
| `matchType` | `'exact' \| 'contains' \| 'startsWith' \| 'regex'` | Modo de coincidencia |
| `priority` | `number` | Menor = mayor prioridad |
| `enabled` | `boolean` | Activo o no |
| campos de sync | | (seccion 9) |

### 14.3 Campos nuevos en Transaction (comercio)

Aditivos sobre la `Transaction` de la seccion 2.6. `rawConcept` es inmutable respecto a la importacion (invariante 12 de CLAUDE.md): el `concept` editable actual se conserva, y `rawConcept` guarda el original importado.

| Campo | Tipo | Notas |
|-------|------|-------|
| `rawConcept` | `string` | Concepto original del banco. Inmutable tras importar. Para altas manuales, igual a `concept` |
| `normalizedConcept` | `string` | Concepto normalizado (misma funcion pura que los alias) |
| `normalizationVersion` | `number` | Version del algoritmo de normalizacion aplicado |
| `merchantId` | `string \| null` | Comercio asociado, o `null` |
| `merchantMatchSource` | `'manual' \| 'alias' \| 'rule' \| 'import' \| 'suggested' \| 'none'` | Como se asocio |
| `merchantMatchConfidence` | `number` | Confianza orientativa 0..1000 (por mil entero), no probabilidad real |

Orden de asociacion (determinista): 1) manual; 2) identificador de comercio del banco (si viene); 3) alias exacto; 4) alias configurable (contains/startsWith/regex por prioridad); 5) regla; 6) sugerencia por similitud; 7) sin comercio. Las sugerencias de confianza baja NO se convierten en asociacion definitiva.

## 15. Metadatos bancarios, huellas y duplicados avanzados (ampliacion, fase 5)

### 15.1 Campos nuevos en Transaction (importacion y duplicados)

| Campo | Tipo | Notas |
|-------|------|-------|
| `bankTransactionId` | `string \| null` | Identificador de operacion del banco, si el fichero lo trae. Fiable para dedupe cuando existe |
| `bookingDate` | `string \| null` | Fecha contable (`YYYY-MM-DD`), si distinta de `date` |
| `valueDate` | `string \| null` | Fecha valor (`YYYY-MM-DD`) |
| `pending` | `boolean` | Operacion pendiente vs confirmada |
| `currency` | `string` | Moneda de la operacion (por defecto la del perfil) |
| `balanceAfterCents` | `number \| null` | Saldo posterior en centimos, si el fichero lo trae |
| `bankReference` | `string \| null` | Referencia bancaria libre |
| `operationType` | `string \| null` | Tipo de operacion del banco |
| `sourceRowHash` | `string` | Hash exacto de la fila de origen |
| `exactFingerprint` | `string` | Huella exacta (identidad estricta) |
| `normalizedFingerprint` | `string` | Huella normalizada (identidad tolerante) |
| `fingerprintVersion` | `number` | Version del algoritmo de huellas |
| `sourceFileHash` | `string \| null` | Hash del fichero de origen (detecta reimportacion aunque cambie el nombre) |
| `sourceFileSize` | `number \| null` | Tamano del fichero de origen |
| `duplicateStatus` | `'unique' \| 'exact' \| 'strongNormalized' \| 'possible' \| 'weak' \| 'pendingReplaced'` | Nivel resuelto |
| `duplicateConfidence` | `number` | Confianza orientativa por mil (0..1000). No es probabilidad real |
| `duplicateReasonCodes` | `string[]` | Motivos legibles ("mismo bankTransactionId", "importe+fecha+comercio", ...) |
| `duplicateCandidateIds` | `string[]` | Ids de candidatos considerados |
| `pendingReplacementId` | `string \| null` | Si un confirmado sustituye a un pendiente, apunta al pendiente |

El `dedupeHash` FNV-1a actual (seccion 5) se mantiene como huella rapida de primer nivel; las huellas versionadas de esta seccion lo complementan. NUNCA se pone restriccion `UNIQUE` sobre la huella normalizada general (dos compras reales identicas son legitimas); solo se admite unicidad sobre identificadores fiables (`bankTransactionId` por cuenta, cuando existe).

### 15.2 NoDuplicateDecision

Recuerda que una pareja concreta NO es duplicado, para no volver a preguntar salvo cambio relevante.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `leftFingerprint` / `rightFingerprint` | `string` | Huellas de la pareja marcada como distinta |
| `leftTxId` / `rightTxId` | `string \| null` | Ids si aplica |
| `reason` | `string \| null` | Nota del usuario |
| campos de sync | | (seccion 9) |

## 16. Bandeja de revision: ReviewItem (ampliacion, fase 6)

Tarea de revision unificada generada por importacion, reglas, sincronizacion, duplicados, transferencias/reembolsos candidatos, comercios nuevos, errores de importacion y anomalias recurrentes.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `type` | enum | `uncategorized \| lowConfidenceRule \| possibleDuplicate \| transferCandidate \| refundCandidate \| stalePending \| newMerchant \| importError \| syncConflict \| recurringAnomaly` |
| `entityType` | `string` | Tabla de la entidad referida |
| `entityId` | `string` | Id de la entidad referida (NO se copia la entidad entera) |
| `confidence` | `number` | Confianza por mil (0..1000) cuando aplique |
| `reasonCodes` | `string[]` | Motivos legibles |
| `metadata` | `object` | Minima; referencias, no copia de datos financieros |
| `status` | `'open' \| 'snoozed' \| 'resolved' \| 'dismissed'` | |
| `resolution` | `string \| null` | Accion aplicada |
| `createdAt` / `resolvedAt` | `number \| null` | epoch ms |
| campos de sync | | (seccion 9) |

La generacion es idempotente: no se crean dos tareas para el mismo `(type, entityId)` abierto.

## 17. Conciliacion: Reconciliation (ampliacion, fase 6)

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `accountId` | `string` | Cuenta conciliada |
| `statementDate` | `string` | `YYYY-MM-DD` del extracto |
| `statementBalanceCents` | `number` | Saldo final del extracto (centimos) |
| `computedBalanceCents` | `number` | Saldo calculado por la app en esa fecha |
| `differenceCents` | `number` | `statementBalance - computedBalance` (0 = cuadra) |
| `status` | `'balanced' \| 'discrepancy' \| 'acceptedWithDifference'` | |
| `notes` | `string \| null` | |
| `createdAt` / `updatedAt` | `number` | epoch ms |
| campos de sync | | (seccion 9) |

## 18. Recurrencias (ampliacion, fase 7)

### 18.1 RecurringSeries

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `merchantId` | `string \| null` | Comercio asociado |
| `name` | `string` | Nombre visible |
| `direction` | `'expense' \| 'income'` | Cobro o ingreso |
| `frequency` | `'weekly' \| 'monthly' \| 'quarterly' \| 'yearly'` | |
| `interval` | `number` | Cada N periodos (p. ej. cada 2 meses) |
| `expectedAmountCents` | `number` | Importe esperado (centimos, mediana) |
| `amountToleranceCents` | `number` | Tolerancia absoluta |
| `amountTolerancePpm` | `number` | Tolerancia relativa en micro-fraccion 1e-6 |
| `expectedDayOfWeek` | `number \| null` | 0..6 si aplica |
| `expectedDayOfMonth` | `number \| null` | 1..31 si aplica |
| `dateToleranceDays` | `number` | Margen de dias |
| `nextExpectedDate` | `string \| null` | `YYYY-MM-DD` |
| `status` | `'candidate' \| 'active' \| 'paused' \| 'possiblyCancelled' \| 'cancelled'` | |
| `confidence` | `number` | Por mil (0..1000) |
| `detectionVersion` | `number` | Version del algoritmo de deteccion |
| campos de sync + `createdAt`/`updatedAt` | | |

### 18.2 RecurringOccurrence

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile (para RLS/indices) |
| `seriesId` | `string` | FK a RecurringSeries |
| `transactionId` | `string \| null` | Movimiento que la materializa, si existe |
| `expectedDate` | `string` | `YYYY-MM-DD` |
| `expectedAmountCents` | `number` | |
| `status` | `'expected' \| 'matched' \| 'missing' \| 'skipped' \| 'manuallyCompleted'` | |
| campos de sync | | |

## 19. Deudas (ampliacion, fase 8)

Importes en centimos; tipos de interes en micro-fraccion 1e-6. Los escenarios NO modifican datos reales; son simulaciones guardadas.

### 19.1 Debt

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `name` | `string` | Nombre visible |
| `type` | `'personalLoan' \| 'mortgageFixed' \| 'card' \| 'other'` | Cuota fija en esta fase. `card` (revolving, pago minimo variable): se registra la deuda y sus pagos, pero SIN calendario de amortizacion ni inclusion en Snowball/Avalanche hasta especificar su regla de pago minimo (ver `FINANCIAL_ALGORITHMS.md` 8.1). Arquitectura lista para tipo variable, sin simular indices futuros |
| `currency` | `string` | |
| `originalPrincipalCents` | `number` | Principal inicial |
| `outstandingPrincipalCents` | `number` | Principal pendiente |
| `annualRatePpm` | `number` | Tipo anual en micro-fraccion 1e-6 (3,25% -> 32500) |
| `minimumPaymentCents` | `number` | Cuota/pago minimo |
| `paymentFrequency` | `'monthly'` | Mensual en esta fase |
| `nextPaymentDate` | `string \| null` | `YYYY-MM-DD` |
| `remainingTermMonths` | `number \| null` | Plazo restante |
| `linkedAccountId` | `string \| null` | Cuenta desde la que se paga |
| `linkedCategoryId` | `string \| null` | Categoria de los pagos |
| `status` | `'active' \| 'paidOff' \| 'archived'` | |
| campos de sync + `createdAt`/`updatedAt` | | |

### 19.2 DebtPayment

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `debtId` | `string` | FK a Debt |
| `profileId` | `string` | FK a Profile (RLS/indices) |
| `date` | `string` | `YYYY-MM-DD` |
| `totalCents` | `number` | Pago total |
| `principalCents` | `number` | Parte a principal |
| `interestCents` | `number` | Parte a intereses |
| `feesCents` | `number` | Comisiones |
| `extraPrincipalCents` | `number` | Amortizacion extraordinaria incluida |
| `transactionId` | `string \| null` | Movimiento vinculado (evita doble conteo) |
| campos de sync | | |

Convencion de signo: en el libro de la deuda, `totalCents`, `principalCents`, `interestCents`, `feesCents` y `extraPrincipalCents` son **magnitudes positivas** (importes pagados). La `Transaction` vinculada por `transactionId` sigue su propia convencion (gasto negativo). Al vincular pago con movimiento, la parte de PRINCIPAL reduce el pasivo y NO se contabiliza como gasto de consumo en estadisticas; solo intereses y comisiones son gasto real. Esto evita el doble conteo y la reduccion de pasivo tratada como consumo.

Invariante: `totalCents = principalCents + interestCents + feesCents`, con `extraPrincipalCents` incluido dentro de `principalCents` (la amortizacion extraordinaria es principal). Todos en centimos enteros positivos.

### 19.3 DebtScenario y ExtraPayment

`DebtScenario`:

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` (PK) | UUID |
| `profileId` | `string` | FK a Profile |
| `name` | `string` | |
| `strategy` | `'baseline' \| 'snowball' \| 'avalanche' \| 'custom'` | |
| `recurringExtraCents` | `number` | Extra mensual aplicado a la estrategia |
| `oneTimeExtraPayments` | `ExtraPayment[]` | Amortizaciones puntuales (embebido o tabla) |
| `createdAt` | `number` | epoch ms |
| `calculationVersion` | `number` | Version del algoritmo de calculo |
| `sourceRevision` | `number` | Agregado de las `revision` de TODAS las deudas incluidas al calcular (regla documentada: suma de revisiones). Si el agregado actual difiere del guardado, alguna deuda cambio y el escenario se marca desactualizado |
| campos de sync | | |

`ExtraPayment` (amortizacion extraordinaria; embebida en escenario o como tabla con `scenarioId`/`debtId`):

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` | UUID |
| `debtId` | `string` | Deuda objetivo |
| `date` | `string` | `YYYY-MM-DD` |
| `amountCents` | `number` | Importe extra |
| `mode` | `'reduceTerm' \| 'reducePayment'` | Reducir plazo o reducir cuota |

## 20. Versionado de algoritmos

Para que los resultados sean reproducibles y auditables, se versionan los algoritmos que producen datos derivados. Cada version es un entero documentado en `FINANCIAL_ALGORITHMS.md`:

- `normalizationVersion` (normalizacion de conceptos/alias).
- `fingerprintVersion` (huellas de duplicados).
- `detectionVersion` (deteccion de recurrencias).
- `calculationVersion` (calendarios de deuda y estrategias).

Regla: cambiar un algoritmo incrementa su version; los datos existentes conservan la version con la que se generaron y se recalculan de forma explicita (nunca en silencio).

## 21. Indices (ampliacion)

### 21.1 Locales (Dexie, nuevas versiones)

Todo indice sigue empezando por `profileId`. Ademas se anaden indices por los campos de trabajo nuevos. Ejemplos representativos (no exhaustivo):

```ts
// nuevas versiones db.version(2..n).stores({ ... })
outbox:            'mutationId, [userId+status], [profileId+entityType], createdAt',
conflicts:         'id, profileId, [profileId+status], entityId',
merchants:         'id, profileId, [profileId+normalizedName], [profileId+archivedAt]',
merchantAliases:   'id, profileId, merchantId, [profileId+normalizedAlias], [profileId+enabled]',
reviewItems:       'id, profileId, [profileId+status], [profileId+type], entityId',
reconciliations:   'id, profileId, [profileId+accountId], [profileId+statementDate]',
recurringSeries:   'id, profileId, [profileId+status], merchantId',
recurringOccurrences: 'id, profileId, seriesId, [profileId+status], [profileId+expectedDate]',
debts:             'id, profileId, [profileId+status]',
debtPayments:      'id, profileId, debtId, [profileId+date]',
debtScenarios:     'id, profileId, [profileId+strategy]',
// Transaction gana indices: [profileId+merchantId], [profileId+bankTransactionId],
//                           [profileId+duplicateStatus], [profileId+exactFingerprint]
```

### 21.2 Remotos (Supabase/Postgres)

Cada tabla remota tiene indice por `(owner_user_id, profile_id)` y por las columnas de trabajo equivalentes. Unicidad remota solo sobre identificadores fiables: PK por `id` (UUID), y `UNIQUE (profile_id, account_id, bank_transaction_id)` cuando `bank_transaction_id` no es null. La unicidad es **por cuenta** (incluye `account_id`): dos cuentas de bancos distintos pueden reutilizar el mismo identificador de operacion como cadena y ambos movimientos son legitimos; un `UNIQUE (profile_id, bank_transaction_id)` sin `account_id` rechazaria uno de ellos (falso positivo que descarta un movimiento real). Nunca `UNIQUE` sobre huella normalizada general.

## 22. Esquema remoto y RLS (resumen; detalle en CLOUD_SYNC_SECURITY.md)

- Toda tabla financiera remota lleva `owner_user_id UUID NOT NULL` (o via join a `profiles`), `profile_id UUID`, `id UUID PK`, campos de negocio, `created_at`, `updated_at`, `deleted_at`, `revision BIGINT` (trigger incrementa en UPDATE).
- Centimos como `BIGINT`. Tipos de interes como `BIGINT` (micro-fraccion 1e-6). Estados y tipos con `CHECK`.
- Claves foraneas dentro del mismo `profile_id`. Borrados en cascada solo donde son seguros (hijos de un perfil); en entidades sincronizables se prefiere borrado logico.
- RLS activo en TODAS. Politicas por operacion: un usuario solo lee/escribe filas cuyo `owner_user_id = auth.uid()`; una entidad hija es accesible solo si su perfil pertenece al usuario; no se puede insertar para otro propietario ni cambiar el propietario; un anonimo no lee nada. Funciones/RPC/vistas respetan la misma autorizacion.
- **Tablas hijas sin `owner_user_id` propio**: la autorizacion se comprueba por join al perfil. El `WITH CHECK` de INSERT/UPDATE (no solo el SELECT) debe exigir `profile_id IN (SELECT id FROM profiles WHERE owner_user_id = auth.uid())`, para impedir insertar filas hijas con un `profile_id` ajeno. Ver `CLOUD_SYNC_SECURITY.md` seccion 4.

## 23. Aislamiento por usuario y profileId (reforzado)

El invariante 4 de CLAUDE.md se amplia a doble clave y a todas las capas:

1. **Indices locales**: `profileId` primer campo (ya vigente).
2. **Repositorios locales**: exigen `profileId`; con cuenta, tambien validan `ownerUserId`.
3. **Cola de salida**: nunca mezcla `userId` ni `profileId`; una mutacion no puede referir un perfil ajeno.
4. **Repositorios remotos**: envian siempre `owner_user_id` y `profile_id`; nunca confian en el payload de UI.
5. **RLS (servidor)**: ultima linea de defensa. Aunque el cliente se equivoque, Postgres rechaza cualquier acceso cruzado.
6. **Backups**: siguen siendo por perfil; nunca cruzan perfiles ni incluyen datos de otro usuario.

Ninguna capa confia solo en la de arriba. La UI nunca es la unica barrera.

# DATA_MODEL: modelo de datos (Dexie / IndexedDB)

Fuente de verdad de entidades y campos. Todo el codigo de `src/db/` y `src/services/` debe respetar este documento. Si una implementacion contradice este modelo, hay que avisar al usuario antes de continuar.

Relacionado: ver `ARCHITECTURE.md` (capa de acceso a datos y aislamiento por perfil) y `PRD.md` (alcance funcional).

---

## 1. Convenciones generales

- **Dinero**: siempre entero en centimos (`amountCents: number`, entero). Nunca floats para importes. 12,34 euros se guarda como `1234`. Formateo a euros solo en la capa de presentacion.
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
- Borrar un perfil implica borrar en cascada todas sus entidades hijas (transaccion Dexie que barre por `profileId`). Accion destructiva: requiere confirmacion (ver `ARCHITECTURE.md`).
- La preferencia de "perfil activo" NO vive aqui; vive en `localStorage` (clave no sensible, solo un id) para saber que perfil abrir al arrancar. Ver `ARCHITECTURE.md`.

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
- Un movimiento de tipo `income` (o ajuste) con `refundOfId = gasto.id` representa la devolucion parcial o total de un gasto anterior.
- En estadisticas MVP: el reembolso se trata como ingreso que reduce el gasto neto de su categoria (el service de stats resta el reembolso al gasto de esa categoria/periodo). Se documenta la regla exacta en el service financiero y la valida `finance-auditor`.
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

# FINANCIAL_ALGORITHMS: invariantes y algoritmos financieros

Fuente de verdad de la semantica de calculo. Todo servicio de `src/services/` que toque dinero debe respetar este documento. Lo audita `finance-auditor` y `/audit-financiero`.

Relacionado: `DATA_MODEL.md` (entidades y campos), `ARCHITECTURE.md` (donde vive el calculo), `CLOUD_SYNC_SECURITY.md` (integridad en sync). Ante contradiccion con `CLAUDE.md`, mandan los invariantes.

Estructura: secciones 1 a 4 describen lo VIGENTE (implementado hoy). Secciones 5 en adelante definen los algoritmos OBJETIVO de la ampliacion. Toda funcion de calculo nucleo es **pura, determinista y versionada**.

---

## 1. Invariantes monetarios

- **Importes**: siempre entero en centimos. Nunca floats. `assertCents` (`src/lib/money.ts`) exige `Number.isInteger`. `eurosToCents(e) = Math.round(e * 100)`; `centsToEuros` solo para presentacion.
- **Signo**: gasto negativo, ingreso positivo. `type` es la fuente de verdad y se valida contra el signo al escribir (`expense` no positivo, `income` no negativo).
- **Tipos de interes y porcentajes** (ampliacion): entero en **micro-fraccion 1e-6** (fraccion anual x 1.000.000; 3,25% = 0,0325 -> `32500`; 5% -> `50000`). Las tolerancias relativas usan la misma escala (`amountTolerancePpm`).
- **Cuidado con las dos escalas de porcentaje** (foco de bug por factor 1000): la tasa de ahorro vigente esta en **tanto por mil entero** (`savingsRatePerMille`, escala 1e-3), mientras que los tipos de interes y tolerancias de la ampliacion estan en **ppm** (escala 1e-6). No mezclar. Conversion: `ppm = perMille * 1000`. Las confianzas heuristicas (duplicados, comercios, recurrencias, review) van en **por mil (0..1000)** y son escala aparte, no monetaria.
- **Prohibido acumular dinero en floats**. Toda suma/reparto se hace en enteros de centimos. Las operaciones con tipos convierten a un entero intermedio de mayor escala y se redondean al final (ver seccion 2).
- **Aislamiento**: todo calculo filtra por `profileId` (y `ownerUserId` con cuenta). No existe calculo cruzado entre perfiles.

## 2. Redondeos (regla unica documentada)

- **Regla general**: redondeo **half-up** (mitad hacia arriba en valor absoluto) al centimo mas cercano, aplicado **una sola vez** al final de cada magnitud monetaria derivada. Se documenta explicitamente porque afecta a intereses y repartos.
- **Reparto que debe cuadrar** (splits, distribucion de una cuota entre principal/interes, prorrateos): se redondea cada componente y se asigna el **residuo** (diferencia entre el total y la suma de las partes redondeadas) siguiendo UNA regla unica y determinista (sin alternativas): al **ultimo componente en un orden fijo y documentado**. Para splits, la ultima linea del reparto; para la cuota de deuda, el principal absorbe el residuo (el interes se calcula primero, seccion 8.3). Asi la suma de las partes es EXACTAMENTE el total y nunca se pierde ni se crea un centimo.
- **Interes sobre saldo** (deudas): el interes mensual se calcula difiriendo TODA division al final para no perder precision: `interes_mes = round_half_up(saldo_cents * annualRatePpm / (12 * 1_000_000))`. NUNCA se pre-divide la tasa (`annualRatePpm / 12`) como entero, porque truncaria (p. ej. 32500/12 = 2708,33). El calculo intermedio usa BigInt (`saldo_cents * annualRatePpm` puede superar 2^53) y se redondea una sola vez, al final.
- El redondeo es parte del contrato: dos ejecuciones con los mismos datos dan el mismo resultado al centimo (determinismo).

## 3. Semantica de estadisticas vigente (dashboard y presupuestos)

Compartida por `statsService` y `budgetService` (misma `computeConsumption`), auditada:
- **Exclusiones**: `excludedFromStats` saca al movimiento de gasto/ingreso/ahorro/forecast; sigue afectando al saldo de cuenta.
- **Transferencias**: ambas patas excluidas (mover dinero propio no es gasto ni ingreso).
- **Splits**: cuentan las lineas hijas (con su categoria); el padre se excluye para no duplicar.
- **Reembolsos**: un `refundOfId` NO es ingreso; reduce el gasto neto de la categoria del gasto original, incluso si es de otro mes.
- **Ahorro e inversion (vigente, deuda tecnica)**: se detectan por NOMBRE de categoria (`Ahorro/Ahorros`, `Inversion/Inversiones`, con/sin acentos; subcategorias heredan). Un movimiento a esas categorias no es consumo: cuenta como aportacion aparte. Riesgo conocido: la deteccion por nombre es fragil; la ampliacion preve migrar a un marcado explicito (ver `IMPLEMENTATION_ROADMAP.md`). Mientras tanto, este documento fija la semantica actual como referencia de auditoria.
- **Comparativa vs promedio**: media de meses previos con actividad, con prorrateo (regla de 3) para el mes en curso a dias comparables.
- **Forecast vigente**: extrapolacion lineal del ritmo del mes en curso, etiquetada como estimacion. Se sustituye por el forecast compuesto de la seccion 7.

## 4. Duplicados vigentes (dedupeHash)

`dedupeHash` = FNV-1a 32 bits (8 hex) sobre `profileId + accountId + date + amountCents + normalizeConcept(concept)` (`src/lib/dedupe.ts`). Es AVISO, no bloqueo: dos compras reales identicas son legitimas. Se mantiene como primer nivel; la seccion 5 lo amplia.

---

# ALGORITMOS OBJETIVO DE LA AMPLIACION (secciones 5 en adelante)

Todo pura, determinista, versionada. Sin floats para dinero.

## 5. Duplicados con niveles de confianza (fase 5)

Huellas versionadas (`fingerprintVersion`), calculadas en local (sin subir el fichero):
- `sourceFileHash`: identifica reimportacion aunque cambie el nombre del fichero.
- `sourceRowHash`: fila de origen exacta.
- `exactFingerprint`: `accountId + date + amountCents + currency + normalizedConcept` (identidad estricta).
- `normalizedFingerprint`: version tolerante (ventana de fecha, comercio normalizado).

**Generacion de candidatos** acotada por `profileId`, cuenta, moneda, importe y ventana temporal (y comercio cuando exista). No se compara todo contra todo.

**Niveles** (`duplicateStatus`) con razones (`duplicateReasonCodes`):
1. `exact`: mismo `bankTransactionId` (si existe) o `exactFingerprint` identico -> confianza muy alta.
2. `strongNormalized`: importe + fecha (dentro de tolerancia) + comercio normalizado -> alta.
3. `possible`: importe + fecha proxima, sin comercio -> media.
4. `weak`: solo coincidencias debiles -> baja.
5. `pendingReplaced`: un confirmado compatible sustituye a un pendiente previo.

**Puntuacion**: funcion pura y determinista que devuelve nivel, confianza orientativa por mil (0..1000), razones, diferencias, candidato y acciones. La confianza es heuristica, NO probabilidad real; se comunica como tal.

**Pendiente -> confirmado**: cuando aparece un confirmado compatible con un pendiente, se propone sustituir conservando trazabilidad (`pendingReplacementId`), sin duplicar saldo y sin borrar sin confirmacion.

**Decision de no-duplicado** (`NoDuplicateDecision`): impide que la misma pareja reaparezca como duplicado salvo cambio relevante.

**Restricciones**: unicidad remota solo sobre `bankTransactionId` por cuenta; NUNCA `UNIQUE` sobre huella normalizada general.

## 6. Conciliacion (fase 6)

- `computedBalanceCents(cuenta, statementDate)` = `openingBalanceCents` + suma de `amountCents` de los movimientos **confirmados** de esa cuenta con `date <= statementDate`.
- **Limite inclusivo**: se incluyen los movimientos cuya `date` (string `YYYY-MM-DD`, comparacion lexicografica, sin conversion a UTC) es menor o igual a `statementDate`.
- **Semantica de saldo (no de estadisticas)**: el saldo INCLUYE transferencias y movimientos con `excludedFromStats`; el saldo no es lo mismo que las estadisticas. Un fixture debe demostrar esta diferencia (el saldo cuenta la transferencia/excluido, las stats no).
- **Pendientes**: por defecto los movimientos `pending` NO entran en `computedBalanceCents` (un extracto refleja lo ya cargado). Se listan aparte para revision; el usuario puede incluirlos explicitamente. La politica por defecto (excluir pendientes) se documenta para que no genere una `differenceCents` espuria.
- `differenceCents = statementBalanceCents - computedBalanceCents`. `0` = cuadra (`balanced`); signo positivo = el extracto tiene mas saldo que lo calculado.
- Con diferencia: se permite revisar pendientes y excluidos, y `acceptedWithDifference` dejando constancia. Historial por cuenta. Aislado por perfil.

## 7. Recurrencias y forecast (fase 7)

### 7.1 Deteccion de series
- Agrupacion por comercio (o concepto normalizado), direccion y cuenta.
- Importe esperado = **mediana** de las ocurrencias (en centimos enteros; con numero par de ocurrencias, la mediana es la media de los dos centrales redondeada half-up a centimo); dispersion con medida **robusta** (p. ej. MAD), no media/desviacion sensibles a outliers.
- Frecuencia por separacion tipica entre fechas: semanal, mensual, trimestral, anual, con `interval`.
- Tolerancias: `amountToleranceCents` y `amountTolerancePpm`; `dateToleranceDays`.
- No se confirma automaticamente una sugerencia debil; nace como `candidate`.

### 7.2 Anomalias (generan tarea de revision, no accion automatica)
- Subida de precio: diferencia absoluta y porcentual sobre `expectedAmountCents` supera umbral -> proponer nuevo importe base.
- Cobro/ingreso esperado no recibido: se marca `missing` tras superar la ventana. **No** se declara cancelacion por un unico retraso; tras varios, `possiblyCancelled`.
- Cobro duplicado: dos ocurrencias en la misma ventana.

### 7.3 Forecast compuesto por rango
El forecast trabaja con **magnitudes de gasto positivas** (se toma el valor absoluto del gasto; los ingresos no entran en el forecast de gasto). Formula (componentes separados, sin mezclarlos):
```
forecast_central = gasto_realizado
                 + recurrentes_pendientes_del_periodo
                 + gasto_variable_restante_estimado
```
- **`gasto_realizado`**: gasto neto ya ocurrido en el periodo, en magnitud positiva, con la MISMA semantica que las estadisticas (seccion 3). En particular, los reembolsos ya se han restado del gasto de su categoria de origen dentro de `gasto_realizado`; no se suman ni se cuentan aparte.
- **Exclusiones** (no forman parte de ningun componente): transferencias, movimientos con `excludedFromStats`, splits padre, aportaciones a ahorro/inversion (semantica vigente) y las ocurrencias recurrentes YA cobradas del periodo (para no contarlas de nuevo en `recurrentes_pendientes`). Los reembolsos NO se excluyen: se aplican como reduccion del gasto realizado de su categoria (coherente con la seccion 3), nunca se tratan como gasto adicional ni como ingreso.
- **Gasto variable restante**: historico comparable excluyendo recurrentes; pondera meses recientes; reduce outliers; usa dias comparables; si hay poco historico, lo explica en vez de inventar precision.
- **Rango**: inferior / central / superior. La incertidumbre se deriva del historico y de las recurrencias (dispersion real), NO de un porcentaje fijo arbitrario.
- Se muestra el desglose (realizado, recurrente pendiente, variable) y la metodologia.

## 8. Deudas: prestamos y amortizacion (fase 8)

### 8.1 Convencion de tasa y alcance
- `annualRatePpm` en micro-fraccion 1e-6. Convencion: interes nominal mensual = tasa anual / 12. La division por 12 NO se materializa como entero; se difiere al calculo del interes (ver seccion 2) para conservar precision. Se usa BigInt en el intermedio y se redondea una sola vez al centimo.
- Cero interes (`annualRatePpm = 0`): el pago va integro a principal; la cuota es `round_half_up(P / n)` y el ultimo pago absorbe el residuo.
- **Alcance de esta fase**: solo deuda de **cuota fija** (`personalLoan`, `mortgageFixed`, `other` amortizable). El tipo `card` (revolving con pago minimo variable como % del saldo, que cambia cada mes) queda FUERA de alcance del calendario en esta fase: se puede registrar la deuda y sus pagos reales, pero NO se genera calendario de amortizacion ni se incluye en Snowball/Avalanche hasta especificar su regla de pago minimo. Se avisa en la UI.

### 8.2 Calculo de la cuota (cuota fija, tasa > 0)
La cuota constante que amortiza `P` en `n` periodos a tipo mensual `r = annualRatePpm / (12 * 1_000_000)` es la anualidad estandar:
```
cuota_real = P * r / (1 - (1 + r)^(-n))
cuota_cents = round_half_up(cuota_real)   // se redondea a centimo UNA sola vez
```
- El termino `(1 + r)^(-n)` obliga a exponenciacion sobre una fraccion no entera. Se permite un intermedio de coma flotante de doble precision SOLO para este calculo puntual de la cuota (no es acumulacion de dinero: es una formula cerrada que se redondea a entero una vez), o de forma equivalente un metodo de punto fijo/iterativo (biseccion) con tolerancia de 1 centimo. Metodo y precision se documentan y se congelan via fixtures (seccion 11).
- A partir de `cuota_cents`, TODO el calendario (seccion 8.3) usa exclusivamente aritmetica entera de centimos; el intermedio flotante no vuelve a aparecer.
- El "reducir cuota" (8.5) recalcula `cuota_cents` con la misma formula sobre el nuevo saldo/plazo.

### 8.3 Calendario base (cuota fija)
Para cada periodo:
```
interes_i   = round_half_up(saldo_i * annualRatePpm / (12 * 1_000_000))   [saldo y resultado en centimos, intermedio en BigInt]
principal_i = cuota - interes_i - comisiones_i
saldo_{i+1} = saldo_i - principal_i
```
- **Ultimo pago**: se ajusta para dejar `saldo = 0` exactamente (la ultima cuota puede diferir en unos centimos). Nunca queda saldo residual ni negativo por redondeo.
- Salidas: cuota, interes por periodo, principal por periodo, saldo, fecha de fin, intereses totales, numero de pagos, tabla completa.

### 8.4 Deteccion de casos degenerados
- Cuota insuficiente o critica (`cuota <= interes_1`): con `cuota < interes_1` la amortizacion es negativa (el saldo crece); con `cuota == interes_1` el principal del primer periodo es 0 (nunca amortiza). Ambos casos se detectan y avisan ANTES de generar el calendario; no se produce un calendario infinito ni un ultimo pago desorbitado.
- Datos incompatibles / no convergencia / plazo extremo: se detectan y se explican; no se bloquea la UI.

### 8.5 Amortizacion anticipada
- Puntual, mensual o programada (`ExtraPayment`).
- Dos modos: **reducir plazo** (mantener cuota) o **reducir cuota** (mantener plazo), este ultimo solo cuando es matematicamente aplicable.
- Salidas comparadas: nueva fecha de fin, meses ahorrados, intereses ahorrados, cuota nueva, coste total.

## 9. Estrategias multideuda: Snowball y Avalanche (fase 8)

Sobre un conjunto de deudas con sus minimos y un extra disponible (`recurringExtraCents` + puntuales):
- **Snowball**: pagar minimos en todas; el extra va a la deuda de **menor saldo**; al liquidar una, su cuota liberada se acumula al extra (efecto bola de nieve).
- **Avalanche**: igual, pero el extra va a la deuda de **mayor tasa de interes**.
- **Desempate determinista**: ante saldos iguales (Snowball) o tasas iguales (Avalanche), se ordena por un criterio fijo y documentado (p. ej. menor `id`/orden de creacion) para que el resultado sea reproducible.
- **Comparador**: base vs Snowball vs Avalanche vs personalizada. Muestra fecha de liberacion, meses, intereses totales, ahorro frente a base, cual es mas rapida y cual de menor coste. NO se afirma que una sea universalmente mejor.
- **Escenarios** no modifican datos reales; guardan `calculationVersion` y `sourceRevision` (si las deudas cambian, se marca desactualizado).

## 10. Casos limite (checklist para tests y auditoria)

- Importes 0, negativos donde no procede, muy grandes (miles de millones de centimos). Overflow: `saldo_cents * annualRatePpm` puede superar 2^53, por eso el intermedio del interes es BigInt.
- Reparto que no divide exacto (residuo al ultimo componente); split con gasto NEGATIVO y residuo (half-up en valor absoluto).
- Interes 0; tasa muy alta; plazo 1; ultimo pago que liquida el saldo a 0 exacto.
- Cuota insuficiente (`cuota < interes_1`) y cuota critica (`cuota == interes_1`, principal 0).
- Tarjeta `type='card'`: sin calendario en esta fase (fuera de alcance, seccion 8.1); no debe entrar en Snowball/Avalanche.
- Recurrencia: mediana con numero par de ocurrencias (half-up); a principio/fin de mes; meses de 28/29/30/31 dias; cambio de ano.
- Dos series del mismo comercio; evitar doble conteo.
- Forecast con poco historico; con outlier; con recurrente ya cobrado; con reembolso (reduce gasto realizado, no se suma), transferencia y split.
- Duplicados: mismo fichero otro nombre; misma fila; fecha valor distinta; referencia variable; dos compras reales iguales; pendiente-confirmado; identificador bancario.
- Conciliacion que cuadra (differenceCents 0) y con diferencia; con `openingBalanceCents`, transferencias y excluidos (que SI cuentan en el saldo) frente a las stats (que NO), para demostrar la divergencia; con pendientes (excluidos por defecto).
- Idempotencia bajo reintentos y conflictos (nada se altera dos veces), en particular pendiente->confirmado no altera el saldo dos veces.
- DebtScenario sobre varias deudas: `sourceRevision` = suma de las `revision` de las deudas incluidas; si el agregado cambia, el escenario se marca "desactualizado" (coherente con `DATA_MODEL.md` 19.3).

## 11. Fixtures de control

Cada algoritmo financiero se acompana de fixtures verificables (entrada -> salida esperada AL CENTIMO), con los valores congelados desde una implementacion de referencia (no estimados). Los numeros de abajo se calcularon con la convencion exacta de este documento (interes diferido con BigInt, cuota half-up una vez, ultimo pago que liquida el saldo). Un fixture sin su salida numerica no es valido.

Fixtures de deuda (valores esperados fijados):
- **Prestamo fijo**: `P = 1.000.000` cents (10.000 EUR), `annualRatePpm = 50000` (5%), `n = 12`.
  - cuota = `85607` cents (856,07 EUR)
  - interes mes 1 = `4167` cents (`round_half_up(1.000.000 * 50000 / 12.000.000)`)
  - ultimo pago (mes 12) = `85612` cents; principal del ultimo = `85257`
  - intereses totales = `27289` cents (272,89 EUR)
  - saldo final = `0`; suma de principales = `1.000.000` (cuadre exacto)
- **Cero interes**: `P = 120.000` cents, `annualRatePpm = 0`, `n = 12`.
  - cuota = `10000`; intereses totales = `0`; saldo final = `0`.
- **Cuota insuficiente / critica**: `P = 1.000.000`, `50000` ppm, cuota forzada = `4000` (< interes mes 1 = `4167`). Salida esperada: se marca DEGENERADO y NO se genera calendario normal (si se generase, el saldo creceria y el ultimo pago se dispararia; sirve para probar la deteccion de 8.4).

Fixtures pendientes de fijar sus numeros (con la misma implementacion de referencia, antes de implementar la fase):
- Extra puntual y extra mensual (reducir plazo y reducir cuota): meses ahorrados e intereses ahorrados esperados.
- Snowball y Avalanche con 3 deudas, incluyendo caso de tasas iguales y de saldos iguales (para verificar el desempate determinista): fecha de liberacion, orden de pago y intereses totales esperados por estrategia.
- Forecast: mes con recurrentes pendientes + variable, con reembolso, transferencia y split, comprobando exclusiones y que el reembolso reduce el gasto realizado (no se cuenta aparte).
- Duplicados: cada nivel de confianza (exact, strongNormalized, possible, weak, pendingReplaced) con su fixture; caso "mismo fichero otro nombre" y "dos compras reales iguales" (no duplicado).
- Conciliacion: caso que cuadra (differenceCents 0) y caso con transferencia + excluido que demuestra que el saldo los cuenta y las stats no.

Los fixtures viven en los `*.test.ts` de cada servicio y son la referencia de `finance-auditor`.

## 12. Criterios para auditoria financiera

`finance-auditor` / `/audit-financiero` deben verificar:
- Ningun float acumulando dinero; todo en centimos enteros; tipos en 1e-6.
- Redondeo half-up aplicado una vez por magnitud; repartos que cuadran exactamente.
- Exclusiones correctas (transferencias, excluidos, splits padre, recurrentes ya cobrados, ahorro/inversion) en estadisticas y forecast.
- Reembolsos como reduccion de gasto, no como ingreso.
- Duplicados sin falsos positivos que borren dinero ni falsos negativos que dupliquen saldo; pending-confirmed sin doble conteo.
- Deudas: calendario cuadra con la formula; ultimo pago deja saldo 0; casos degenerados detectados; Snowball/Avalanche deterministas.
- Vinculacion de pagos de deuda sin doble conteo; reduccion de pasivo no tratada como consumo.
- Integridad bajo sincronizacion/migracion/restauracion: sin perdida, duplicacion, mezcla ni sobrescritura silenciosa de importes.

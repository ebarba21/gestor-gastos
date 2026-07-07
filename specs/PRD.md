# PRD: Gestor de Gastos PWA

Documento de producto. Define objetivo, alcance, casos de uso, requisitos y roadmap. Fuente: `BRIEF.md` e invariantes de `CLAUDE.md`. Detalle tecnico en `ARCHITECTURE.md` y `DATA_MODEL.md`.

---

## 1. Objetivo y vision

Aplicacion personal de gestion de gastos, **local-first** y de **coste 0 euros**, que permite importar movimientos bancarios, categorizarlos automaticamente con reglas, fijar presupuestos y entender las finanzas mediante un dashboard, garantizando que **ningun dato financiero sale del dispositivo**. Multiusuario mediante **perfiles locales aislados** en el mismo dispositivo.

Vision: una herramienta rapida, privada y gratuita para siempre, que sustituya a hojas de calculo manuales y a apps de finanzas de pago o que suben datos a la nube.

---

## 2. Perfil de usuario y problemas que resuelve

**Usuario tipo**: persona (o convivientes que comparten dispositivo) que quiere controlar sus gastos con datos reales de sus bancos, sin pagar suscripciones y sin ceder sus datos financieros a terceros.

**Problemas que resuelve**:
- Las apps de finanzas de pago cuestan dinero o dependen de free tiers limitados.
- Las apps cloud suben datos financieros a servidores de terceros (perdida de privacidad).
- Las hojas de calculo manuales son tediosas: categorizar a mano, sin reglas, sin dashboard fiable.
- Compartir un dispositivo mezcla las finanzas de varias personas.

**Como lo resuelve**: todo local en IndexedDB, sin backend, con importacion desde extractos, autocategorizacion por reglas, perfiles aislados y backups manuales para mover datos entre dispositivos.

---

## 3. Funcionalidades

### 3.1 Imprescindibles (MVP): cobertura de los 30 puntos del BRIEF

| # BRIEF | Funcionalidad | Fase construccion |
|--------|---------------|-------------------|
| 1-3 | Perfiles locales: crear, cambiar, separacion total por `profileId` | 2 |
| 4-8 | Importar CSV/XLSX: mapeo de columnas, plantillas reutilizables, preview, deteccion de duplicados | 3 |
| 9-11 | Movimientos: CRUD, edicion/borrado masivo, filtrar/buscar/ordenar por todos los campos | 3 |
| 12-13 | Categorias, subcategorias, etiquetas; cuentas/fuentes | 1-2 |
| 14-20 | Reglas: condiciones (texto, importe, fecha, cuenta, tipo, regex, prioridad), auto y retroactivas, import de reglas, `categorizedBy`, simulacion | 4 |
| 21-22 | Presupuestos/metas por categoria, subcategoria, cuenta y periodo; evaluacion | 5 |
| 23-24 | Dashboard con graficos y las 9 metricas del BRIEF | 5 |
| 25-28 | Exportar a Excel (movimientos filtrados/todos, reglas, categorias, cuentas, metas, dashboard); backups por perfil | 6 |
| 29 | Movimientos especiales: transferencias, reembolsos, splits, exclusiones (modelado ahora; UI basica MVP) | 1 (modelo) / segun seccion |
| 30 | UX clara, rapida y segura | 7 y transversal |

### 3.2 Avanzadas (dentro del MVP, versión basica)
- Transferencias internas: creacion manual del par enlazado (deteccion inteligente => fase 2).
- Reembolsos: enlace simple al gasto original (matching automatico => fase 2).
- Splits: reparto simple en formulario (UI avanzada => fase 2).
- Forecast de cierre de mes: proyeccion simple (modelo avanzado => fase 2).

### 3.3 Fuera del MVP (fase 2), con diseño previsto
Los 10 puntos de fase 2 del BRIEF. Se deja la arquitectura preparada (campos y capas) para no rehacer nada:
1. Movimientos recurrentes avanzados.
2. Reembolsos avanzados (campo `refundOfId` ya existe).
3. Splits avanzados (campo `parentId`/`isSplitParent` ya existen).
4. Transferencias internas inteligentes (campo `transferGroupId` ya existe).
5. Forecast avanzado.
6. Cifrado local real con Web Crypto (`Setting.encryptionEnabled` reservado; repositorios como unico punto de acceso).
7. App desktop con Tauri.
8. Sincronizacion cloud opcional.
9. Autohosting opcional.
10. Multiusuario cloud real.

Justificacion de mover a fase 2: son funcionalidades que multiplican la complejidad (matching, recurrencia, criptografia, red) sin ser necesarias para el flujo central "importar -> categorizar -> entender -> exportar". El modelo de datos ya reserva los campos, asi que activarlas despues es aditivo, no un rediseño.

---

## 4. Casos de uso

### Principales
1. **Importar un extracto**: el usuario sube un CSV/XLSX del banco, aplica (o crea) una plantilla de mapeo, revisa la previsualizacion con avisos de duplicados y confirma la importacion.
2. **Categorizar por reglas**: crea reglas ("si el concepto contiene MERCADONA => Alimentacion"), las simula, las aplica a movimientos nuevos automaticamente y de forma retroactiva a los antiguos.
3. **Revisar el dashboard**: consulta gasto por categoria, evolucion mensual, ingresos vs gastos, ahorro neto y tasa de ahorro, top gastos, recurrentes, comparativa vs promedio y forecast de cierre de mes.
4. **Fijar y seguir presupuestos**: define metas por categoria/cuenta/periodo y ve el consumo.
5. **Exportar / hacer backup**: exporta movimientos filtrados o todo a Excel; genera un backup del perfil para llevarlo a otro dispositivo.
6. **Cambiar de perfil**: alterna entre perfiles locales; cada uno ve solo sus datos.

### Secundarios
- Editar/borrar movimientos en masa tras un filtro.
- Registrar una transferencia interna entre dos cuentas propias.
- Marcar un ingreso como reembolso de un gasto.
- Dividir (split) un movimiento en varias categorias.
- Excluir un movimiento de las estadisticas.
- Importar reglas desde un CSV/XLSX.
- Restaurar un backup en un dispositivo nuevo.
- Gestionar categorias, subcategorias, etiquetas y cuentas.

---

## 5. Requisitos funcionales

### 5.1 Perfiles
- Crear, renombrar, archivar y borrar perfiles locales.
- Cambiar de perfil activo; el resto de la app opera siempre sobre el perfil activo.
- Aislamiento total: toda query, calculo, vista y exportacion filtra por `profileId`. Sin vista cruzada entre perfiles.
- Borrar perfil elimina en cascada todos sus datos, con doble confirmacion.

### 5.2 Cuentas, categorias, etiquetas
- CRUD de cuentas/fuentes (banco, tarjeta, efectivo, PayPal, conjunta, otras) con saldo inicial; saldo actual calculado.
- CRUD de categorias con un nivel de subcategorias; CRUD de etiquetas.
- No se borra una categoria/cuenta/etiqueta en uso sin reasignar; se ofrece archivar.

### 5.3 Importacion
- Formatos CSV y XLSX (SheetJS).
- Mapeo manual de columnas a campos internos (fecha, concepto, importe o debe/haber, cuenta, notas).
- Configuracion de formato de fecha, separador decimal y de miles, estrategia de importe (con signo o debe/haber).
- Plantillas de importacion reutilizables por banco/formato.
- Previsualizacion de los movimientos antes de importar.
- Deteccion de posibles duplicados (aviso, no bloqueo) mediante `dedupeHash`.
- Commit crea un `ImportBatch` que permite deshacer la importacion completa.
- Normalizacion de importes a centimos enteros.

### 5.4 Movimientos
- CRUD individual y edicion/borrado masivo (con confirmacion y recuento).
- Filtrar, buscar y ordenar por fecha, concepto, categoria, subcategoria, cuenta, importe, tipo, etiquetas y estado.
- Cada movimiento registra `categorizedBy` (`manual | rule | import | none`).
- Movimientos especiales: transferencias (par enlazado, excluidas de stats), reembolsos (enlace al gasto), splits (reparto en categorias), exclusion manual de estadisticas.
- Lista virtualizada para rendir con decenas de miles de movimientos.

### 5.5 Reglas de autocategorizacion
- Condiciones sobre concepto (contiene, no contiene, empieza por, termina en, coincide exacto, regex opcional), importe (mayor/menor/igual/rango), fecha (rango, antes, despues), cuenta concreta y tipo de movimiento.
- `matchMode` (todas / al menos una), `priority` (orden de evaluacion), `stopOnMatch`.
- Accion: asignar categoria/subcategoria, anadir etiquetas, forzar exclusion.
- Aplicacion automatica a movimientos nuevos y retroactiva a los existentes.
- Simulacion previa: cuenta cuantos movimientos afectaria sin escribir.
- Import de reglas desde CSV/XLSX.
- La regex se valida con manejo de error explicito (una regex invalida no rompe el motor).

### 5.6 Presupuestos y metas
- Metas por categoria, subcategoria, cuenta o global, con direccion gasto (limite) o ingreso/ahorro (objetivo).
- Periodos mensual, trimestral, anual o personalizado.
- Evaluacion del consumo respecto a la meta, respetando exclusiones y transferencias.

### 5.7 Dashboard (metricas del BRIEF, punto 24)
Gasto por categoria; evolucion mensual; ingresos vs gastos; ahorro neto; tasa de ahorro; top gastos; gastos recurrentes; comparativa contra promedio; forecast de cierre de mes. Graficos con Recharts + tablas. Todos los calculos respetan `excludedFromStats`, transferencias (excluidas), splits (cuentan las lineas hijas) y reembolsos (reducen el gasto de su categoria).

### 5.8 Exportacion y backups
- Exportar a Excel: movimientos filtrados, todos los movimientos, reglas, categorias, cuentas, metas y dashboard.
- Backups por perfil (JSON con version de esquema) y restauracion.
- Restaurar advierte de sobrescritura; recomienda backup previo.

---

## 6. Requisitos no funcionales

### 6.1 Privacidad
- Ningun dato financiero sale del dispositivo, nunca. Sin llamadas de red en runtime salvo assets propios de la PWA.
- Aislamiento por perfil garantizado por diseño (ver `DATA_MODEL.md` seccion 4).
- Sin telemetria ni analytics de ningun tipo.

### 6.2 Coste 0
- Sin backend, sin APIs de pago, sin BBDD cloud, sin auth cloud, sin IA externa, sin suscripciones, sin free tiers de los que dependa funcionalidad esencial.
- Hosting (fase 7) solo estatico y gratuito (p. ej. GitHub Pages) para instalabilidad PWA.

### 6.3 Offline y PWA
- Funcionamiento offline completo tras la primera carga.
- Service worker con precache de assets propios; sin runtime caching de terceros.
- Manifest + iconos; instalable en PC y movil (`display: standalone`).

### 6.4 Responsive
- Usable en PC y movil. Navegacion adaptada (barra lateral en PC, navegacion compacta en movil). Usabilidad por encima de decoracion.

### 6.5 Rendimiento
- Fluido con decenas de miles de movimientos: virtualizacion de listas, queries por indice `[profileId+...]`, agregaciones en memoria acotadas por periodo.
- Sin bloqueos perceptibles en import, filtrado y dashboard.

### 6.6 Robustez
- Importes en centimos enteros; nunca floats para dinero. Moneda por defecto EUR.
- Validacion y manejo de errores explicitos; sin errores silenciosos.
- Confirmacion previa en acciones destructivas o masivas; deshacer donde sea razonable.
- Tipado estricto (`strict: true`); sin `any` salvo justificacion comentada.
- Cada funcionalidad con tests Vitest de su logica de negocio y calculos.

---

## 7. Criterios de aceptacion (por bloque)

- **Perfiles**: dado dos perfiles con datos, ninguna vista/calculo/exportacion de uno muestra datos del otro. Borrar un perfil no deja datos huerfanos.
- **Importacion**: un mismo fichero importado dos veces avisa de todos los duplicados en el segundo intento; deshacer un lote deja el estado exactamente como antes de importar.
- **Movimientos**: filtros y orden funcionan sobre todos los campos indicados; edicion/borrado masivo pide confirmacion con recuento y se puede deshacer.
- **Reglas**: la simulacion informa el numero real de afectados; aplicar deja `categorizedBy='rule'` y `ruleId`; una regex invalida no rompe el motor ni la UI.
- **Presupuestos**: el consumo mostrado coincide con la suma de movimientos del periodo que cuentan en estadisticas.
- **Dashboard**: las metricas excluyen transferencias, respetan exclusiones, cuentan lineas de split y aplican reembolsos como reduccion de gasto. Verificado por `finance-auditor`.
- **Exportacion/backup**: un backup exportado y restaurado en un dispositivo limpio reproduce el perfil identico.
- **Coste 0 / privacidad**: no existe ninguna peticion de red a dominios externos en runtime. Verificado por `privacy-auditor` y `/audit-coste-cero`.

---

## 8. Definicion del MVP

El MVP esta completo cuando un usuario puede, en un dispositivo y sin coste ni red externa:
1. Crear y cambiar entre perfiles locales aislados.
2. Importar sus movimientos desde CSV/XLSX con plantillas, preview y aviso de duplicados.
3. Gestionar movimientos (CRUD, masivo, filtros) con categorias, subcategorias, etiquetas y cuentas.
4. Autocategorizar con reglas (auto, retroactivo, simulacion, import de reglas).
5. Fijar presupuestos y ver un dashboard fiable con las 9 metricas.
6. Exportar a Excel y hacer/restaurar backups por perfil.
7. Usar la app instalada como PWA, responsive y offline.

Con transferencias, reembolsos, splits y exclusiones en su version basica (modelo completo, UI simple).

---

## 9. Roadmap por fases (orden obligatorio de CLAUDE.md)

1. **Modelo de datos**: entidades, indices y tipos (`DATA_MODEL.md`). Base de todo.
2. **Perfiles y aislamiento**: crear/cambiar perfil, contexto de perfil activo, repositorios que exigen `profileId`, tests de aislamiento.
3. **Importacion**: parseo CSV/XLSX, mapeo, plantillas, preview, duplicados, `ImportBatch`/deshacer.
4. **Reglas**: motor de condiciones/prioridad, auto y retroactivo, simulacion, import de reglas.
5. **Dashboard**: `statsService` con las 9 metricas + presupuestos; graficos Recharts.
6. **Exportaciones y backups**: export selectivo a Excel y backup/restore por perfil.
7. **PWA, responsive y pulido**: service worker, manifest, instalabilidad, responsive final, rendimiento (virtualizacion), accesibilidad y detalles de UX.

Regla: no se implementa una fase posterior si la anterior no esta completa y con tests en verde. Al cerrar cada fase: `privacy-auditor` y, si toca calculos, `finance-auditor`. El dashboard (fase 5) no se construye antes de resolver categorizacion, exclusiones, splits, reembolsos y perfiles, para que los graficos sean fiables.

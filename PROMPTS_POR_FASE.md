# PROMPTS LITERALES POR FASE (copiar y pegar en orden)

Como usar este documento:

1. Cada bloque marcado como PROMPT se pega tal cual en el chat de Claude Code.
2. Antes de cada fase nueva escribe /clear en el chat (empieza con contexto limpio).
3. Al final de cada fase hay una secuencia de cierre: es siempre la misma y tambien esta escrita literal.
4. No pases a la fase siguiente hasta que la actual tenga los tests en verde, los auditores den CUMPLE y hayas probado tu la app con npm run dev.

Nota sobre el orden: el criterio general es modelo de datos, perfiles, importacion, reglas, dashboard, exportaciones y PWA. Aqui esta desglosado en 10 fases porque la importacion necesita que existan antes categorias, cuentas y el CRUD de movimientos. El espiritu del orden se mantiene.

---

## SESION A: PLANIFICACION (en modo Plan, sin codigo)

Activa el modo Plan (selector bajo el cuadro de texto o Shift+Tab) y pega:

### PROMPT A

```
Lee CLAUDE.md y specs/BRIEF.md. A partir de ellos genera tres documentos:

1. specs/PRD.md: PRD completo con objetivo, perfil de usuario, problemas que resuelve, funcionalidades imprescindibles y avanzadas, que queda fuera del MVP, casos de uso principales y secundarios, requisitos funcionales y no funcionales, requisitos de privacidad, responsive, PWA, coste 0, rendimiento, importacion, exportacion, sistema de reglas y dashboard, criterios de aceptacion, definicion del MVP y roadmap por fases.

2. specs/ARCHITECTURE.md: arquitectura funcional con modulos, responsabilidades, relaciones entre modulos, flujos de datos, estados principales, estructura de carpetas de src/, navegacion por secciones (selector de perfil, dashboard, movimientos, importar, reglas, categorias, cuentas, presupuestos y metas, exportaciones, ajustes), comportamiento offline, estrategia PWA, que acciones requieren confirmacion previa, cuales deben poder deshacerse y como se garantiza el aislamiento por perfil en todas las capas.

3. specs/DATA_MODEL.md: modelo de datos completo para Dexie/IndexedDB con todas las entidades, campos, tipos, indices, relaciones y como se materializa el filtrado por profileId en cada tabla. Importes en centimos como enteros. Debe cubrir: perfiles, movimientos (incluyendo transferencias internas, reembolsos, movimientos divididos y excluidos de estadisticas, y el campo que registra si la categorizacion fue manual o por regla), categorias, subcategorias, etiquetas, cuentas, reglas de autocategorizacion con sus condiciones y prioridad, plantillas de importacion, presupuestos/metas y metadatos de backup. Incluye el esquema de versionado de la base de datos para poder migrar en el futuro.

Se critico: si algo complica el MVP, muevelo a fase 2 pero explica como disenar ahora para no rehacer la arquitectura despues. No hagas preguntas salvo bloqueo real: toma decisiones razonables y explicalas brevemente.
```

Cuando genere los tres archivos: leelos, pide correcciones por chat de todo lo que no te convenza (sobre todo DATA_MODEL.md) y cuando estes conforme ejecuta en la terminal:

```
git add .
git commit -m "docs: PRD, arquitectura y modelo de datos"
git push
```

---

## SESION B: SCAFFOLDING (modo normal)

Escribe /clear y pega:

### PROMPT B

```
Crea el esqueleto del proyecto segun specs/ARCHITECTURE.md:

1. Proyecto Vite con React y TypeScript en la raiz del repo (usa npm).
2. Instala y configura: Tailwind CSS, Dexie, xlsx (SheetJS), Recharts, Vitest con @testing-library/react, y vite-plugin-pwa con manifest y service worker basicos.
3. tsconfig con strict: true.
4. Estructura de carpetas de src/ segun la arquitectura (components, pages, services, db, etc.) con archivos minimos.
5. Script npm run test configurado y un test de ejemplo que pase.
6. La app debe arrancar con npm run dev mostrando una pantalla base con la navegacion principal (pestanas o menu) todavia vacia.

No implementes ninguna funcionalidad de negocio. Al terminar ejecuta npm run test y npx tsc --noEmit y muestrame el resultado.
```

Verifica tu con npm run dev que se ve la pantalla base y cierra con:

```
git add .
git commit -m "chore: scaffolding Vite + React + TS + Tailwind + Dexie + PWA"
git push
```

---

## SECUENCIA DE CIERRE DE FASE (la misma para todas las fases 1 a 10)

Cuando Claude diga que ha terminado la fase, envia estos mensajes UNO POR UNO, esperando a que termine cada uno:

Mensaje 1:

```
/review-critico
```

Mensaje 2:

```
Usa el subagente privacy-auditor para auditar el trabajo de esta fase.
```

Mensaje 3 (solo en fases que tocan calculos: 4, 6, 7, 8 y 9):

```
Usa el subagente finance-auditor para auditar los calculos de esta fase.
```

Mensaje 4 (si los auditores encontraron problemas):

```
Corrige todos los hallazgos criticos de los auditores. Despues vuelve a ejecutar la suite de tests y el typecheck y muestrame el resultado.
```

Despues prueba tu la app (npm run dev) y termina en la terminal con:

```
git add .
git commit -m "feat: <nombre de la fase>"
git push
```

---

## FASE 1: MODELO DE DATOS

Escribe /clear y pega:

### PROMPT 1

```
Implementa la fase 1: modelo de datos, siguiendo specs/DATA_MODEL.md y specs/ARCHITECTURE.md.

Alcance:

1. Definir en src/db/ el esquema completo de Dexie con todas las tablas, indices y el versionado de base de datos descritos en specs/DATA_MODEL.md.
2. Definir en TypeScript los tipos/interfaces de todas las entidades.
3. Crear la capa de repositorios: una funcion o clase por entidad con operaciones basicas (crear, leer, actualizar, borrar, listar). En todas las entidades que pertenecen a un perfil, profileId debe ser parametro obligatorio y usarse en todas las queries. Ningun componente de UI debe acceder a Dexie directamente, solo a traves de estos repositorios.
4. Utilidades de dinero: los importes se almacenan en centimos como enteros. Crea helpers para convertir entre centimos y representacion en euros (solo para presentacion) con tests.
5. Tests con Vitest de los repositorios (usa fake-indexeddb como dependencia de desarrollo para testear Dexie), incluyendo tests que demuestren que las queries filtran por profileId.

No implementes UI en esta fase mas alla de lo minimo para que compile. Al terminar ejecuta la suite completa y el typecheck y muestrame el resultado.
```

Aplica la SECUENCIA DE CIERRE. Commit sugerido: `feat: modelo de datos y capa de repositorios`

---

## FASE 2: PERFILES Y AISLAMIENTO

Escribe /clear y pega:

### PROMPT 2

```
Implementa la fase 2: perfiles locales y aislamiento de datos, siguiendo specs/PRD.md, specs/ARCHITECTURE.md y specs/DATA_MODEL.md.

Alcance:

1. Crear, renombrar y eliminar perfiles locales (eliminar con confirmacion explicita que avisa de que se borran todos los datos del perfil).
2. Pantalla de seleccion de perfil al abrir la app y posibilidad de cambiar de perfil desde la navegacion.
3. El perfil activo debe quedar disponible para toda la app mediante un contexto o store, y toda operacion de datos debe usar su profileId.
4. Garantia de aislamiento: ningun dato de un perfil puede verse desde otro. No existe ninguna vista global entre perfiles.
5. Estado vacio cuidado: que ve un usuario recien creado sin datos.
6. Tests que demuestren el aislamiento: crea datos en dos perfiles y verifica que las queries de uno no devuelven datos del otro.

Recuerda los invariantes de CLAUDE.md. Al terminar ejecuta la suite completa y el typecheck y muestrame el resultado.
```

Aplica la SECUENCIA DE CIERRE. Commit sugerido: `feat: perfiles locales y aislamiento de datos`

---

## FASE 3: CATEGORIAS, SUBCATEGORIAS, ETIQUETAS Y CUENTAS

Escribe /clear y pega:

### PROMPT 3

```
Implementa la fase 3: categorias, subcategorias, etiquetas y cuentas, siguiendo specs/PRD.md, specs/ARCHITECTURE.md y specs/DATA_MODEL.md.

Alcance:

1. CRUD completo de categorias y subcategorias (una subcategoria pertenece a una categoria), con las pantallas correspondientes en la seccion Categorias.
2. CRUD completo de etiquetas.
3. CRUD completo de cuentas o fuentes de movimientos (por ejemplo banco principal, tarjeta, efectivo, PayPal, cuenta conjunta) en la seccion Cuentas.
4. Todo pertenece al perfil activo y filtra por profileId.
5. Reglas de integridad: que ocurre al borrar una categoria, subcategoria, etiqueta o cuenta que ya esta en uso por movimientos. Propon un comportamiento razonable (por ejemplo reasignar o impedir el borrado con aviso), explicalo e implementalo con confirmacion previa.
6. Un set de categorias por defecto razonable al crear un perfil nuevo (editable y borrable).
7. Tests de la logica de negocio e integridad.

Recuerda los invariantes de CLAUDE.md. Al terminar ejecuta la suite completa y el typecheck y muestrame el resultado.
```

Aplica la SECUENCIA DE CIERRE. Commit sugerido: `feat: categorias, subcategorias, etiquetas y cuentas`

---

## FASE 4: MOVIMIENTOS (CRUD, FILTROS, EDICION MASIVA Y MOVIMIENTOS ESPECIALES)

Escribe /clear y pega:

### PROMPT 4

```
Implementa la fase 4: gestion de movimientos, siguiendo specs/PRD.md, specs/ARCHITECTURE.md y specs/DATA_MODEL.md.

Alcance:

1. Seccion Movimientos con listado, creacion, edicion y borrado individual de movimientos.
2. Filtrar, buscar y ordenar por fecha, concepto, categoria, subcategoria, cuenta, importe, tipo, etiquetas y estado.
3. Seleccion multiple con edicion masiva (cambiar categoria, cuenta, etiquetas, etc.) y borrado masivo, siempre con confirmacion previa que indique cuantos movimientos se veran afectados.
4. Movimientos especiales: marcar un movimiento como transferencia interna, como reembolso, como excluido de estadisticas, y dividir un movimiento en partes (split) cuyas partes deben sumar el total.
5. Cada movimiento registra si su categorizacion fue manual o por regla (en esta fase todo sera manual).
6. Rendimiento: el listado debe seguir siendo fluido con decenas de miles de movimientos (usa paginacion o virtualizacion).
7. Tests de la logica: filtros, edicion masiva, splits (suma de partes), y aislamiento por perfil.

Recuerda los invariantes de CLAUDE.md. Al terminar ejecuta la suite completa y el typecheck y muestrame el resultado.
```

Aplica la SECUENCIA DE CIERRE (incluye finance-auditor). Commit sugerido: `feat: gestion de movimientos con filtros, edicion masiva y movimientos especiales`

---

## FASE 5: IMPORTACION CSV/XLSX

Escribe /clear y pega:

### PROMPT 5

```
Implementa la fase 5: importacion de movimientos desde CSV y XLSX, siguiendo specs/PRD.md, specs/ARCHITECTURE.md y specs/DATA_MODEL.md.

Alcance:

1. Seccion Importar datos: subir un archivo CSV o XLSX (usa SheetJS) y leerlo integramente en el navegador, sin enviarlo a ningun sitio.
2. Mapeo manual de columnas: el usuario asigna cada columna del archivo a los campos internos (fecha, concepto, importe, cuenta, categoria, etiquetas, etc.), con deteccion automatica inicial como sugerencia editable.
3. Soporte robusto de formatos: fechas dd/mm/yyyy y otros formatos comunes de banca espanola, importes con coma decimal y separador de miles, signos negativos y columnas separadas de cargo/abono.
4. Plantillas de importacion: guardar el mapeo con un nombre y reutilizarlo en futuras importaciones. CRUD de plantillas.
5. Previsualizacion completa antes de importar: tabla con los movimientos resultantes, errores de parseo senalados fila a fila y posibilidad de excluir filas.
6. Deteccion de posibles duplicados contra los movimientos ya existentes del perfil (por fecha, importe y concepto similares), mostrandolos marcados en la previsualizacion para que el usuario decida importarlos o no.
7. La importacion es atomica por lote: si falla a mitad, no deben quedar movimientos a medias. Registra en cada movimiento que proviene de una importacion.
8. Tests: parseo de formatos, mapeo, deteccion de duplicados, atomicidad y aislamiento por perfil.

Recuerda los invariantes de CLAUDE.md. Al terminar ejecuta la suite completa y el typecheck y muestrame el resultado.
```

Aplica la SECUENCIA DE CIERRE. Commit sugerido: `feat: importacion CSV/XLSX con mapeo, plantillas y deteccion de duplicados`

---

## FASE 6: REGLAS DE AUTOCATEGORIZACION

Escribe /clear y pega:

### PROMPT 6

```
Implementa la fase 6: reglas de autocategorizacion, siguiendo specs/PRD.md, specs/ARCHITECTURE.md y specs/DATA_MODEL.md.

Alcance:

1. Seccion Reglas con CRUD de reglas. Una regla tiene condiciones, una accion de categorizacion (categoria, subcategoria y opcionalmente etiquetas) y una prioridad.
2. Condiciones soportadas: contiene texto, no contiene texto, empieza por, termina en, coincide exactamente, regex opcional, importe mayor que, importe menor que, rango de fechas, cuenta concreta y tipo de movimiento. Una regla puede combinar varias condiciones (todas deben cumplirse).
3. Motor de reglas: dado un movimiento, se evalua contra las reglas por orden de prioridad y se aplica la primera que coincide. Debe ser una funcion pura en services, testeable de forma aislada.
4. Aplicacion automatica a movimientos nuevos (creados a mano o importados) y aplicacion retroactiva bajo demanda a los movimientos existentes, con confirmacion previa.
5. Simulacion: antes de guardar o aplicar una regla, mostrar cuantos y que movimientos afectaria, sin modificar nada.
6. Los movimientos categorizados por regla registran que regla los categorizo. La recategorizacion manual posterior prevalece y queda marcada como manual.
7. Importacion de reglas desde CSV o XLSX, reutilizando la infraestructura de importacion de la fase 5 (mapeo y previsualizacion).
8. Tests exhaustivos del motor: cada tipo de condicion, combinaciones, prioridades, regex invalidas y aislamiento por perfil.

Recuerda los invariantes de CLAUDE.md. Al terminar ejecuta la suite completa y el typecheck y muestrame el resultado.
```

Aplica la SECUENCIA DE CIERRE (incluye finance-auditor). Commit sugerido: `feat: motor de reglas de autocategorizacion con simulacion e importacion`

---

## FASE 7: PRESUPUESTOS Y METAS

Escribe /clear y pega:

### PROMPT 7

```
Implementa la fase 7: presupuestos y metas, siguiendo specs/PRD.md, specs/ARCHITECTURE.md y specs/DATA_MODEL.md.

Alcance:

1. Seccion Presupuestos y metas: crear, editar y eliminar presupuestos o metas por categoria, subcategoria, cuenta y periodo (mensual como minimo; si el modelo lo permite, tambien trimestral y anual).
2. Evaluacion: para cada presupuesto, calcular el gasto o ingreso real del periodo y compararlo con el objetivo (importe consumido, porcentaje, restante, superado o no).
3. Los calculos deben excluir transferencias internas y movimientos excluidos de estadisticas, y tratar correctamente reembolsos y splits, reutilizando funciones de calculo compartidas en services (las mismas que usara el dashboard).
4. Indicadores visuales claros de progreso y de presupuesto superado.
5. Tests de todos los calculos: periodos con y sin datos, cambio de mes y de ano, exclusiones, reembolsos, splits y aislamiento por perfil.

Recuerda los invariantes de CLAUDE.md. Al terminar ejecuta la suite completa y el typecheck y muestrame el resultado.
```

Aplica la SECUENCIA DE CIERRE (incluye finance-auditor). Commit sugerido: `feat: presupuestos y metas con evaluacion por periodo`

---

## FASE 8: DASHBOARD

Escribe /clear y pega:

### PROMPT 8

```
Implementa la fase 8: dashboard, siguiendo specs/PRD.md, specs/ARCHITECTURE.md y specs/DATA_MODEL.md.

Alcance:

1. Seccion Dashboard con selector de periodo (mes actual por defecto, navegacion entre meses y rango personalizado).
2. Metricas y graficos con Recharts: gasto por categoria, evolucion mensual, ingresos vs gastos, ahorro neto, tasa de ahorro, top gastos, gastos recurrentes detectados, comparativa contra el promedio de meses anteriores y forecast simple de cierre de mes (extrapolacion del ritmo de gasto actual, claramente etiquetado como estimacion).
3. Todos los calculos en funciones puras de services, reutilizando las funciones compartidas de la fase 7. Exclusion de transferencias internas y movimientos excluidos, tratamiento correcto de reembolsos y splits.
4. Todo filtrado por el perfil activo. El dashboard no mezcla perfiles bajo ninguna circunstancia.
5. Estados vacios cuidados (periodo sin datos) y rendimiento fluido con decenas de miles de movimientos (agrega en services, no en el render).
6. Responsive: los graficos deben verse bien en movil y en PC.
7. Tests de todas las funciones de calculo: casos vacios, division por cero en tasas, cambio de ano, exclusiones y aislamiento por perfil.

Recuerda los invariantes de CLAUDE.md. Al terminar ejecuta la suite completa y el typecheck y muestrame el resultado.
```

Aplica la SECUENCIA DE CIERRE (incluye finance-auditor). Despues envia tambien:

```
/audit-financiero dashboard completo
```

Commit sugerido: `feat: dashboard con metricas, graficos y forecast`

---

## FASE 9: EXPORTACIONES, BACKUP Y RESTAURACION

Escribe /clear y pega:

### PROMPT 9

```
Implementa la fase 9: exportaciones, backup y restauracion, siguiendo specs/PRD.md, specs/ARCHITECTURE.md y specs/DATA_MODEL.md.

Alcance:

1. Seccion Exportaciones: exportar a Excel (XLSX con SheetJS) los movimientos filtrados actualmente, todos los movimientos, las reglas, las categorias, las cuentas, las metas y un resumen del dashboard. Todo generado en el navegador y descargado como archivo local.
2. Las exportaciones deben usar exactamente las mismas funciones de calculo y filtrado que la interfaz, sin reimplementar logica.
3. Backup completo por perfil: exportar todos los datos del perfil activo a un unico archivo JSON versionado (incluye la version del esquema de datos).
4. Restauracion: importar un archivo de backup en el perfil activo o como perfil nuevo, con validacion del archivo, aviso claro de que se va a sobreescribir o crear, y confirmacion previa. La restauracion debe ser atomica.
5. En Ajustes, explicar al usuario como mover sus datos entre PC y movil usando backup y restauracion.
6. Tests: ida y vuelta completa (backup y restauracion dejan los datos identicos), validacion de archivos corruptos o de version incompatible, y que un backup solo contiene datos del perfil activo.

Recuerda los invariantes de CLAUDE.md. Al terminar ejecuta la suite completa y el typecheck y muestrame el resultado.
```

Aplica la SECUENCIA DE CIERRE (incluye finance-auditor). Commit sugerido: `feat: exportaciones Excel y backup/restauracion por perfil`

---

## FASE 10: PWA, RESPONSIVE Y PULIDO FINAL

Escribe /clear y pega:

### PROMPT 10

```
Implementa la fase 10: PWA, responsive y pulido final, siguiendo specs/PRD.md y specs/ARCHITECTURE.md.

Alcance:

1. PWA completa: manifest con nombre, iconos y colores, service worker que cachea todos los assets para funcionamiento offline total, e instalabilidad en PC y movil. La app debe funcionar completa sin conexion.
2. Repaso responsive de todas las pantallas en movil (360px de ancho) y PC: navegacion comoda en tactil, tablas usables en pantalla estrecha, formularios comodos con una mano.
3. Pulido de UX: estados vacios, estados de error, mensajes de confirmacion consistentes, y textos claros en toda la app.
4. Revisar que no exista ninguna llamada de red en runtime salvo el service worker sirviendo assets propios.
5. Ejecuta npm run build y verifica que la build de produccion compila sin errores y que la PWA pasa una revision basica (manifest valido, service worker registrado).

Al terminar ejecuta la suite completa y el typecheck y muestrame el resultado.
```

Aplica la SECUENCIA DE CIERRE. Despues envia tambien estos dos, uno por uno:

```
/audit-coste-cero
```

```
/review-ux toda la app, pantalla por pantalla
```

Commit sugerido: `feat: PWA instalable, offline, responsive y pulido final`

---

## SESION FINAL: VERIFICACION DE USO REAL

Escribe /clear y pega:

### PROMPT FINAL

```
Haz una verificacion final de uso real de la app completa. Genera un archivo docs/CHECKLIST_FINAL.md con una checklist verificable y ve comprobando cada punto (con tests, con el codigo o indicando que requiere prueba manual mia):

1. Crear un perfil nuevo funciona.
2. Cambiar entre perfiles funciona y no se mezclan datos.
3. Importar un CSV real de banco funciona (mapeo, plantilla, previsualizacion, duplicados).
4. Importar un XLSX funciona.
5. CRUD de movimientos individual y masivo funciona.
6. Transferencias internas, reembolsos, splits y exclusiones funcionan y no contaminan estadisticas.
7. Las reglas categorizan automaticamente y la simulacion es correcta.
8. La aplicacion retroactiva de reglas funciona.
9. Los presupuestos evaluan correctamente.
10. El dashboard muestra datos coherentes con el listado de movimientos.
11. Las exportaciones a Excel reflejan lo mismo que la interfaz.
12. El backup y la restauracion dejan los datos identicos.
13. La app funciona completamente offline.
14. La app es instalable como PWA.
15. Funciona en movil y en PC.
16. No hay llamadas de red innecesarias.
17. No hay ningun coste asociado ni dependencia de pago.
18. La app explica como mover datos entre dispositivos con backup.

Para cada punto indica: COMPROBADO (y como), o PENDIENTE DE PRUEBA MANUAL (y los pasos exactos que debo seguir yo para probarlo).
```

Repasa los pendientes manuales tu mismo con npm run dev (y con el movil usando npm run dev -- --host). Cierre final:

```
git add .
git commit -m "docs: checklist final de verificacion de uso real"
git push
```

---

## RECORDATORIOS RAPIDOS

- /clear antes de cada fase, siempre.
- Los diffs que Claude propone se revisan antes de aceptar.
- Si algo sale mal a mitad de fase: /fix-bug seguido de la descripcion del problema.
- Si quieres algo que no esta en estos prompts: /new-feature seguido de la descripcion.
- Termina cada sesion con git add . , git commit -m "..." y git push.

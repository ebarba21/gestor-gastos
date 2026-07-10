# Gestor de Gastos: funcionalidades, usos y beneficios

Resumen completo de todo lo que hace la aplicacion, de lo primero a lo ultimo. Es una PWA de gestion de gastos personales, local-first, multiusuario por perfiles y con coste 0 euros garantizado.

---

## 1. Filosofia y garantias de base

- **Coste 0 euros, para siempre**: sin backend, sin APIs de pago, sin bases de datos cloud, sin suscripciones ni free tiers de los que dependa nada esencial.
- **Local-first y privacidad total**: todos los datos financieros viven en IndexedDB de tu dispositivo. Ningun dato financiero sale del dispositivo, nunca. Sin telemetria ni analytics de ningun tipo.
- **Sin red en runtime**: la app no hace ninguna llamada a dominios externos; solo el service worker sirve sus propios assets.
- **Dinero exacto**: todos los importes se manejan en centimos como enteros. Nunca floats, nunca errores de redondeo acumulados.
- **Sin errores silenciosos**: validaciones y manejo de errores explicitos en toda la app.
- **Calidad verificada**: la logica de negocio y los calculos financieros estan cubiertos por una suite amplia de tests (Vitest), incluyendo tests especificos de aislamiento entre perfiles.

**Beneficio**: control absoluto de tus finanzas sin pagar nada, sin crear cuentas online y sin que nadie (ni siquiera el desarrollador) pueda ver tus datos.

## 2. Perfiles locales (multiusuario)

- Varios perfiles en el mismo dispositivo (por ejemplo: tu, tu pareja, cuentas de casa), cada uno con nombre, color de acento y avatar emoji.
- **Aislamiento total por perfil**: toda consulta, calculo, exportacion y vista filtra por perfil. Un perfil no puede ver datos de otro, por diseno y con tests que lo garantizan.
- Selector de perfil siempre accesible; la app recuerda el ultimo perfil abierto.
- Archivar perfiles sin borrarlos; borrado de perfil con doble confirmacion (hay que escribir el nombre) y borrado en cascada de todos sus datos.
- Configuracion por perfil: moneda (EUR por defecto), locale, inicio de semana, cuenta por defecto.

**Beneficio**: una sola instalacion sirve para toda la familia sin mezclar datos ni comprometer la privacidad de nadie.

## 3. Cuentas y fuentes de dinero

- Cuentas de tipo banco, tarjeta, efectivo, monedero digital, cuenta compartida u otras, con color propio.
- Saldo inicial por cuenta y **saldo actual calculado** automaticamente a partir de los movimientos (nunca desincronizado).
- Archivado de cuentas; proteccion contra el borrado de cuentas con movimientos (obliga a resolver antes).

**Beneficio**: la foto completa de tu dinero repartido entre bancos, tarjetas y efectivo, siempre cuadrada.

## 4. Categorias, subcategorias y etiquetas

- Categorias de gasto, ingreso o ambas, con color, icono/emoji y orden manual.
- Subcategorias (un nivel) para afinar el analisis (por ejemplo Alimentacion > Supermercado).
- Etiquetas libres transversales, independientes de la categoria, para cortes de analisis adicionales (por ejemplo "vacaciones 2026").
- Proteccion al borrar: si una categoria, cuenta o etiqueta esta en uso, la app obliga a reasignar o bloquea el borrado.
- **Categorias especiales de Ahorro e Inversion**: si llamas a una categoria "Ahorro/Ahorros" o "Inversion/Inversiones" (con o sin acentos, mayusculas indiferentes), sus movimientos dejan de contar como gasto y pasan a medirse como aportaciones a ahorro o inversion. Las subcategorias heredan el tratamiento.

**Beneficio**: clasificacion a tu medida, y un tratamiento financiero correcto del dinero que apartas (ahorrar o invertir no es gastar).

## 5. Movimientos (la entidad central)

- Alta, edicion y borrado de movimientos con fecha contable, importe, concepto, notas, cuenta, categoria, subcategoria, etiquetas y estado (pendiente, confirmado, conciliado).
- **Lista virtualizada**: fluida incluso con decenas de miles de movimientos.
- **Filtros combinables**: fecha, concepto, categoria, subcategoria, cuenta, importe, tipo, etiquetas y estado.
- **Acciones masivas** con confirmacion y recuento: edicion y borrado en lote, con deshacer.
- **Splits (movimientos divididos)**: un ticket unico repartido en varias lineas con categorias distintas; la suma de las partes siempre cuadra con el total y las estadisticas cuentan las lineas, no el padre (sin duplicar).
- **Transferencias internas**: par de movimientos enlazados entre dos cuentas propias; afectan al saldo de cada cuenta pero se excluyen de las estadisticas (mover tu dinero no es ni gasto ni ingreso).
- **Reembolsos**: una devolucion se enlaza con su gasto original y reduce el gasto neto de esa categoria (no infla los ingresos). Funciona aunque el gasto original sea de otro mes.
- **Exclusion de estadisticas**: cualquier movimiento puede marcarse para no contar en las metricas, sin dejar de afectar al saldo.
- **Trazabilidad de la categorizacion**: cada movimiento registra si se categorizo a mano, por regla (y cual), por importacion o esta sin categorizar.
- Toasts con **deshacer** tras las operaciones reversibles; confirmacion previa en las destructivas.

**Beneficio**: un registro fiel de tu realidad financiera, con la semantica correcta en los casos dificiles (tickets compartidos, devoluciones, traspasos) que las apps simples calculan mal.

## 6. Importacion de extractos (CSV y XLSX)

- Wizard de importacion en pasos: elegir archivo, mapear columnas, previsualizar y confirmar.
- Soporta CSV y Excel (XLSX), con o sin fila de cabecera.
- **Mapeo de columnas flexible**: fecha, concepto, importe (una columna con signo o dos columnas debe/haber), cuenta y notas; formato de fecha configurable y separadores decimal y de miles configurables.
- **Plantillas de importacion reutilizables**: guarda el mapeo de tu banco una vez y reutilizalo en cada extracto (por ejemplo "Ibercaja XLSX", "Revolut CSV", "BBVA tarjeta").
- **Deteccion de duplicados**: cada fila se compara contra lo ya importado (hash por cuenta, fecha, importe y concepto normalizado); los posibles duplicados se marcan en la previsualizacion y tu decides importarlos o saltarlos. Aviso, no bloqueo: dos compras identicas reales son legitimas.
- **Deshacer una importacion completa**: cada importacion queda registrada como lote y puede revertirse entera con un clic.
- Aplicacion automatica opcional de las reglas de categorizacion a los movimientos recien importados.

**Beneficio**: pasar del extracto del banco a datos limpios y categorizados en un par de minutos, sin teclear y sin miedo a duplicar o a equivocarte (todo se puede deshacer).

## 7. Reglas de autocategorizacion

- Reglas con una o varias **condiciones** sobre concepto (contiene, empieza por, termina en, igual, regex...), importe (mayor, menor, entre...), fecha, cuenta o tipo, combinadas con "todas" o "alguna".
- **Accion** de la regla: asignar categoria y subcategoria, anadir etiquetas y/o excluir de estadisticas.
- **Prioridades** y "parar al coincidir" para controlar el orden de evaluacion.
- **Simulacion (dry run)**: antes de aplicar, la app te dice cuantos movimientos se verian afectados, sin escribir nada.
- **Aplicacion retroactiva** sobre el historico, con confirmacion previa; la categorizacion manual no se pisa salvo que lo pidas.
- **Importacion de reglas** desde CSV/XLSX para crear muchas de golpe.
- Una regex invalida nunca rompe el motor: se avisa y la condicion no casa.

**Beneficio**: el trabajo repetitivo de categorizar desaparece; tras unas pocas reglas, cada extracto entra ya clasificado.

## 8. Dashboard (analisis del perfil activo)

- **Selector de periodo**: mes en curso por defecto, navegacion entre meses y rango personalizado de fechas.
- **KPIs del periodo**: ingresos, gasto neto (con desglose bruto y reembolsos), ahorro neto y tasa de ahorro.
- **Reparto del ahorro neto** en "Ahorrado" e "Invertido" cuando hay inversion, con barra proporcional y avisos honestos (por ejemplo si invertiste mas de lo que ahorraste ese mes).
- **Evolucion mensual**: ingresos, gasto neto y ahorro por mes en areas; pulsar un mes lo fija como periodo.
- **Gasto por categoria**: ranking de categorias con colores propios; pulsar una categoria filtra el resto del dashboard (**filtro cruzado**).
- **Ingresos vs gastos** del periodo.
- **Top gastos** individuales del periodo.
- **Gastos recurrentes** detectados automaticamente (conceptos repetidos en varios meses distintos: suscripciones, recibos...).
- **Comparativa contra tu promedio**: el gasto del mes frente a la media de los meses anteriores con actividad, prorrateada con regla de 3 si el mes esta a medias (comparacion justa dia a dia).
- **Forecast de cierre de mes**: proyeccion simple del gasto a fin de mes segun el ritmo actual, claramente etiquetada como estimacion.
- **Apartado "Ahorro e inversion"** (analitica dedicada):
  - Aportado a ahorro y a inversion en la ventana analizada, con el acumulado historico de cada uno.
  - Ahorro neto acumulado y tasa de ahorro media del periodo.
  - **Racha actual de meses ahorrando** y mejor racha conseguida.
  - Insights automaticos: tu mejor mes de ahorro neto, el mes que mas invertiste, tu mejor tasa de ahorro y tus medias mensuales.
  - Grafico de **aportaciones por mes** (ahorro e inversion apilados) y grafico del **acumulado** de la ventana.
  - Las retiradas (reembolsos de aportaciones) restan del aportado: los numeros reflejan el neto real.
- Estados cuidados: cargando, periodo sin datos, rango invalido; todo con mensajes claros.

**Beneficio**: entender de un vistazo en que se va el dinero, si vas mejor o peor que tu propio historico, cuanto estas apartando de verdad para el futuro y que habitos de ahorro estas construyendo.

## 9. Presupuestos y metas

- Presupuestos por categoria, subcategoria, cuenta o globales.
- Direccion gasto (limite que no quieres superar) o ingreso/ahorro (objetivo que quieres alcanzar); las metas de ahorro pueden modelarse sobre la categoria de Ahorros.
- Periodos mensual, trimestral, anual o personalizado.
- **Consumo calculado en tiempo real** con exactamente la misma semantica que el dashboard (exclusiones, splits, reembolsos): el consumo de un presupuesto siempre cuadra con las estadisticas.
- Barras de progreso con estados visuales segun lo consumido.

**Beneficio**: limites y objetivos realistas que se vigilan solos, sin hojas de calculo aparte.

## 10. Exportaciones y backup

- **Exportar a Excel (XLSX)**: todos los movimientos o solo los filtrados, cuentas con saldos, categorias, reglas, presupuestos y un resumen completo del dashboard en hojas separadas.
- **Backup completo por perfil** en un archivo JSON con version de esquema: todos tus datos en un archivo tuyo.
- **Restauracion de backup** con resumen previo de lo que contiene y dos modos: sobrescribir el perfil actual (con confirmacion fuerte) o **crear un perfil nuevo** desde el backup sin tocar nada.
- Los backups son portables entre dispositivos (los identificadores son UUIDs sin colisiones).

**Beneficio**: tus datos son tuyos de verdad: te los llevas a Excel para lo que quieras y puedes migrar de dispositivo o recuperarte de un desastre sin depender de ninguna nube.

## 11. PWA: instalable, offline y responsive

- **Instalable** en PC y movil como una app nativa (icono propio, ventana standalone).
- **Funciona 100% offline** tras la primera carga: consultar, anadir, importar, analizar... todo sin conexion.
- Aviso de nueva version disponible con recarga controlada (nunca se recarga sola mientras editas).
- **Responsive**: la misma app comoda en un monitor grande y en la pantalla del movil.
- **Tema claro y oscuro** conmutables desde Ajustes.
- Graficos con colores validados para legibilidad y para deficiencias de vision del color, en ambos temas; la identidad de las series nunca depende solo del color.

**Beneficio**: la comodidad de una app de verdad (icono, offline, movil) sin pasar por ninguna tienda ni depender de internet.

## 12. Experiencia y seguridad de uso

- Confirmacion previa con recuento en toda accion destructiva o masiva; doble confirmacion en las irreversibles (borrar perfil, restaurar backup).
- **Deshacer** disponible en las operaciones reversibles: borrado y edicion masiva, importaciones completas, aplicacion retroactiva de reglas.
- Mensajes de exito y error visibles (toasts); nada falla en silencio.
- Arquitectura preparada para **cifrado local** con Web Crypto en una fase futura (sin implementar aun, por diseno).

**Beneficio**: puedes trastear sin miedo; los errores se avisan y casi todo tiene vuelta atras.

---

## Casos de uso tipicos

1. **Control mensual sin esfuerzo**: importas el extracto del banco a fin de mes con tu plantilla, las reglas lo categorizan solo y el dashboard te dice como fue el mes en 30 segundos.
2. **Detectar fugas de dinero**: el top de gastos y los recurrentes destapan suscripciones olvidadas y gastos hormiga; el filtro cruzado te deja investigar una categoria a fondo.
3. **Construir habito de ahorro**: creas las categorias Ahorros e Inversiones, registras tus traspasos y el apartado de ahorro e inversion te muestra rachas, mejores meses y acumulados que motivan a seguir.
4. **Presupuestar con realismo**: pones limites por categoria y la comparativa contra tu promedio te avisa pronto si el mes se esta torciendo, con el forecast estimando el cierre.
5. **Finanzas separadas en casa**: cada miembro con su perfil aislado en el mismo dispositivo; cero mezclas y cero cuentas online.
6. **Migrar o dormir tranquilo**: backup JSON periodico, y si cambias de ordenador o de movil, restauras y sigues donde estabas.

## Resumen de beneficios

- **Gratis para siempre y sin letra pequena**: no hay nada que pagar ni nadie a quien suscribirse.
- **Privacidad maxima real**: tus finanzas no salen de tu dispositivo; no hay servidor que hackear ni empresa que venda tus datos.
- **Exactitud financiera**: centimos enteros, reembolsos, splits y transferencias tratados con la semantica correcta, y todo cubierto por tests.
- **Rapidez**: de extracto bancario a analisis completo en minutos, con listas fluidas incluso con muchos anos de historico.
- **Insight accionable**: no solo registra; compara contra tu propio historico, proyecta el cierre de mes y analiza tu ahorro e inversion a largo plazo.
- **Tuyo de verdad**: exportaciones a Excel y backups portables; sin lock-in de ningun tipo.

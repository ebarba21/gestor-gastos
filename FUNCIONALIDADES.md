# Gestor de Gastos: funcionalidades, usos y beneficios

Resumen completo de lo que hace la aplicacion. Es una PWA de gestion de gastos personales, local-first, multiusuario por perfiles, sin APIs de pago para sus funciones esenciales y con una cuenta de sincronizacion privada OPCIONAL.

Nota de estado: la app funciona 100% en local sin cuenta. La ampliacion (cuenta opcional para sincronizar entre dispositivos, PIN y passkeys, comercios normalizados, duplicados avanzados, bandeja de revision, conciliacion, recurrencias, forecast y modulo de deudas) esta implementada de extremo a extremo y cubierta por tests; el estado de verificacion y las pruebas manuales pendientes (que requieren cuenta, red o dispositivo reales) estan en `docs/CHECKLIST_AMPLIACION_FINAL.md`. La cuenta y el resto de la ampliacion son OPCIONALES: el modo local sin cuenta sigue siendo ciudadano de primera clase.

---

## 1. Filosofia y garantias de base (redaccion honesta)

- **Sin APIs de pago para lo esencial**: las funciones nucleo (registrar, importar, categorizar, analizar, exportar, backup) funcionan sin cuenta, sin red y sin nada que pagar. La sincronizacion opcional usa Supabase dentro de su plan gratuito actual; no se promete "coste cero para siempre" porque los limites y precios los fija el proveedor. El modo local no requiere pagos (es software cliente estatico, sin API).
- **Local-first**: IndexedDB de tu dispositivo es siempre la base operativa; la app funciona offline. **Sin cuenta, ningun dato financiero sale del dispositivo.** Si activas la cuenta, solo los datos procesados sincronizados salen del dispositivo hacia tu proyecto Supabase, protegidos por autenticacion y por Row Level Security. Los archivos bancarios originales no se suben por defecto.
- **Privacidad real y explicada, no "total"**: sin telemetria ni analytics. La app NO ofrece privacidad total: no protege frente a un dispositivo comprometido, ni frente al propio proveedor de infraestructura, ni frente al robo de tu contrasena. Explica con precision que protege y que no (ver `specs/CLOUD_SYNC_SECURITY.md`).
- **Red controlada**: en runtime, la app solo habla con sus propios assets (service worker) y, si activas la cuenta, con el endpoint de Supabase de tu proyecto. Ningun otro dominio; sin CDNs ni fuentes remotas en ejecucion.
- **Dinero exacto**: importes en centimos como enteros y tipos de interes en representacion entera. Nunca floats, nunca redondeos acumulados.
- **Sin errores silenciosos** y **ningun conflicto financiero se resuelve solo**: si dos dispositivos cambian lo mismo, decides tu.
- **Calidad verificada**: logica de negocio y calculos financieros cubiertos por una suite amplia de tests (Vitest), con tests especificos de aislamiento entre perfiles.

**Beneficio**: controlas tus finanzas sin pagar por lo esencial y sin ceder tus datos a una app opaca; y si quieres usarlas en varios dispositivos, activas una cuenta privada sabiendo exactamente que implica.

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
- **Funciona offline** tras la primera carga: consultar, anadir, importar, analizar... todo sin conexion, porque los datos operativos estan en tu dispositivo. Si activas la cuenta, los cambios hechos sin red se guardan en local y se sincronizan al recuperar conexion.
- Aviso de nueva version disponible con recarga controlada (nunca se recarga sola mientras editas).
- **Responsive**: la misma app comoda en un monitor grande y en la pantalla del movil.
- **Tema claro y oscuro** conmutables desde Ajustes.
- Graficos con colores validados para legibilidad y para deficiencias de vision del color, en ambos temas; la identidad de las series nunca depende solo del color.

**Beneficio**: la comodidad de una app de verdad (icono, offline, movil) sin pasar por ninguna tienda; usable sin internet y, si quieres, sincronizada entre tus dispositivos.

## 11 bis. Cuenta privada y sincronizacion (opcional)

- **Cuenta opcional**: puedes seguir usando la app solo en local o activar una cuenta (email y contrasena) para llevar tus perfiles a varios dispositivos. La cuenta identifica a la persona; los perfiles siguen organizando tus datos (una cuenta puede tener varios perfiles).
- **Sincronizacion privada**: tu dispositivo sigue mandando (todo se guarda primero en local); una copia privada se sincroniza con Supabase, protegida por autenticacion y RLS. Estados claros: sincronizado, cambios pendientes, sincronizando, sin conexion, conflicto, error.
- **Sin sorpresas con tus datos existentes**: al activar la cuenta, un asistente migra tus perfiles locales sin perder ni duplicar nada, ofreciendo backup previo.
- **Otro dispositivo**: inicias sesion y la app reconstruye tus perfiles; despues funciona offline igual que antes.
- **Los archivos bancarios originales no se suben**: solo los datos ya procesados y las huellas necesarias.

## 11 ter. Seguridad de acceso: PIN y passkeys (opcional)

- **PIN local** opcional (min. 6 digitos) con bloqueo automatico configurable; nunca se guarda en claro y tu sesion se cifra con una clave derivada del PIN.
- **Passkeys**: desbloqueo con lo que ofrezca tu dispositivo (huella, cara, PIN del sistema o llave fisica) via el estandar del navegador. La biometria la gestiona tu sistema operativo: **la app nunca recibe tus datos biometricos**. Siempre queda la contrasena/PIN como alternativa.

## 11 quater. Comercios, revision y analisis avanzado

- **Comercios normalizados**: "AMZN Mktp ES", "AMAZON EU" y "Amazon.es*1234" se reconocen como Amazon, sin perder nunca el texto original del banco.
- **Duplicados con niveles de confianza** y una **bandeja de revision** que reune las excepciones tras importar (sin categorizar, posibles duplicados, transferencias/reembolsos candidatos, comercios nuevos, errores), mas **conciliacion** de saldo con tu extracto.
- **Recurrencias** (suscripciones y recibos) con avisos de subida de precio o de cobro que no llega, y un **forecast por rango** (no un solo numero) que separa lo ya gastado, lo recurrente pendiente y lo variable.
- **Modulo de deudas**: registra prestamos, ve el calendario de amortizacion, simula pagos anticipados y compara estrategias **Snowball** y **Avalanche**. No es asesoramiento financiero personalizado.

## 12. Experiencia y seguridad de uso

- Confirmacion previa con recuento en toda accion destructiva o masiva; doble confirmacion en las irreversibles (borrar perfil, restaurar backup).
- **Deshacer** disponible en las operaciones reversibles: borrado y edicion masiva, importaciones completas, aplicacion retroactiva de reglas.
- Mensajes de exito y error visibles (toasts); nada falla en silencio.
- **Bloqueo de acceso** con PIN y passkeys (opcional): protege la app en tu dispositivo, con la sesion cifrada; el cifrado de la base local completa sigue fuera de alcance por ahora.

**Beneficio**: puedes trastear sin miedo; los errores se avisan y casi todo tiene vuelta atras.

---

## Casos de uso tipicos

1. **Control mensual sin esfuerzo**: importas el extracto del banco a fin de mes con tu plantilla, las reglas lo categorizan solo y el dashboard te dice como fue el mes en 30 segundos.
2. **Detectar fugas de dinero**: el top de gastos y los recurrentes destapan suscripciones olvidadas y gastos hormiga; el filtro cruzado te deja investigar una categoria a fondo.
3. **Construir habito de ahorro**: creas las categorias Ahorros e Inversiones, registras tus traspasos y el apartado de ahorro e inversion te muestra rachas, mejores meses y acumulados que motivan a seguir.
4. **Presupuestar con realismo**: pones limites por categoria y la comparativa contra tu promedio te avisa pronto si el mes se esta torciendo, con el forecast estimando el cierre.
5. **Finanzas separadas en casa**: cada miembro con su perfil aislado en el mismo dispositivo; cero mezclas. En modo local, sin ninguna cuenta online; si alguien quiere usar sus perfiles en su propio movil, puede activar su cuenta privada.
6. **Migrar o dormir tranquilo**: con backup JSON periodico te llevas los datos a otro dispositivo sin depender de la nube; y si prefieres, activas la cuenta y la sincronizacion los mantiene al dia entre tus dispositivos.

## Resumen de beneficios

- **Sin pagar por lo esencial**: las funciones nucleo no cuestan nada y funcionan sin cuenta ni red. La sincronizacion es opcional y opera dentro del plan gratuito actual de Supabase (sin promesa de gratuidad perpetua: los limites los fija el proveedor).
- **Privacidad real y transparente**: en modo local, tus finanzas no salen del dispositivo. Con cuenta, se sincronizan de forma privada protegidas por autenticacion y RLS, y la app te explica que protege y que no (no promete privacidad total).
- **Exactitud financiera**: centimos enteros, tipos de interes en representacion entera, reembolsos, splits y transferencias con la semantica correcta, todo cubierto por tests.
- **Rapidez**: de extracto bancario a analisis completo en minutos, con listas fluidas incluso con muchos anos de historico.
- **Insight accionable**: compara contra tu propio historico, proyecta el cierre de mes por rango, sigue tu ahorro/inversion y planifica tus deudas (Snowball/Avalanche).
- **Tuyo de verdad**: exportaciones a Excel y backups portables por perfil; y, si quieres, tus datos en tus dispositivos con una cuenta privada. Sin lock-in del lado local.

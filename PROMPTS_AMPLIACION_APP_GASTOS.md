# PROMPTS LITERALES PARA AMPLIAR LA APP (copiar y pegar en orden)

## COMO USAR ESTE DOCUMENTO

1. Ejecuta las sesiones y fases exactamente en el orden indicado.
2. Antes de cada fase nueva escribe `/clear` en el chat de Claude Code para empezar con contexto limpio.
3. Cada fase contiene:
   - el prompt principal de implementacion;
   - los mensajes de auditoria que debes enviar despues, uno por uno;
   - el mensaje final de correccion, validacion, commit y push.
4. No necesitas volver al principio del documento para recordar que auditorias corresponden. Cada fase incluye su cierre completo.
5. No pases a la fase siguiente hasta que:
   - los tests esten en verde;
   - el typecheck pase;
   - la build de produccion compile;
   - no queden hallazgos criticos abiertos;
   - el commit se haya creado;
   - el push haya terminado correctamente.
6. No aceptes un `git push --force`, un `git reset --hard` ni el borrado de cambios ajenos para resolver problemas.
7. El Project Reference ID, la URL publica y la Publishable Key no son secretos. No guardes en Git la contraseña de la base de datos, tokens OAuth, Personal Access Tokens, Secret Keys ni `service_role`.
8. El proyecto remoto ya existe y se conecta a Claude Code mediante el servidor MCP oficial de Supabase. La autenticacion del MCP se realiza por OAuth y no debe guardarse en el repositorio.
9. Si una fase necesita configuracion manual externa, Claude debe implementar todo lo posible mediante el repositorio y MCP, documentar los pasos restantes y dejar el proyecto compilando sin secretos.
10. El objetivo no es sustituir IndexedDB por llamadas constantes a internet. La arquitectura final debe seguir siendo local-first:
   - IndexedDB permite trabajar sin conexion;
   - Supabase conserva una copia remota privada;
   - la sincronizacion ocurre de forma controlada;
   - la app informa cuando hay cambios pendientes o conflictos.
11. Supabase puede tener plan gratuito, pero no debe mantenerse la promesa de "0 euros garantizados para siempre". La redaccion correcta es que la aplicacion no requiere APIs de pago para sus funciones esenciales y puede operar dentro de los limites gratuitos actuales del proveedor.

## ORDEN DE IMPLEMENTACION Y DEPENDENCIAS

El orden es obligatorio:

1. Actualizar documentacion, arquitectura y modelo de datos.
2. Crear la base remota, autenticacion y seguridad RLS en Supabase.
3. Implementar la sincronizacion local-first y la migracion de los datos existentes.
4. Añadir bloqueo por PIN y acceso mediante passkeys cuando el dispositivo lo soporte.
5. Normalizar comercios y conceptos.
6. Mejorar la deteccion de duplicados usando los comercios normalizados.
7. Crear la bandeja de revision y la conciliacion.
8. Mejorar recurrencias y forecast usando comercios, duplicados y bandeja.
9. Crear la calculadora y planificador de deudas.
10. Verificar toda la aplicacion, documentar el nuevo comportamiento y cerrar la ampliacion.

No implementes duplicados avanzados antes de normalizar comercios. No implementes la bandeja antes de disponer del nuevo motor de duplicados. No implementes el nuevo forecast antes de disponer de recurrencias y comercios normalizados. No implementes PIN o passkeys antes de tener resuelta la autenticacion y el almacenamiento de sesion.

---

# DATOS FIJOS DEL PROYECTO SUPABASE

- Project Reference ID: `skwhlbwpnsdgmdsfozcr`
- Dashboard: `https://supabase.com/dashboard/project/skwhlbwpnsdgmdsfozcr`
- Propietario: `ebarbalopez21@gmail.com`
- Entorno: desarrollo
- El proyecto se ha creado vacio y no contiene datos reales de produccion.
- Data API: activada.
- Exposicion automatica de tablas nuevas: desactivada.
- RLS automatico: activado.
- Base de datos: Postgres por defecto.
- Servidor MCP de Claude Code: `supabase`.
- Alcance MCP: proyecto.
- Transporte MCP: HTTP.
- Read-only: desactivado.
- Feature groups habilitados por la configuracion oficial: database, development, docs, account, debugging, functions, branching y storage.

Aunque los feature groups esten disponibles, Claude no puede crear o eliminar proyectos, ramas, buckets, Edge Functions, organizaciones ni recursos ajenos al alcance de una fase. La disponibilidad de una herramienta no equivale a autorizacion para usarla.

---

# SESION 0: CONEXION DE CLAUDE CODE CON SUPABASE MCP

Esta sesion se realiza una sola vez antes de la SESION A.

## PASO 0.1: COMPROBAR EL REPOSITORIO

Abre una terminal normal en la raiz del repositorio y ejecuta:

```bash
git status --short
git branch --show-current
git pull --ff-only
```

Si existen cambios locales, revisalos antes de ejecutar `git pull`.

## PASO 0.2: AÑADIR EL SERVIDOR MCP

Ejecuta exactamente el comando generado por Supabase:

```bash
claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp?project_ref=skwhlbwpnsdgmdsfozcr&features=database%2Cdevelopment%2Cdocs%2Caccount%2Cdebugging%2Cfunctions%2Cbranching%2Cstorage"
```

La configuracion debe quedar a nivel de proyecto, normalmente en `.mcp.json`.

No añadas manualmente tokens OAuth, contraseñas, Secret Keys ni `service_role`.

## PASO 0.3: AUTENTICAR

En una terminal normal, no en la extension del IDE, ejecuta:

```bash
claude /mcp
```

Selecciona el servidor `supabase` y despues `Authenticate`.

Completa el flujo OAuth en el navegador con la cuenta que tiene acceso al proyecto.

Si tu version de Claude Code no abre el selector con el comando anterior, ejecuta:

```bash
claude
```

Y dentro de Claude Code escribe:

```text
/mcp
```

Selecciona `supabase` y autentica.

## PASO 0.4: INSTALAR LAS AGENT SKILLS OFICIALES

Desde la raiz del repositorio ejecuta:

```bash
npx skills add supabase/agent-skills
```

Instalalas a nivel de proyecto.

## PASO 0.5: VERIFICAR EL MCP

Abre Claude Code, escribe `/clear` y pega:

### PROMPT 0

```text
Comprueba la conexion del servidor MCP oficial `supabase`.

Datos esperados:

- Project Reference ID: skwhlbwpnsdgmdsfozcr
- Entorno de desarrollo sin datos reales
- Feature groups: database, development, docs, account, debugging, functions, branching y storage
- Read-only desactivado

Usa MCP solo para inspeccionar. No modifiques nada.

Comprueba:

1. El servidor `supabase` esta conectado y autenticado.
2. El Project Reference ID coincide exactamente.
3. Puedes obtener la URL publica y la Publishable Key sin solicitar ni mostrar Secret Keys o `service_role`.
4. Puedes listar tablas, vistas, funciones, extensiones y migraciones.
5. Puedes consultar la documentacion oficial.
6. Puedes ejecutar o consultar los asesores de seguridad y rendimiento sin realizar cambios.
7. El proyecto no contiene tablas ni datos reales de la aplicacion.
8. `.mcp.json` y los archivos de Agent Skills no contienen tokens OAuth, contraseñas, Secret Keys, `service_role`, credenciales de base de datos ni archivos `.env`.
9. Indica las herramientas MCP usadas.
10. Indica que operaciones de escritura serian posibles, pero no ejecutes ninguna.

Reglas:

- No apliques migraciones.
- No ejecutes DDL.
- No crees tablas.
- No cambies Auth.
- No crees ramas, buckets ni Edge Functions.
- No modifiques la cuenta u organizacion.
- No muestres secretos.
- No hagas commit todavia.

Responde con COMPROBADO o ERROR para cada punto.
```

## CIERRE COMPLETO DE LA SESION 0

Cuando termine el PROMPT 0, envia:

### Mensaje 0.1

```text
Si alguna comprobacion del MCP ha fallado, corrige solo la configuracion local necesaria. No crees tablas ni apliques migraciones.

Cuando todo funcione:

1. Ejecuta `git status --short`.
2. Revisa `.mcp.json` y los archivos de `supabase/agent-skills`.
3. Comprueba que no contienen tokens OAuth, contraseñas, Secret Keys, `service_role`, credenciales de base de datos ni archivos `.env`.
4. Comprueba que `.env`, `.env.local` y variantes privadas estan ignoradas por Git.
5. Añade al staging solo la configuracion MCP segura, Agent Skills y cambios necesarios de `.gitignore`.
6. Crea:
   git commit -m "chore: configurar Supabase MCP y agent skills"
7. Ejecuta `git push`.
8. Si el push es rechazado, haz fetch y rebase seguro sin force push, vuelve a revisar los secretos y repite el push.
9. Muestrame el hash del commit y confirma que GitHub esta actualizado.

No hagas commit si una credencial OAuth o cualquier secreto ha quedado dentro del repositorio.
```

No uses `/clear` entre PROMPT 0 y Mensaje 0.1. Usa `/clear` despues de terminar la SESION 0.

---

# PROTOCOLO MCP OBLIGATORIO

Estas reglas se aplican en todas las fases y tambien se repiten dentro de los prompts relevantes:

1. Inspecciona primero el estado remoto.
2. Todo cambio permanente de esquema se crea primero como archivo SQL versionado en `supabase/migrations`.
3. Revisa SQL, restricciones, indices, grants y RLS antes de aplicar.
4. Aplica mediante la herramienta MCP oficial de migraciones o el flujo oficial equivalente.
5. No uses SQL ad hoc para sustituir una migracion.
6. `execute_sql`, si esta disponible, se reserva para inspeccion, diagnostico o verificaciones no destructivas.
7. Despues de cada migracion:
   - lista las migraciones remotas;
   - comparalas con Git;
   - regenera tipos TypeScript;
   - ejecuta asesores de seguridad;
   - ejecuta asesores de rendimiento;
   - prueba RLS cuando corresponda.
8. No uses account, functions, branching o storage salvo instruccion expresa.
9. No crees ni elimines proyectos, ramas, buckets o Edge Functions salvo instruccion expresa.
10. No uses Secret Keys ni `service_role` en el frontend.
11. El MCP es una herramienta de desarrollo. La app usa Project URL, Publishable Key, Auth y RLS en runtime.
12. No hagas commit si Supabase y las migraciones del repositorio han quedado desincronizados.

---

# SESION A: REDISEÑO Y PLANIFICACION DE LA AMPLIACION

Activa el modo Plan y escribe `/clear`.

## PROMPT A

```text
El proyecto remoto de Supabase ya existe y Claude Code tiene acceso mediante el servidor MCP `supabase`.

Datos:

- Project Reference ID: skwhlbwpnsdgmdsfozcr
- Dashboard: https://supabase.com/dashboard/project/skwhlbwpnsdgmdsfozcr
- Entorno de desarrollo sin datos reales
- Agent Skills oficiales instaladas
- Data API activada
- Exposicion automatica de tablas desactivada
- RLS automatico activado
- Postgres por defecto

Durante esta sesion de planificacion:

- usa MCP solo para inspeccionar y consultar documentacion oficial;
- no apliques migraciones;
- no ejecutes SQL de escritura;
- no crees tablas;
- no cambies Auth;
- no crees ramas, buckets ni Edge Functions;
- no uses operaciones de cuenta;
- documenta como se utilizara MCP en las fases posteriores.

Lee antes de hacer cambios:

- CLAUDE.md
- specs/PRD.md
- specs/ARCHITECTURE.md
- specs/DATA_MODEL.md
- FUNCIONALIDADES.md
- package.json
- la implementacion actual de Dexie/IndexedDB
- la implementacion de perfiles
- la importacion CSV/XLSX
- el motor de reglas
- el dashboard
- backups y restauracion
- la configuracion PWA y service worker
- los tests existentes

No asumas que los documentos estan completamente actualizados. Contrasta siempre la documentacion con el codigo real.

Objetivo de esta sesion:

Preparar la arquitectura completa para añadir Supabase, autenticacion, sincronizacion local-first, PIN, passkeys, normalizacion de comercios, duplicados avanzados, bandeja de revision, recurrencias mejoradas, forecast y calculadora de deudas sin romper las funciones actuales.

Antes de editar archivos ejecuta:

1. git status --short
2. git branch --show-current
3. git log -5 --oneline

No descartes cambios existentes, no uses git reset --hard y no sobrescribas trabajo ajeno.

Actualiza o crea los siguientes documentos:

1. specs/PRD.md

Actualiza el PRD para incluir:

- cuenta de usuario autenticada;
- diferencia entre cuenta autenticada y perfil financiero;
- sincronizacion privada entre dispositivos;
- funcionamiento offline con IndexedDB;
- estados de sincronizacion;
- conflictos entre dispositivos;
- migracion de perfiles locales existentes;
- PIN local;
- passkeys y desbloqueo mediante el sistema del dispositivo;
- comercios normalizados;
- duplicados con niveles de confianza;
- bandeja de revision;
- conciliacion bancaria;
- recurrencias avanzadas;
- forecast por rango;
- modulo de deudas;
- escenarios Snowball y Avalanche;
- cambios en las promesas de privacidad, red y coste;
- criterios de aceptacion de cada nueva funcion;
- que queda expresamente fuera de alcance.

2. specs/ARCHITECTURE.md

Actualiza la arquitectura para describir:

- IndexedDB como base local operativa;
- Supabase como persistencia remota;
- Supabase Auth;
- Row Level Security;
- separacion entre UI, servicios, repositorios locales, repositorios remotos y motor de sincronizacion;
- cola de salida local;
- control de revisiones;
- borrado logico;
- resolucion de conflictos;
- sincronizacion por lotes;
- migracion inicial;
- comportamiento al iniciar sesion en otro dispositivo;
- almacenamiento de sesion;
- bloqueo local;
- passkeys;
- nuevas rutas y secciones;
- eventos que generan tareas de revision;
- funcionamiento offline;
- service worker;
- backups;
- auditoria y trazabilidad;
- uso del MCP oficial;
- protocolo migracion local, revision, aplicacion MCP, tipos y asesores;
- separacion entre autenticacion OAuth del MCP y credenciales runtime de la app;
- prohibicion de cambios remotos no reproducibles.

3. specs/DATA_MODEL.md

Actualiza el modelo completo, no solo una lista parcial. Debe incluir:

- usuario autenticado;
- perfiles financieros con ownerUserId;
- campos de sincronizacion en entidades;
- revisiones y borrado logico;
- cola local de mutaciones;
- conflictos;
- migraciones;
- comercios;
- alias de comercios;
- asociacion comercio-movimiento;
- metadatos bancarios;
- hashes y huellas de importacion;
- decisiones de no duplicado;
- tareas de revision;
- conciliaciones;
- series recurrentes;
- ocurrencias recurrentes;
- deudas;
- pagos de deuda;
- escenarios de deuda;
- amortizaciones extraordinarias;
- versionado de algoritmos;
- indices locales y remotos;
- relaciones;
- restricciones;
- aislamiento por usuario y profileId.

Todos los importes deben seguir en centimos enteros. Los tipos de interes deben usar una representacion entera documentada, por ejemplo puntos basicos o una precision fija superior.

4. specs/CLOUD_SYNC_SECURITY.md

Crea este documento con:

- arquitectura local-first;
- limites de responsabilidad entre Dexie y Supabase;
- modelo de autenticacion;
- modelo de autorizacion;
- RLS;
- politica de secretos;
- variables de entorno;
- sincronizacion;
- idempotencia;
- conflictos;
- migracion;
- PIN;
- cifrado de sesion;
- passkeys;
- limitaciones de navegadores;
- amenazas principales;
- mitigaciones;
- que no protege la app;
- procedimiento de recuperacion;
- permisos y superficie de ataque del MCP;
- riesgos de account, functions, branching y storage;
- prohibicion de usar esos grupos fuera de una fase que lo pida;
- comprobacion de deriva entre migraciones locales y remotas.

5. specs/FINANCIAL_ALGORITHMS.md

Crea o actualiza este documento con:

- invariantes monetarios;
- redondeos;
- duplicados y niveles de confianza;
- conciliacion;
- recurrencias;
- forecast;
- prestamos;
- amortizacion;
- Snowball;
- Avalanche;
- casos limite;
- fixtures de control;
- criterios para auditoria financiera.

6. specs/IMPLEMENTATION_ROADMAP.md

Documenta exactamente las fases de este archivo y sus dependencias. Incluye migraciones de datos, riesgos, rollback razonable y criterios para no avanzar de fase.

7. CLAUDE.md

Añade como invariantes permanentes:

- no usar floats para importes;
- no usar service_role en frontend;
- toda tabla remota expuesta lleva RLS;
- ninguna query puede confiar solo en filtros de UI;
- profileId y propietario deben verificarse en todas las capas;
- IndexedDB sigue siendo la base operativa offline;
- toda mutacion remota debe ser idempotente;
- ningun conflicto financiero se resuelve silenciosamente;
- no se pierde el concepto bancario original;
- no se guardan PIN, contraseñas, tokens o biometria en texto plano;
- no se afirma privacidad total;
- no se afirma coste cero perpetuo;
- no se hace push si hay tests fallando o hallazgos criticos abiertos;
- todo DDL remoto tiene una migracion versionada equivalente;
- despues de migrar se ejecutan asesores y se regeneran tipos;
- Git y Supabase deben quedar sincronizados antes del commit;
- no se usan account, functions, branching o storage salvo instruccion expresa.

8. FUNCIONALIDADES.md

Actualiza el documento para que describa la arquitectura objetivo y retire o matice afirmaciones que dejen de ser ciertas, especialmente:

- "sin backend";
- "ningun dato sale del dispositivo";
- "sin red en runtime";
- "coste 0 euros garantizado para siempre";
- "privacidad total".

La redaccion debe explicar correctamente que:

- la app funciona offline con una copia local;
- el usuario puede activar una cuenta privada para sincronizar;
- los datos sincronizados se almacenan en Supabase;
- RLS y autenticacion protegen el acceso;
- la disponibilidad y limites remotos dependen del proveedor;
- los archivos bancarios originales no se suben por defecto;
- la biometria, cuando se use, la gestiona el sistema operativo y no la app.

No implementes codigo funcional en esta sesion, salvo ajustes minimos necesarios para que los documentos reflejen rutas reales. Se critico y corrige decisiones que sean inseguras o financieramente incorrectas.

Al terminar:

1. Relee todos los documentos.
2. Comprueba que no se contradicen.
3. Muestra un resumen de decisiones.
4. Muestra las migraciones previstas.
5. Muestra los riesgos abiertos.
6. Explica como se usara MCP en cada fase.
7. Confirma que no has realizado escrituras remotas.
8. No hagas commit todavia.
```

## CIERRE COMPLETO DE LA SESION A

Cuando termine el prompt principal, envia estos mensajes UNO POR UNO:

### Mensaje A1

```text
/review-critico
```

### Mensaje A2

```text
Usa el subagente privacy-auditor para auditar todos los cambios documentales de esta sesion, especialmente autenticacion, RLS, sincronizacion, PIN, passkeys, almacenamiento de sesion, backups, redaccion de privacidad, permisos MCP y riesgos de database, development, docs, account, debugging, functions, branching y storage.
```

### Mensaje A3

```text
Usa el subagente finance-auditor para auditar specs/DATA_MODEL.md y specs/FINANCIAL_ALGORITHMS.md, especialmente importes en centimos, duplicados, conciliacion, forecast, prestamos, amortizaciones, Snowball y Avalanche.
```

### Mensaje A4

```text
Corrige todos los hallazgos criticos y altos encontrados en esta sesion. Relee despues CLAUDE.md, specs/PRD.md, specs/ARCHITECTURE.md, specs/DATA_MODEL.md, specs/CLOUD_SYNC_SECURITY.md, specs/FINANCIAL_ALGORITHMS.md, specs/IMPLEMENTATION_ROADMAP.md y FUNCIONALIDADES.md para comprobar que no haya contradicciones.

Cuando todo este corregido:

1. Ejecuta git diff --check.
2. Ejecuta git status --short.
3. No incluyas secretos ni archivos .env reales.
4. Añade al staging solo los archivos de esta sesion.
5. Crea el commit:
   git commit -m "docs: plan de ampliacion cloud, seguridad y finanzas"
6. Ejecuta git push en la rama actual.
7. Si el push es rechazado, haz fetch y rebase de forma segura, sin force push, resuelve los conflictos, vuelve a revisar los documentos y repite el push.
8. Muestrame el hash del commit y confirma que el repositorio remoto ha quedado actualizado.
```

---

# FASE 1: SUPABASE, AUTENTICACION Y RLS

Escribe `/clear` y pega el siguiente prompt.

## PROMPT 1

```text
Implementa la fase 1: Supabase, autenticacion y seguridad RLS.

Lee antes de modificar:

- CLAUDE.md
- specs/PRD.md
- specs/ARCHITECTURE.md
- specs/DATA_MODEL.md
- specs/CLOUD_SYNC_SECURITY.md
- specs/IMPLEMENTATION_ROADMAP.md
- package.json
- la base Dexie actual
- los repositorios actuales
- el sistema de perfiles
- rutas, contextos y stores
- backups
- tests

Antes de editar ejecuta:

1. git status --short
2. git branch --show-current
3. git log -5 --oneline

No descartes cambios existentes. No uses git reset --hard, no uses push --force y no metas secretos en el repositorio.

Objetivo:

Integrar Supabase como persistencia remota privada y Supabase Auth como autenticacion de cuenta, sin eliminar IndexedDB ni implementar todavia la sincronizacion completa. Esta fase debe dejar preparados el esquema remoto, RLS, autenticacion, tipos y abstracciones.

Proyecto remoto:

- Project Reference ID: skwhlbwpnsdgmdsfozcr
- Servidor MCP: supabase
- Entorno de desarrollo sin datos reales
- Data API activada
- Exposicion automatica de tablas nuevas desactivada
- RLS automatico activado
- Feature groups MCP: database, development, docs, account, debugging, functions, branching y storage

Reglas MCP obligatorias:

1. Inspecciona primero tablas, funciones y migraciones remotas.
2. Crea todo cambio estructural primero en `supabase/migrations`.
3. No ejecutes DDL remoto sin migracion equivalente en Git.
4. Revisa SQL, restricciones, indices, grants y RLS.
5. Aplica mediante la herramienta MCP de migraciones o el flujo oficial equivalente.
6. No uses SQL ad hoc como sustituto de una migracion.
7. Usa MCP para obtener Project URL y Publishable Key.
8. Guarda los valores runtime en `.env.local`, que debe estar ignorado.
9. Usa `VITE_SUPABASE_PUBLISHABLE_KEY`.
10. No obtengas, uses ni almacenes Secret Keys o `service_role`.
11. Regenera tipos TypeScript despues de aplicar migraciones.
12. Ejecuta asesores de seguridad y rendimiento.
13. Prueba RLS con dos usuarios autenticados y uno anonimo cuando sea viable.
14. Lista las migraciones remotas y comparalas con Git.
15. No uses account, functions, branching o storage en esta fase.
16. No crees proyectos, ramas, buckets o Edge Functions.
17. No realices cambios manuales no reproducibles desde el Dashboard.

Alcance:

1. Dependencias y configuracion

- Instala el SDK oficial de Supabase usando npm.
- Usa el sistema de variables de entorno real del proyecto.
- Crea o actualiza `.env.example`.
- Incluye nombres como `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` si el proyecto usa Vite.
- No incluyas valores reales.
- Valida de forma clara cuando falta configuracion.
- No uses ni expongas service_role.
- Añade la configuracion necesaria de Supabase CLI solo si encaja con el proyecto.
- No obligues a tener Supabase funcionando para ejecutar tests unitarios locales.

2. Esquema remoto

Crea migraciones SQL versionadas para representar todas las entidades actuales y dejar preparados los campos de ampliacion definidos en specs/DATA_MODEL.md.

Incluye:

- perfiles financieros;
- cuentas;
- categorias;
- subcategorias;
- etiquetas;
- relaciones de etiquetas;
- movimientos;
- splits;
- transferencias;
- reembolsos;
- reglas;
- condiciones y acciones;
- presupuestos y metas;
- plantillas de importacion;
- lotes de importacion;
- metadatos de backup;
- campos de sincronizacion;
- owner_user_id;
- profile_id;
- created_at;
- updated_at;
- deleted_at cuando corresponda;
- revision o equivalente.

No crees todavia logica completa de sincronizacion, pero el esquema debe permitirla.

Usa:

- UUID;
- bigint para centimos;
- restricciones;
- claves foraneas;
- indices;
- borrados en cascada solo donde sean seguros;
- checks para estados y tipos.

3. Autenticacion

Implementa:

- registro con correo y contraseña;
- inicio de sesion;
- restauracion de sesion;
- cierre de sesion;
- recuperacion de contraseña;
- actualizacion de contraseña;
- estado de correo pendiente de verificar;
- manejo de errores;
- estados de carga;
- proteccion de rutas privadas;
- redireccion segura;
- pantalla de cuenta.

No implementes PIN ni passkeys en esta fase.

4. Cuenta autenticada frente a perfil financiero

Mantiene la diferencia:

- una cuenta autenticada de Supabase identifica a la persona;
- un perfil financiero organiza datos dentro de la app;
- una cuenta puede ser propietaria de varios perfiles;
- todos los perfiles remotos incluyen owner_user_id;
- no implementes perfiles compartidos entre cuentas salvo que ya existan de forma real.

5. Row Level Security

Activa RLS en todas las tablas financieras.

Crea politicas explicitas para SELECT, INSERT, UPDATE y DELETE.

Como la exposicion automatica de tablas esta desactivada:

- concede explicitamente solo los privilegios necesarios a `authenticated`;
- no concedas acceso financiero a `anon`;
- no dependas de default privileges;
- verifica el acceso desde `supabase-js`.

Garantiza que:

- un usuario solo lee perfiles propios;
- una entidad hija solo es accesible si el perfil pertenece al usuario;
- no puede insertarse una fila para otro propietario;
- no puede cambiarse el propietario;
- un usuario anonimo no lee datos;
- las funciones, RPC y vistas respetan la misma autorizacion;
- ninguna seguridad depende solo del frontend.

6. Capa de acceso

Crea o adapta una abstraccion para que la UI no dependa directamente de Dexie ni de Supabase.

Debe permitir:

- repositorio local;
- repositorio remoto;
- futuro repositorio sincronizado;
- consultas tipadas;
- errores de dominio;
- operaciones por perfil;
- pruebas aisladas.

No reescribas innecesariamente la logica actual. Reutiliza la capa existente si ya es adecuada.

7. Tipos

- Genera o define tipos TypeScript de Supabase de forma reproducible.
- Evita `any`.
- Documenta como regenerarlos.
- Mantiene los tipos de dominio separados de los tipos de transporte cuando sea necesario.

8. Interfaz

Añade pantallas y componentes para:

- iniciar sesion;
- crear cuenta;
- recuperar contraseña;
- actualizar contraseña;
- cerrar sesion;
- mostrar usuario autenticado;
- diferenciar sin sesion, sin configuracion y sin conexion.

Mantiene diseño, tema, accesibilidad y responsive.

9. Textos

Actualiza los textos visibles que todavia prometan:

- ausencia total de backend;
- que ningun dato puede salir del dispositivo;
- coste cero perpetuo;
- ausencia total de red.

No conviertas la sincronizacion en obligatoria si la arquitectura acordada permite modo local. Explica con precision el estado real.

10. Tests

Añade tests para:

- registro e inicio de sesion a nivel de servicios o adaptadores;
- restauracion de sesion;
- rutas protegidas;
- cierre;
- errores de configuracion;
- serializacion de centimos;
- aislamiento de usuario;
- aislamiento de perfil;
- politicas RLS mediante entorno local, pruebas SQL o una estrategia automatizada verificable;
- imposibilidad de cambiar propietario;
- mantenimiento de tests anteriores.

11. Documentacion

Actualiza:

- README;
- instrucciones de Supabase;
- variables de entorno;
- aplicacion de migraciones;
- generacion de tipos;
- configuracion de URLs de autenticacion;
- pasos manuales que deba realizar el propietario del proyecto.

Si no dispones de credenciales reales, deja todo preparado y documentado. La ausencia de secretos no justifica mocks permanentes ni saltarse la seguridad.

Al terminar la implementacion:

1. Ejecuta npm run test.
2. Ejecuta npx tsc --noEmit.
3. Ejecuta npm run lint si existe.
4. Ejecuta npm run build.
5. Ejecuta las pruebas de RLS disponibles.
6. Ejecuta mediante MCP los asesores de seguridad y rendimiento.
7. Lista las migraciones remotas y comparalas con `supabase/migrations`.
8. Regenera tipos TypeScript desde el remoto.
9. Corrige los fallos.
10. Muestra resultados y pasos manuales pendientes.
11. No hagas commit todavia.
```

## CIERRE COMPLETO DE LA FASE 1

### Mensaje 1.1

```text
/review-critico
```

### Mensaje 1.2

```text
Usa el subagente privacy-auditor para auditar toda la fase 1. Revisa autenticacion, recuperacion de contraseña, URLs de redireccion, variables de entorno, cliente Supabase, RLS, politicas por operacion, aislamiento entre usuarios, aislamiento entre perfiles, exposicion de datos, logs, errores y ausencia de service_role en frontend.
```

### Mensaje 1.3

```text
Corrige todos los hallazgos criticos y altos de /review-critico y privacy-auditor. Despues:

1. Ejecuta npm run test.
2. Ejecuta npx tsc --noEmit.
3. Ejecuta npm run lint si existe.
4. Ejecuta npm run build.
5. Repite las pruebas de RLS.
6. Ejecuta git diff --check.
7. Comprueba que no haya secretos, .env reales, tokens ni service_role.
8. Comprueba git status --short.
9. Añade al staging solo los archivos de esta fase.
10. Crea el commit:
    Antes de crear este commit:

- usa MCP para ejecutar los asesores de seguridad y rendimiento;
- lista las migraciones remotas y comparalas con `supabase/migrations`;
- regenera tipos TypeScript desde el remoto si hubo cambios de esquema;
- confirma que no existen cambios remotos sin migracion versionada;
- confirma que no se han creado ramas, buckets o Edge Functions fuera del alcance;
- confirma que `.mcp.json`, `.env.example` y los archivos del repositorio no contienen secretos.

git commit -m "feat: Supabase Auth, esquema remoto y RLS"
11. Ejecuta git push en la rama actual.
12. Si el push es rechazado, haz fetch y rebase seguro, sin force push, resuelve conflictos, repite tests y build, y vuelve a hacer push.
13. Muestrame el hash del commit, los resultados finales y confirma que el remoto esta actualizado.

No hagas commit ni push si queda un hallazgo critico, un test falla, el typecheck falla, la build falla o alguna tabla financiera expuesta carece de RLS.
```

---

# FASE 2: SINCRONIZACION LOCAL-FIRST Y MIGRACION DE DATOS

Escribe `/clear` y pega el siguiente prompt.

## PROMPT 2

```text
Implementa la fase 2: sincronizacion local-first entre IndexedDB y Supabase y migracion segura de perfiles locales.

Lee antes de modificar:

- CLAUDE.md
- specs/PRD.md
- specs/ARCHITECTURE.md
- specs/DATA_MODEL.md
- specs/CLOUD_SYNC_SECURITY.md
- specs/IMPLEMENTATION_ROADMAP.md
- migraciones Supabase
- repositorios locales y remotos
- autenticacion
- backups
- importaciones
- service worker
- tests

Comprueba que la fase anterior esta integrada:

1. git status --short
2. git branch --show-current
3. git log -5 --oneline

No elimines IndexedDB. No conviertas la app en online-only. No descartes cambios, no uses reset --hard y no uses push --force.

Objetivo:

Mantener IndexedDB como base operativa local y usar Supabase como copia remota sincronizada. Los usuarios deben poder trabajar sin conexion, migrar datos ya existentes y recuperar sus perfiles desde otro dispositivo.

Proyecto remoto y protocolo MCP de esta fase:

- Project Reference ID: skwhlbwpnsdgmdsfozcr
- Servidor MCP: supabase
- Entorno de desarrollo sin datos reales

1. Inspecciona el estado remoto antes de modificarlo.
2. Crea primero las migraciones en `supabase/migrations`.
3. Revisa SQL, restricciones, indices, grants y RLS.
4. Aplica exactamente esas migraciones mediante MCP.
5. No uses DDL ad hoc.
6. Regenera tipos TypeScript desde el remoto.
7. Ejecuta asesores de seguridad y rendimiento.
8. Lista migraciones remotas y comparalas con Git.
9. No uses account, functions, branching o storage salvo que esta fase lo pida.
10. No crees proyectos, ramas, buckets ni Edge Functions.
11. No muestres ni almacenes Secret Keys, `service_role`, contraseñas o tokens OAuth.

Alcance:

1. Cola local de mutaciones

Implementa una outbox persistente con campos equivalentes a:

- mutationId unico;
- userId;
- profileId;
- entityType;
- entityId;
- operation;
- payload;
- baseRevision;
- createdAt;
- attempts;
- lastAttemptAt;
- lastError;
- status.

Cada mutacion debe ser idempotente. Reenviar la misma mutacion no puede duplicar datos.

2. Campos de sincronizacion

Añade y migra cuando corresponda:

- createdAt;
- updatedAt;
- deletedAt;
- revision;
- syncStatus;
- lastSyncedAt.

Usa borrado logico para entidades sincronizables cuando el borrado fisico pueda provocar que reaparezcan.

3. Flujo de escritura

Las escrituras del usuario deben:

- validarse;
- guardarse localmente primero;
- generar una mutacion;
- actualizar la UI sin esperar a internet;
- sincronizar despues;
- mostrar error si la escritura local falla;
- no presentarse como sincronizadas hasta confirmacion remota.

4. Flujo de lectura

La app debe leer de IndexedDB para la experiencia normal.

Supabase se usa para:

- descargar cambios remotos;
- confirmar mutaciones;
- reconstruir un dispositivo;
- resolver conflictos.

Evita hacer una consulta remota por cada render o interaccion.

5. Sincronizacion

Activa sincronizacion:

- al iniciar sesion;
- al recuperar conexion;
- despues de una mutacion local;
- al volver la app al primer plano cuando sea razonable;
- mediante boton manual.

Procesa importaciones grandes por lotes.

Implementa:

- reintentos;
- espera progresiva;
- limites;
- cancelacion segura;
- reanudacion;
- progreso;
- errores explicables.

6. Conflictos

No sobrescribas silenciosamente.

Cuando la revision remota haya cambiado:

- crea un conflicto;
- conserva version local y remota;
- muestra entidad y diferencias;
- permite mantener local;
- permite mantener remota;
- permite combinar solo donde sea seguro;
- no fusiones movimientos financieros campo a campo automaticamente;
- registra la resolucion;
- hazla idempotente.

7. Migracion de perfiles locales

Al iniciar sesion y detectar datos locales no vinculados:

- ofrece asistente de migracion;
- muestra perfiles;
- muestra recuentos de cuentas, movimientos, categorias, reglas, presupuestos, plantillas y lotes;
- permite elegir;
- ofrece generar backup antes;
- conserva UUID;
- asigna ownerUserId;
- respeta dependencias;
- sube por lotes;
- valida recuentos;
- valida relaciones;
- permite reanudar;
- evita duplicar si se repite;
- no borra datos locales;
- solo marca como migrado tras verificar.

8. Nuevo dispositivo

Al iniciar sesion sin datos locales:

- detecta perfiles remotos;
- descarga;
- reconstruye IndexedDB;
- muestra progreso;
- no muestra dashboard vacio mientras carga;
- valida esquema y relaciones;
- permite reintentar;
- conserva funcionamiento offline despues.

9. Importaciones

Una importacion debe:

- guardarse localmente de forma atomica;
- generar un lote;
- producir mutaciones remotas agrupadas;
- reanudarse;
- no duplicarse;
- poder deshacerse;
- sincronizar el deshacer;
- mostrar progreso.

No subas el archivo bancario original por defecto. Sincroniza los datos procesados y hashes necesarios.

10. Estado de UI

Muestra estados:

- sincronizado;
- cambios pendientes;
- sincronizando;
- sin conexion;
- conflicto;
- error.

Añade una pantalla o panel de sincronizacion con:

- ultima sincronizacion;
- mutaciones pendientes;
- conflictos;
- errores;
- reintentar;
- detalles sin exponer secretos.

11. Backups

Actualiza backup y restauracion para incluir:

- version de esquema;
- campos de sincronizacion;
- nuevas entidades;
- exclusión de tokens, contraseñas, PIN y secretos;
- restauracion idempotente;
- validacion;
- generacion de mutaciones sin duplicar.

12. Seguridad

- No desactives RLS.
- No uses service_role.
- No registres datos financieros completos.
- No sincronices otro profileId.
- No permitas sincronizar si no se conoce el propietario.
- No caches respuestas financieras remotas en el service worker.
- La sincronizacion debe respetar cierre de sesion.

13. Tests

Incluye:

- crear offline y sincronizar;
- editar offline;
- borrar offline;
- conexion interrumpida;
- reintento;
- idempotencia;
- importacion grande;
- dos dispositivos;
- conflicto;
- resolucion;
- migracion interrumpida;
- reanudacion;
- dispositivo vacio;
- logout;
- restauracion;
- aislamiento entre usuarios;
- aislamiento entre perfiles;
- miles de movimientos;
- migracion desde esquema anterior.

Al terminar:

1. Ejecuta npm run test.
2. Ejecuta npx tsc --noEmit.
3. Ejecuta npm run lint si existe.
4. Ejecuta npm run build.
5. Ejecuta pruebas de sincronizacion con red simulada.
6. Corrige fallos.
7. No hagas commit todavia.
```

## CIERRE COMPLETO DE LA FASE 2

### Mensaje 2.1

```text
/review-critico
```

### Mensaje 2.2

```text
Usa el subagente privacy-auditor para auditar la fase 2. Revisa la cola local, payloads, logs, RLS, aislamiento, borrado logico, logout, restauracion, archivos bancarios, service worker, conflictos y datos que permanecen en el dispositivo.
```

### Mensaje 2.3

```text
Usa el subagente finance-auditor para auditar la integridad financiera de la sincronizacion y migracion. Comprueba que no se pierdan, dupliquen, mezclen ni sobrescriban movimientos, splits, transferencias, reembolsos, presupuestos, reglas, lotes ni centimos durante reintentos, conflictos, restauraciones y migraciones.
```

### Mensaje 2.4

```text
Corrige todos los hallazgos criticos y altos. Despues:

1. Ejecuta npm run test.
2. Ejecuta npx tsc --noEmit.
3. Ejecuta npm run lint si existe.
4. Ejecuta npm run build.
5. Repite pruebas offline, reintentos, idempotencia, migracion y conflictos.
6. Ejecuta git diff --check.
7. Revisa que backups no contengan sesiones ni secretos.
8. Revisa git status --short.
9. Añade al staging solo los archivos de esta fase.
10. Crea el commit:
    Antes de crear este commit:

- usa MCP para ejecutar los asesores de seguridad y rendimiento;
- lista las migraciones remotas y comparalas con `supabase/migrations`;
- regenera tipos TypeScript desde el remoto si hubo cambios de esquema;
- confirma que no existen cambios remotos sin migracion versionada;
- confirma que no se han creado ramas, buckets o Edge Functions fuera del alcance;
- confirma que `.mcp.json`, `.env.example` y los archivos del repositorio no contienen secretos.

git commit -m "feat: sincronizacion local-first y migracion a Supabase"
11. Ejecuta git push.
12. Si el push falla por cambios remotos, haz fetch y rebase seguro, resuelve conflictos sin perder trabajo, repite tests y build y vuelve a hacer push.
13. Muestrame el hash y confirma que el remoto esta actualizado.

No hagas commit ni push si hay riesgo conocido de perdida o duplicacion silenciosa de datos.
```

---

# FASE 3: PIN, BLOQUEO Y PASSKEYS

Escribe `/clear` y pega el siguiente prompt.

## PROMPT 3

```text
Implementa la fase 3: privacidad de acceso, PIN local, bloqueo automatico y passkeys.

Lee:

- CLAUDE.md
- specs/CLOUD_SYNC_SECURITY.md
- specs/ARCHITECTURE.md
- specs/DATA_MODEL.md
- autenticacion Supabase
- almacenamiento de sesion
- sincronizacion
- PWA
- service worker
- ajustes y navegacion
- tests

Antes de editar:

1. git status --short
2. git branch --show-current
3. git log -5 --oneline

No descartes cambios. No uses reset --hard ni push --force.

Objetivo:

Añadir una proteccion real de acceso al dispositivo sin confundir:

- contraseña de cuenta;
- PIN local;
- passkey;
- biometria.

La app no debe almacenar huellas, rostro ni datos biometricos. La verificacion la realiza el sistema operativo o el autenticador mediante WebAuthn.

Proyecto remoto y protocolo MCP de esta fase:

- Project Reference ID: skwhlbwpnsdgmdsfozcr
- Servidor MCP: supabase
- Entorno de desarrollo sin datos reales

1. Inspecciona el estado remoto antes de modificarlo.
2. Crea primero las migraciones en `supabase/migrations`.
3. Revisa SQL, restricciones, indices, grants y RLS.
4. Aplica exactamente esas migraciones mediante MCP.
5. No uses DDL ad hoc.
6. Regenera tipos TypeScript desde el remoto.
7. Ejecuta asesores de seguridad y rendimiento.
8. Lista migraciones remotas y comparalas con Git.
9. No uses account, functions, branching o storage salvo que esta fase lo pida.
10. No crees proyectos, ramas, buckets ni Edge Functions.
11. No muestres ni almacenes Secret Keys, `service_role`, contraseñas o tokens OAuth.

12. Usa MCP y docs para comprobar las capacidades reales de Auth y passkeys.
13. No cambies Auth de forma no documentada.
14. No crees un servidor WebAuthn propio.
15. Documenta la configuracion manual pendiente en Dashboard.

Alcance:

1. Contraseña de cuenta

Completa:

- cambio de contraseña;
- recuperacion;
- reautenticacion para acciones sensibles;
- cierre de sesion;
- cierre de otras sesiones si el SDK lo soporta de forma oficial;
- errores que no revelen innecesariamente si una cuenta existe.

2. PIN local

Implementa:

- activacion opcional;
- minimo 6 digitos;
- confirmacion;
- cambio;
- desactivacion;
- bloqueo manual;
- bloqueo automatico configurable:
  - inmediato;
  - 1 minuto;
  - 5 minutos;
  - 15 minutos;
  - 30 minutos;
- bloqueo al volver del segundo plano;
- contador de intentos;
- espera progresiva;
- recuperacion mediante autenticacion de cuenta;
- cierre de sesion desde pantalla bloqueada.

3. Almacenamiento del PIN

- No guardes PIN en texto plano.
- No uses hash rapido sin sal.
- Usa Web Crypto.
- Usa sal aleatoria.
- Usa derivacion robusta disponible en navegador.
- Versiona parametros.
- Documenta iteraciones.
- No registres PIN.
- No lo envies a Supabase.

4. Proteccion de sesion

No hagas un simple overlay.

Cuando PIN este activo:

- cifra la sesion persistida con AES-GCM o mecanismo equivalente seguro;
- deriva la clave del PIN;
- conserva la clave solo en memoria mientras esta desbloqueada;
- elimina la clave de memoria al bloquear;
- no dejes una copia de la sesion sin cifrar en otro storage;
- no sincronices en segundo plano mientras este bloqueada;
- elimina datos de sesion al cerrar;
- trata errores de descifrado.

Adapta el storage de Supabase Auth si es necesario.

5. Pantalla bloqueada

- No muestres cifras.
- No muestres dashboard detras.
- No uses overlay transparente.
- Permite PIN.
- Permite passkey si esta disponible.
- Permite cerrar sesion.
- Permite recuperacion segura.
- Es accesible con teclado y lector de pantalla.

6. Passkeys y biometria

Comprueba la API real disponible en la version instalada de Supabase.

No inventes funciones del SDK.

Implementa passkeys solo con APIs oficiales y WebAuthn:

- deteccion de `PublicKeyCredential`;
- deteccion de autenticador de plataforma cuando sea posible;
- registro de passkey desde sesion autenticada;
- nombre de dispositivo;
- listado;
- eliminacion;
- inicio o desbloqueo;
- cancelacion;
- credencial no reconocida;
- fallback por contraseña;
- impedir quedarse sin metodo valido de acceso.

Usa una feature flag como `VITE_ENABLE_PASSKEYS`.

Si la integracion oficial sigue siendo experimental:

- dejala desactivada por defecto;
- documenta el riesgo;
- no la presentes como universal;
- conserva contraseña y PIN;
- no construyas un servidor WebAuthn casero.

La interfaz debe usar "passkey" cuando el sistema pueda solicitar biometria, PIN del dispositivo o llave fisica. Solo usa "biometria" cuando se haya detectado un autenticador de plataforma compatible y aun asi explica que la app no recibe los datos biometricos.

7. Ajustes de seguridad

Muestra:

- correo;
- verificacion;
- contraseña;
- PIN;
- bloqueo automatico;
- passkeys;
- sesiones o dispositivos si es posible;
- explicacion de cada capa;
- advertencias de recuperacion.

8. Offline

- PIN debe desbloquear localmente sin internet cuando ya exista sesion valida cifrada.
- No permitas acciones remotas que requieran reautenticacion si no hay red.
- Informa con claridad.
- La app debe seguir mostrando datos locales tras desbloquear.

9. Backup

No incluyas:

- PIN;
- hash de PIN si no es imprescindible;
- claves;
- tokens;
- credenciales WebAuthn;
- sesiones.

10. Tests

Incluye:

- activar PIN;
- PIN correcto;
- PIN incorrecto;
- espera progresiva;
- bloqueo manual;
- bloqueo automatico;
- background;
- sesion cifrada;
- sesion no legible sin desbloqueo;
- no existe copia sin cifrar;
- recuperacion;
- logout;
- WebAuthn no disponible;
- autenticador no disponible;
- registro de passkey;
- cancelacion;
- eliminacion;
- fallback;
- offline;
- sincronizacion detenida mientras bloqueada;
- accesibilidad.

Al terminar:

1. Ejecuta npm run test.
2. Ejecuta npx tsc --noEmit.
3. Ejecuta npm run lint si existe.
4. Ejecuta npm run build.
5. Comprueba storages del navegador en tests o entorno local.
6. No hagas commit todavia.
```

## CIERRE COMPLETO DE LA FASE 3

### Mensaje 3.1

```text
/review-critico
```

### Mensaje 3.2

```text
Usa el subagente privacy-auditor para auditar la fase 3 completa. Busca bypasses del bloqueo, sesiones duplicadas sin cifrar, PIN debil, logs, almacenamiento inseguro, recuperacion insegura, passkeys mal implementadas, biometria mal descrita, service worker, funcionamiento offline y limpieza al cerrar sesion.
```

### Mensaje 3.3

```text
/review-ux pantalla de login, registro, recuperacion, ajustes de seguridad, pantalla bloqueada, configuracion de PIN y gestion de passkeys
```

### Mensaje 3.4

```text
Corrige todos los hallazgos criticos y altos de seguridad, privacidad y UX. Despues:

1. Ejecuta npm run test.
2. Ejecuta npx tsc --noEmit.
3. Ejecuta npm run lint si existe.
4. Ejecuta npm run build.
5. Comprueba que no haya sesion sin cifrar duplicada.
6. Comprueba que la app funciona con passkeys desactivadas.
7. Comprueba que funciona sin WebAuthn.
8. Comprueba offline con PIN.
9. Ejecuta git diff --check.
10. Revisa git status --short.
11. Añade al staging solo los archivos de esta fase.
12. Crea el commit:
    Antes de crear este commit:

- usa MCP para ejecutar los asesores de seguridad y rendimiento;
- lista las migraciones remotas y comparalas con `supabase/migrations`;
- regenera tipos TypeScript desde el remoto si hubo cambios de esquema;
- confirma que no existen cambios remotos sin migracion versionada;
- confirma que no se han creado ramas, buckets o Edge Functions fuera del alcance;
- confirma que `.mcp.json`, `.env.example` y los archivos del repositorio no contienen secretos.

git commit -m "feat: PIN, bloqueo seguro y acceso con passkeys"
13. Ejecuta git push.
14. Si hay rechazo remoto, haz rebase seguro, repite tests y build y vuelve a hacer push.
15. Muestrame hash, pruebas y confirmacion del remoto.

No hagas commit si existe un bypass conocido, una copia de sesion sin cifrar o dependencia obligatoria de passkeys.
```

---

# FASE 4: NORMALIZACION DE COMERCIOS Y CONCEPTOS

Escribe `/clear` y pega el siguiente prompt.

## PROMPT 4

```text
Implementa la fase 4: comercios normalizados, alias y normalizacion de conceptos.

Lee:

- CLAUDE.md
- specs/PRD.md
- specs/ARCHITECTURE.md
- specs/DATA_MODEL.md
- specs/FINANCIAL_ALGORITHMS.md
- repositorios
- sincronizacion
- movimientos
- reglas
- importacion
- dashboard
- exportaciones
- backup
- tests

Antes de editar:

1. git status --short
2. git branch --show-current
3. git log -5 --oneline

No descartes cambios.

Objetivo:

Reconocer que conceptos bancarios distintos pueden corresponder al mismo comercio sin perder el texto original.

Proyecto remoto y protocolo MCP de esta fase:

- Project Reference ID: skwhlbwpnsdgmdsfozcr
- Servidor MCP: supabase
- Entorno de desarrollo sin datos reales

1. Inspecciona el estado remoto antes de modificarlo.
2. Crea primero las migraciones en `supabase/migrations`.
3. Revisa SQL, restricciones, indices, grants y RLS.
4. Aplica exactamente esas migraciones mediante MCP.
5. No uses DDL ad hoc.
6. Regenera tipos TypeScript desde el remoto.
7. Ejecuta asesores de seguridad y rendimiento.
8. Lista migraciones remotas y comparalas con Git.
9. No uses account, functions, branching o storage salvo que esta fase lo pida.
10. No crees proyectos, ramas, buckets ni Edge Functions.
11. No muestres ni almacenes Secret Keys, `service_role`, contraseñas o tokens OAuth.

Ejemplos:

- AMZN Mktp ES
- AMAZON EU
- Amazon.es*1234

Deben poder asociarse a Amazon.

Alcance:

1. Entidades

Implementa entidades equivalentes a:

Merchant:

- id;
- profileId;
- canonicalName;
- normalizedName;
- defaultCategoryId opcional;
- defaultSubcategoryId opcional;
- defaultTagIds;
- notes;
- archivedAt;
- createdAt;
- updatedAt;
- campos de sincronizacion.

MerchantAlias:

- id;
- merchantId;
- profileId;
- rawAlias;
- normalizedAlias;
- matchType:
  - exact;
  - contains;
  - startsWith;
  - regex;
- priority;
- enabled;
- campos de sincronizacion.

Movimiento:

- rawConcept inmutable respecto a importacion;
- normalizedConcept;
- normalizationVersion;
- merchantId;
- merchantMatchSource:
  - manual;
  - alias;
  - rule;
  - import;
  - suggested;
  - none;
- merchantMatchConfidence.

Adapta los nombres al modelo real, pero conserva la semantica.

2. Normalizacion

Crea una funcion pura, central, versionada y testeada que:

- normalice Unicode;
- compare sin diacriticos;
- normalice mayusculas;
- normalice espacios;
- normalice signos;
- elimine referencias variables solo cuando sea seguro;
- no borre numeros indiscriminadamente;
- conserve rawConcept;
- produzca siempre el mismo resultado.

3. Motor de asociacion

Usa este orden:

1. asociacion manual;
2. identificador de comercio del banco;
3. alias exacto;
4. alias configurable;
5. regla;
6. sugerencia por similitud;
7. sin comercio.

No conviertas sugerencias de confianza baja en asociaciones definitivas.

4. UI de comercios

Implementa:

- listado;
- busqueda;
- crear;
- editar;
- archivar;
- aliases;
- activar y desactivar alias;
- ver movimientos;
- reasignar;
- fusionar comercios;
- deshacer cuando sea posible.

La fusion debe:

- mostrar recuentos;
- mover alias;
- mover movimientos;
- resolver defaults;
- ser transaccional;
- no dejar huerfanos;
- sincronizarse;
- poder reintentarse sin duplicar.

5. Integraciones

Usa merchant en:

- filtros;
- busqueda;
- reglas;
- importacion;
- rankings;
- exportaciones;
- backup;
- futura recurrencia;
- futuro motor de duplicados.

No sustituyas el concepto original sin permitir verlo.

6. Migracion

Para movimientos existentes:

- calcula normalizedConcept;
- genera candidatos de comercio;
- procesa por lotes;
- permite reanudar;
- no fusiona similitud debil;
- permite revisar agrupaciones;
- conserva todos los conceptos originales;
- registra version.

7. Supabase y offline

- Añade migraciones.
- Añade RLS.
- Añade indices.
- Integra con outbox.
- Funciona offline.
- Sincroniza.
- Incluye backup y restauracion.

8. Tests

Incluye:

- tildes;
- mayusculas;
- simbolos;
- espacios;
- referencias variables;
- numeros significativos;
- alias exacto;
- alias contains;
- startsWith;
- regex invalida;
- prioridades;
- manual prevalece;
- fusion;
- rollback;
- migracion;
- sincronizacion;
- aislamiento por perfil;
- rawConcept intacto.

Al terminar:

1. Ejecuta npm run test.
2. Ejecuta npx tsc --noEmit.
3. Ejecuta npm run lint si existe.
4. Ejecuta npm run build.
5. No hagas commit todavia.
```

## CIERRE COMPLETO DE LA FASE 4

### Mensaje 4.1

```text
/review-critico
```

### Mensaje 4.2

```text
Usa el subagente privacy-auditor para auditar la fase 4. Revisa aislamiento de comercios y alias, RLS, sincronizacion, exportaciones, backups, regex y posibles exposiciones de conceptos bancarios.
```

### Mensaje 4.3

```text
/review-ux seccion Comercios, gestion de alias, fusion, reasignacion y revision de sugerencias
```

### Mensaje 4.4

```text
Corrige los hallazgos criticos y altos. Despues:

1. Ejecuta tests, typecheck, lint si existe y build.
2. Prueba migracion con movimientos existentes.
3. Comprueba rawConcept.
4. Comprueba fusión y rollback.
5. Comprueba aislamiento.
6. Ejecuta git diff --check.
7. Revisa git status --short.
8. Añade solo archivos de fase.
9. Crea el commit:
   Antes de crear este commit:

- usa MCP para ejecutar los asesores de seguridad y rendimiento;
- lista las migraciones remotas y comparalas con `supabase/migrations`;
- regenera tipos TypeScript desde el remoto si hubo cambios de esquema;
- confirma que no existen cambios remotos sin migracion versionada;
- confirma que no se han creado ramas, buckets o Edge Functions fuera del alcance;
- confirma que `.mcp.json`, `.env.example` y los archivos del repositorio no contienen secretos.

git commit -m "feat: comercios normalizados y alias de conceptos"
10. Ejecuta git push.
11. Si hay rechazo, haz rebase seguro, repite validaciones y push.
12. Muestrame hash y confirmacion del remoto.
```

---

# FASE 5: DETECCION AVANZADA DE DUPLICADOS

Escribe `/clear` y pega el siguiente prompt.

## PROMPT 5

```text
Implementa la fase 5: deteccion avanzada y explicable de duplicados.

Lee:

- CLAUDE.md
- specs/DATA_MODEL.md
- specs/FINANCIAL_ALGORITHMS.md
- importacion
- lotes
- movimientos
- comercios
- sincronizacion
- backups
- tests

Antes de editar ejecuta git status --short, git branch --show-current y git log -5 --oneline.

No descartes cambios.

Objetivo:

Sustituir el criterio binario por un motor multinivel con hashes, identificadores bancarios, comercios normalizados, ventanas de fecha, relacion pendiente-confirmado y confianza explicable.

Proyecto remoto y protocolo MCP de esta fase:

- Project Reference ID: skwhlbwpnsdgmdsfozcr
- Servidor MCP: supabase
- Entorno de desarrollo sin datos reales

1. Inspecciona el estado remoto antes de modificarlo.
2. Crea primero las migraciones en `supabase/migrations`.
3. Revisa SQL, restricciones, indices, grants y RLS.
4. Aplica exactamente esas migraciones mediante MCP.
5. No uses DDL ad hoc.
6. Regenera tipos TypeScript desde el remoto.
7. Ejecuta asesores de seguridad y rendimiento.
8. Lista migraciones remotas y comparalas con Git.
9. No uses account, functions, branching o storage salvo que esta fase lo pida.
10. No crees proyectos, ramas, buckets ni Edge Functions.
11. No muestres ni almacenes Secret Keys, `service_role`, contraseñas o tokens OAuth.

12. No almacenes archivos bancarios originales en Storage.
13. Protege hashes y decisiones mediante RLS.

Alcance:

1. Campos opcionales de importacion

Amplia el mapeo para:

- bankTransactionId;
- fecha contable;
- fecha valor;
- pendiente o confirmado;
- comercio;
- moneda;
- saldo posterior;
- referencia bancaria;
- tipo de operacion.

2. Metadatos

Añade:

- bankTransactionId;
- sourceRowHash;
- exactFingerprint;
- normalizedFingerprint;
- fingerprintVersion;
- sourceFileHash;
- sourceFileSize;
- importBatchId;
- duplicateStatus;
- duplicateConfidence;
- duplicateReasonCodes;
- duplicateCandidateIds;
- pendingReplacementId o relacion equivalente;
- decision de no duplicado.

3. Hashes

Calcula localmente:

- hash del archivo;
- hash exacto de fila;
- huella normalizada;
- version de algoritmos.

El mismo archivo con otro nombre debe detectarse.

No subas el archivo original para calcular hashes.

4. Generacion de candidatos

Limita por:

- profileId;
- cuenta;
- moneda;
- importe;
- ventana temporal;
- comercio cuando exista.

No compares todo contra todo.

5. Niveles

Implementa:

- coincidencia exacta;
- coincidencia normalizada fuerte;
- posible duplicado;
- coincidencia debil;
- pendiente convertido en confirmado.

6. Puntuacion

Crea funcion pura, determinista y versionada.

Muestra:

- nivel;
- confianza orientativa;
- razones;
- diferencias;
- candidato;
- acciones.

No presentes la confianza heuristica como probabilidad real.

7. Pendiente-confirmado

Cuando aparece confirmado compatible:

- propone sustituir;
- conserva trazabilidad;
- no duplica saldo;
- no borra sin confirmacion;
- permite vincular;
- permite descartar.

8. Decisiones

Permite:

- omitir;
- importar;
- sustituir pendiente;
- vincular;
- marcar no duplicado;
- aplicar decision a equivalentes;
- deshacer.

La decision no duplicado debe impedir que la misma pareja reaparezca sin cambios relevantes.

9. Archivo repetido

Antes de confirmar:

- muestra lote anterior;
- fecha;
- cuenta;
- filas;
- permite cancelar;
- permite continuar explicitamente;
- evita doble clic;
- evita lote duplicado tras reintento.

10. Rendimiento

- indices;
- lotes;
- progreso;
- lista virtualizada;
- worker si es necesario;
- interfaz no bloqueada.

11. Sincronizacion

- hashes sincronizados;
- decisiones sincronizadas;
- idempotencia;
- restricciones solo para identificadores fiables;
- nunca unique sobre huella normalizada general.

12. API para bandeja

Expone candidatos, confianza, razones y acciones para la siguiente fase.

13. Tests

Incluye:

- mismo archivo otro nombre;
- misma fila;
- fecha valor distinta;
- referencia variable;
- dos compras reales iguales;
- pendiente-confirmado;
- identificador bancario;
- importacion interrumpida;
- reintento;
- multiples candidatos;
- no duplicado;
- aislamiento;
- offline;
- sincronizacion;
- rendimiento con miles.

Al terminar ejecuta test, typecheck, lint si existe y build. No hagas commit.
```

## CIERRE COMPLETO DE LA FASE 5

### Mensaje 5.1

```text
/review-critico
```

### Mensaje 5.2

```text
Usa el subagente privacy-auditor para auditar hashes, archivos, conceptos, logs, sincronizacion, RLS y aislamiento de la fase 5.
```

### Mensaje 5.3

```text
Usa el subagente finance-auditor para auditar el motor de duplicados. Comprueba falsos positivos, falsos negativos, saldos, pending-confirmed, reintentos, lotes, deshacer e imposibilidad de borrar o duplicar dinero silenciosamente.
```

### Mensaje 5.4

```text
Corrige todos los hallazgos criticos y altos. Despues:

1. Ejecuta tests, typecheck, lint si existe y build.
2. Prueba los fixtures de duplicados.
3. Prueba archivo repetido.
4. Prueba dos compras iguales legitimas.
5. Prueba pendiente-confirmado.
6. Ejecuta git diff --check.
7. Revisa git status.
8. Añade solo archivos de fase.
9. Crea el commit:
   Antes de crear este commit:

- usa MCP para ejecutar los asesores de seguridad y rendimiento;
- lista las migraciones remotas y comparalas con `supabase/migrations`;
- regenera tipos TypeScript desde el remoto si hubo cambios de esquema;
- confirma que no existen cambios remotos sin migracion versionada;
- confirma que no se han creado ramas, buckets o Edge Functions fuera del alcance;
- confirma que `.mcp.json`, `.env.example` y los archivos del repositorio no contienen secretos.

git commit -m "feat: deteccion avanzada de duplicados"
10. Ejecuta git push.
11. Si hay rechazo, rebase seguro, repite validaciones y push.
12. Muestrame hash y confirma remoto actualizado.

No hagas commit si el sistema elimina o sustituye movimientos sin confirmacion.
```

---

# FASE 6: BANDEJA DE REVISION Y CONCILIACION

Escribe `/clear` y pega el siguiente prompt.

## PROMPT 6

```text
Implementa la fase 6: bandeja unificada de revision y flujo de conciliacion.

Lee:

- CLAUDE.md
- specs/PRD.md
- specs/ARCHITECTURE.md
- specs/DATA_MODEL.md
- specs/FINANCIAL_ALGORITHMS.md
- importacion
- duplicados
- comercios
- reglas
- transferencias
- reembolsos
- sincronizacion
- dashboard
- tests

Antes de editar ejecuta git status --short, git branch --show-current y git log -5 --oneline.

Objetivo:

Cambiar el flujo posterior a importar:

Importar -> Revisar excepciones -> Conciliar -> Ver resultados

Proyecto remoto y protocolo MCP de esta fase:

- Project Reference ID: skwhlbwpnsdgmdsfozcr
- Servidor MCP: supabase
- Entorno de desarrollo sin datos reales

1. Inspecciona el estado remoto antes de modificarlo.
2. Crea primero las migraciones en `supabase/migrations`.
3. Revisa SQL, restricciones, indices, grants y RLS.
4. Aplica exactamente esas migraciones mediante MCP.
5. No uses DDL ad hoc.
6. Regenera tipos TypeScript desde el remoto.
7. Ejecuta asesores de seguridad y rendimiento.
8. Lista migraciones remotas y comparalas con Git.
9. No uses account, functions, branching o storage salvo que esta fase lo pida.
10. No crees proyectos, ramas, buckets ni Edge Functions.
11. No muestres ni almacenes Secret Keys, `service_role`, contraseñas o tokens OAuth.

Alcance:

1. Tipos de revision

Incluye:

- sin categorizar;
- regla con baja confianza;
- posible duplicado;
- transferencia candidata;
- reembolso candidato;
- pendiente antiguo;
- comercio nuevo;
- error de importacion;
- conflicto de sincronizacion;
- anomalia recurrente cuando exista en fase posterior.

2. Modelo

Implementa ReviewItem con:

- id;
- profileId;
- type;
- entityType;
- entityId;
- confidence;
- reasonCodes;
- metadata minima;
- status:
  - open;
  - snoozed;
  - resolved;
  - dismissed;
- createdAt;
- resolvedAt;
- resolution;
- campos de sincronizacion.

No copies todo el movimiento dentro de ReviewItem.

3. Generacion

Genera o actualiza tareas:

- al importar;
- al ejecutar reglas;
- al sincronizar;
- al detectar duplicados;
- al detectar transferencias;
- al detectar reembolsos;
- al detectar comercio nuevo.

La generacion debe ser idempotente.

4. UI

Crea:

- contador total;
- contadores por tipo;
- filtros;
- busqueda;
- orden;
- seleccion multiple;
- acciones masivas;
- panel detalle;
- navegacion al movimiento;
- deshacer;
- estados vacios;
- responsive;
- accesibilidad.

Cada tarea explica que ocurre, por que y que cambia.

5. Acciones

Sin categorizar:

- categoria;
- subcategoria;
- etiquetas;
- crear regla;
- aplicar similares.

Regla baja confianza:

- aceptar;
- corregir;
- deshacer;
- editar regla;
- excepcion.

Duplicado:

- reutiliza el motor.

Transferencia:

- detectar mismo importe absoluto;
- signos opuestos;
- cuentas distintas;
- fechas proximas;
- vincular;
- descartar.

Reembolso:

- importes opuestos;
- mismo comercio;
- fecha posterior;
- vincular;
- descartar.

Pendiente antiguo:

- confirmar;
- conciliar;
- eliminar con confirmacion;
- buscar sustituto;
- aplazar.

Comercio nuevo:

- crear;
- vincular;
- alias;
- dejar sin comercio.

Error importacion:

- fila;
- campo;
- valor;
- motivo;
- corregir;
- reintentar.

6. Conciliacion

Implementa o integra:

- elegir cuenta;
- fecha de extracto;
- saldo final en centimos;
- saldo calculado;
- diferencia;
- revisar pendientes;
- revisar excluidos;
- guardar conciliacion;
- continuar sin cuadrar con constancia;
- historial de conciliaciones;
- aislamiento.

7. Resumen final

Muestra:

- filas;
- importados;
- omitidos;
- duplicados;
- categorizados;
- comercios;
- transferencias;
- reembolsos;
- errores;
- conciliacion;
- efecto en saldo;
- enlace a dashboard filtrado.

8. Navegacion

- acceso permanente;
- contador discreto;
- despues de importar va a bandeja si hay tareas;
- si no hay tareas puede ir a conciliacion o resumen.

9. Offline y sync

- funciona offline;
- resoluciones en outbox;
- conflictos explicitos;
- RLS;
- backup;
- no doble resolucion.

10. Tests

Incluye:

- idempotencia;
- resolver;
- reabrir;
- masivas;
- deshacer;
- duplicado;
- transferencia;
- reembolso;
- comercio;
- error;
- conciliacion correcta;
- diferencia;
- offline;
- sincronizacion;
- aislamiento;
- movil;
- teclado.

Al terminar ejecuta test, typecheck, lint si existe y build. No hagas commit.
```

## CIERRE COMPLETO DE LA FASE 6

### Mensaje 6.1

```text
/review-critico
```

### Mensaje 6.2

```text
Usa el subagente privacy-auditor para auditar ReviewItem, metadata, RLS, sincronizacion, errores de importacion, conflictos y aislamiento.
```

### Mensaje 6.3

```text
Usa el subagente finance-auditor para auditar conciliacion, transferencias, reembolsos, duplicados y resoluciones. Verifica que saldo, estadisticas y movimientos no se alteren dos veces.
```

### Mensaje 6.4

```text
/review-ux bandeja de revision, acciones masivas, conciliacion y resumen posterior a importar
```

### Mensaje 6.5

```text
Corrige todos los hallazgos criticos y altos. Despues:

1. Ejecuta tests, typecheck, lint y build.
2. Prueba un lote con errores, duplicados, transferencia y comercio nuevo.
3. Prueba conciliacion que cuadra.
4. Prueba conciliacion con diferencia.
5. Comprueba offline.
6. Ejecuta git diff --check.
7. Revisa git status.
8. Añade solo archivos de fase.
9. Crea:
   Antes de crear este commit:

- usa MCP para ejecutar los asesores de seguridad y rendimiento;
- lista las migraciones remotas y comparalas con `supabase/migrations`;
- regenera tipos TypeScript desde el remoto si hubo cambios de esquema;
- confirma que no existen cambios remotos sin migracion versionada;
- confirma que no se han creado ramas, buckets o Edge Functions fuera del alcance;
- confirma que `.mcp.json`, `.env.example` y los archivos del repositorio no contienen secretos.

git commit -m "feat: bandeja de revision y conciliacion bancaria"
10. Ejecuta git push.
11. Si falla, rebase seguro, repite validaciones y push.
12. Muestrame hash y confirma remoto actualizado.
```

---

# FASE 7: RECURRENCIAS Y FORECAST

Escribe `/clear` y pega el siguiente prompt.

## PROMPT 7

```text
Implementa la fase 7: gastos recurrentes avanzados y forecast de cierre por rango.

Lee:

- CLAUDE.md
- specs/DATA_MODEL.md
- specs/FINANCIAL_ALGORITHMS.md
- comercios;
- bandeja;
- dashboard;
- presupuestos;
- movimientos especiales;
- sincronizacion;
- tests.

Antes de editar ejecuta git status --short, git branch --show-current y git log -5 --oneline.

Objetivo:

Sustituir la deteccion basica y extrapolacion lineal por series recurrentes confirmables y forecast compuesto.

Proyecto remoto y protocolo MCP de esta fase:

- Project Reference ID: skwhlbwpnsdgmdsfozcr
- Servidor MCP: supabase
- Entorno de desarrollo sin datos reales

1. Inspecciona el estado remoto antes de modificarlo.
2. Crea primero las migraciones en `supabase/migrations`.
3. Revisa SQL, restricciones, indices, grants y RLS.
4. Aplica exactamente esas migraciones mediante MCP.
5. No uses DDL ad hoc.
6. Regenera tipos TypeScript desde el remoto.
7. Ejecuta asesores de seguridad y rendimiento.
8. Lista migraciones remotas y comparalas con Git.
9. No uses account, functions, branching o storage salvo que esta fase lo pida.
10. No crees proyectos, ramas, buckets ni Edge Functions.
11. No muestres ni almacenes Secret Keys, `service_role`, contraseñas o tokens OAuth.

Alcance:

1. Modelo

RecurringSeries:

- id;
- profileId;
- merchantId;
- name;
- direction;
- frequency:
  - weekly;
  - monthly;
  - quarterly;
  - yearly;
- interval;
- expectedAmountCents;
- amountToleranceCents;
- amountTolerancePercent con representacion controlada;
- expectedDayOfWeek;
- expectedDayOfMonth;
- dateToleranceDays;
- nextExpectedDate;
- status:
  - candidate;
  - active;
  - paused;
  - possiblyCancelled;
  - cancelled;
- confidence;
- detectionVersion;
- timestamps;
- sincronizacion.

RecurringOccurrence:

- id;
- seriesId;
- transactionId;
- expectedDate;
- expectedAmountCents;
- status:
  - expected;
  - matched;
  - missing;
  - skipped;
  - manuallyCompleted.

2. Deteccion

Usa:

- comercio;
- direccion;
- cuenta;
- categoria;
- fechas;
- importes;
- mediana;
- dispersion robusta.

Detecta semanas, meses, trimestres, años e intervalos.

No confirmes automaticamente sugerencias debiles.

3. Gestion

Permite:

- confirmar;
- editar;
- tolerancias;
- excluir;
- añadir;
- pausar;
- cancelar;
- omitir una ocurrencia;
- dividir;
- fusionar.

4. Proximos cobros

Muestra:

- fecha;
- importe;
- margen;
- cuenta;
- categoria;
- ultimo;
- variacion;
- estado.

5. Precio

Detecta subidas:

- diferencia absoluta;
- porcentaje;
- umbral;
- aceptar nuevo importe base;
- tarea de revision.

6. Ausencias

Genera tareas para:

- cobro esperado no recibido;
- ingreso esperado no recibido;
- posible cancelacion;
- subida;
- cobro duplicado.

No declares cancelacion por un unico retraso.

7. Forecast

Formula:

gasto realizado
+ recurrentes pendientes
+ gasto variable restante

Separa componentes.

Excluye:

- transferencias;
- reembolsos tratados como gasto;
- excluidos;
- recurrentes ya cobrados;
- splits padre duplicados;
- ahorro e inversion segun semantica actual.

8. Gasto variable

Usa historico comparable:

- excluye recurrentes;
- pondera meses recientes;
- reduce outliers;
- usa dias comparables;
- explica poco historico.

9. Rango

Calcula:

- inferior;
- central;
- superior.

Deriva incertidumbre de historico y recurrencias, no porcentaje fijo arbitrario.

10. UI

- listado;
- calendario;
- detalle;
- historial;
- grafico;
- alertas;
- desglose forecast;
- metodologia;
- dashboard responsive.

11. Supabase y offline

- migraciones;
- RLS;
- outbox;
- offline;
- backup;
- restauracion;
- exportacion.

12. Tests

Incluye:

- semanal;
- mensual variable;
- trimestral;
- anual;
- precio;
- ausencia;
- cancelacion;
- pausada;
- dos series mismo comercio;
- no doble conteo;
- principio y fin de mes;
- meses distintos;
- reembolso;
- transferencia;
- split;
- poco historico;
- outlier;
- offline;
- sincronizacion;
- aislamiento.

Al terminar ejecuta tests, typecheck, lint y build. No hagas commit.
```

## CIERRE COMPLETO DE LA FASE 7

### Mensaje 7.1

```text
/review-critico
```

### Mensaje 7.2

```text
Usa el subagente privacy-auditor para auditar recurrencias, notificaciones internas, sincronizacion, RLS, exportaciones y aislamiento.
```

### Mensaje 7.3

```text
Usa el subagente finance-auditor para auditar deteccion recurrente, tolerancias, incrementos, cobros ausentes, formula de forecast, rango, exclusiones, reembolsos, transferencias, splits y redondeos.
```

### Mensaje 7.4

```text
/audit-financiero recurrencias y forecast completo
```

### Mensaje 7.5

```text
/review-ux recurrencias, calendario, alertas, desglose y forecast del dashboard
```

### Mensaje 7.6

```text
Corrige todos los hallazgos criticos y altos. Despues:

1. Ejecuta tests, typecheck, lint y build.
2. Compara fixtures manuales.
3. Comprueba no doble conteo.
4. Comprueba poco historico.
5. Comprueba recurrencias ausentes.
6. Ejecuta git diff --check.
7. Revisa git status.
8. Añade solo archivos de fase.
9. Crea:
   Antes de crear este commit:

- usa MCP para ejecutar los asesores de seguridad y rendimiento;
- lista las migraciones remotas y comparalas con `supabase/migrations`;
- regenera tipos TypeScript desde el remoto si hubo cambios de esquema;
- confirma que no existen cambios remotos sin migracion versionada;
- confirma que no se han creado ramas, buckets o Edge Functions fuera del alcance;
- confirma que `.mcp.json`, `.env.example` y los archivos del repositorio no contienen secretos.

git commit -m "feat: recurrencias avanzadas y forecast por rango"
10. Ejecuta git push.
11. Si falla, rebase seguro, repite validaciones y push.
12. Muestrame hash y remoto actualizado.

No hagas commit si el forecast mezcla transferencias, duplica recurrentes o usa floats monetarios.
```

---

# FASE 8: CALCULADORA Y PLANIFICADOR DE DEUDAS

Escribe `/clear` y pega el siguiente prompt.

## PROMPT 8

```text
Implementa la fase 8: calculadora y planificador de deudas.

Lee:

- CLAUDE.md
- specs/PRD.md
- specs/DATA_MODEL.md
- specs/FINANCIAL_ALGORITHMS.md
- cuentas;
- movimientos;
- dashboard;
- presupuestos;
- sincronizacion;
- backups;
- exportaciones;
- tests.

Antes de editar ejecuta git status --short, git branch --show-current y git log -5 --oneline.

Objetivo:

Crear un modulo para registrar deudas, calcular amortizacion, simular pagos anticipados y comparar Snowball, Avalanche y escenarios personalizados.

No lo presentes como asesoramiento financiero personalizado.

Proyecto remoto y protocolo MCP de esta fase:

- Project Reference ID: skwhlbwpnsdgmdsfozcr
- Servidor MCP: supabase
- Entorno de desarrollo sin datos reales

1. Inspecciona el estado remoto antes de modificarlo.
2. Crea primero las migraciones en `supabase/migrations`.
3. Revisa SQL, restricciones, indices, grants y RLS.
4. Aplica exactamente esas migraciones mediante MCP.
5. No uses DDL ad hoc.
6. Regenera tipos TypeScript desde el remoto.
7. Ejecuta asesores de seguridad y rendimiento.
8. Lista migraciones remotas y comparalas con Git.
9. No uses account, functions, branching o storage salvo que esta fase lo pida.
10. No crees proyectos, ramas, buckets ni Edge Functions.
11. No muestres ni almacenes Secret Keys, `service_role`, contraseñas o tokens OAuth.

12. Mantiene los calculos financieros deterministas en servicios testeables.
13. No dependas del remoto para obtener resultados financieros sin fixtures equivalentes.

Alcance:

1. Tipos de deuda

- prestamo personal fijo;
- hipoteca fija;
- tarjeta;
- otra deuda amortizable.

Prepara arquitectura para variable, pero no simules indices futuros sin datos.

2. Modelo

Debt:

- id;
- profileId;
- name;
- type;
- currency;
- originalPrincipalCents;
- outstandingPrincipalCents;
- annualRate en representacion entera documentada;
- minimumPaymentCents;
- paymentFrequency mensual;
- nextPaymentDate;
- remainingTermMonths;
- linkedAccountId;
- linkedCategoryId;
- status;
- timestamps;
- sincronizacion.

DebtPayment:

- id;
- debtId;
- date;
- totalCents;
- principalCents;
- interestCents;
- feesCents;
- extraPrincipalCents;
- transactionId;
- sincronizacion.

DebtScenario:

- id;
- profileId;
- name;
- strategy:
  - baseline;
  - snowball;
  - avalanche;
  - custom;
- recurringExtraCents;
- oneTimeExtraPayments;
- createdAt;
- calculationVersion;
- sourceRevision.

3. Exactitud

- importes enteros;
- tipos enteros;
- redondeo documentado;
- orden pago;
- intereses;
- principal;
- comisiones;
- ultimo pago;
- anticipada;
- determinismo.

No acumules dinero con floats.

4. Calendario base

Calcula:

- cuota;
- interes;
- principal;
- saldo;
- final;
- intereses totales;
- pagos;
- tabla.

Detecta:

- cuota insuficiente;
- amortizacion negativa;
- datos incompatibles;
- no convergencia;
- plazo extremo.

5. Amortizacion anticipada

Permite:

- puntual;
- mensual;
- programada;
- mantener cuota y reducir plazo;
- mantener plazo y reducir cuota cuando sea matematicamente aplicable.

Muestra:

- final;
- meses;
- intereses;
- cuota nueva;
- coste;
- comparacion.

6. Snowball

- minimos;
- extra a menor saldo;
- cuota liberada se acumula;
- desempate determinista.

7. Avalanche

- minimos;
- extra a mayor interes;
- cuota liberada;
- desempate determinista.

8. Comparador

Tabla:

- base;
- Snowball;
- Avalanche;
- personalizada.

Muestra:

- fecha libre;
- meses;
- intereses;
- ahorro;
- mas rapida;
- menor coste.

No digas que una es universalmente mejor.

9. UI

- resumen;
- saldo;
- cuota;
- interes ponderado;
- fecha base;
- CRUD deuda;
- detalle;
- calendario;
- simulador;
- comparador;
- graficos;
- tabla descargable;
- responsive;
- accesible.

10. Movimientos

Permite vincular:

- deuda-cuenta;
- deuda-categoria;
- pago-movimiento.

Propone candidatos.

No vincula con confianza baja.

Evita doble conteo.

Permite separar principal, interes y comision.

La reduccion de pasivo no se trata automaticamente como gasto de consumo.

11. Escenarios

- no modifican reales;
- guardar;
- duplicar;
- borrar;
- fecha;
- recalcular;
- avisar desactualizado.

12. Supabase y offline

- migraciones;
- RLS;
- outbox;
- offline;
- backup;
- restauracion;
- XLSX.

13. Rendimiento

- limites;
- worker si necesario;
- no bloquear;
- errores claros.

14. Tests

Fixtures verificables para:

- prestamo fijo;
- ultimo pago;
- extra puntual;
- extra mensual;
- reducir plazo;
- reducir cuota;
- Snowball;
- Avalanche;
- tipos iguales;
- saldos iguales;
- cero interes;
- cuota insuficiente;
- amortizacion negativa;
- varias deudas;
- comisiones;
- movimiento;
- centimos;
- offline;
- sync;
- aislamiento;
- backup.

Al terminar:

1. Ejecuta tests.
2. Ejecuta typecheck.
3. Ejecuta lint si existe.
4. Ejecuta build.
5. Verifica tres escenarios contra formulas o hoja independiente reproducible.
6. No hagas commit.
```

## CIERRE COMPLETO DE LA FASE 8

### Mensaje 8.1

```text
/review-critico
```

### Mensaje 8.2

```text
Usa el subagente privacy-auditor para auditar deudas, RLS, sincronizacion, exportaciones, backups, logs y aislamiento.
```

### Mensaje 8.3

```text
Usa el subagente finance-auditor para auditar todos los calculos de deuda: tipos, periodicidad, redondeo, calendario, cuota, principal, intereses, comisiones, amortizaciones, reduccion de cuota, reduccion de plazo, Snowball, Avalanche, escenarios y vinculacion con movimientos.
```

### Mensaje 8.4

```text
/audit-financiero modulo completo de deudas y estrategias Snowball y Avalanche
```

### Mensaje 8.5

```text
/review-ux modulo de deudas completo, formularios, simulador, comparador, graficos y tablas
```

### Mensaje 8.6

```text
Corrige todos los hallazgos criticos y altos. Despues:

1. Ejecuta tests, typecheck, lint y build.
2. Verifica los tres escenarios independientes.
3. Comprueba cuota insuficiente.
4. Comprueba cero interes.
5. Comprueba ultimo pago.
6. Comprueba Snowball y Avalanche.
7. Comprueba no doble conteo con movimientos.
8. Ejecuta git diff --check.
9. Revisa git status.
10. Añade solo archivos de fase.
11. Crea:
    Antes de crear este commit:

- usa MCP para ejecutar los asesores de seguridad y rendimiento;
- lista las migraciones remotas y comparalas con `supabase/migrations`;
- regenera tipos TypeScript desde el remoto si hubo cambios de esquema;
- confirma que no existen cambios remotos sin migracion versionada;
- confirma que no se han creado ramas, buckets o Edge Functions fuera del alcance;
- confirma que `.mcp.json`, `.env.example` y los archivos del repositorio no contienen secretos.

git commit -m "feat: calculadora de deudas con Snowball y Avalanche"
12. Ejecuta git push.
13. Si falla, rebase seguro, repite validaciones y push.
14. Muestrame hash y remoto actualizado.

No hagas commit si un fixture financiero no cuadra o si hay acumulacion monetaria con floats.
```

---

# SESION FINAL: VERIFICACION, PRIVACIDAD, COSTE Y DOCUMENTACION

Escribe `/clear` y pega el siguiente prompt.

## PROMPT FINAL

```text
Haz una verificacion final de la ampliacion completa.

Lee:

- CLAUDE.md
- FUNCIONALIDADES.md
- README
- todos los specs
- migraciones Supabase
- configuracion PWA
- autenticacion
- sincronizacion
- PIN y passkeys
- comercios
- duplicados
- bandeja
- conciliacion
- recurrencias
- forecast
- deudas
- backups
- exportaciones
- tests

Antes de editar ejecuta git status --short, git branch --show-current y git log -10 --oneline.

Objetivo:

Comprobar integracion real, actualizar documentacion y crear `docs/CHECKLIST_AMPLIACION_FINAL.md`.

Proyecto remoto:

- Project Reference ID: skwhlbwpnsdgmdsfozcr
- Servidor MCP: supabase

Usa MCP para:

1. Listar tablas, vistas, funciones y migraciones.
2. Comparar remoto con `supabase/migrations`.
3. Regenerar tipos TypeScript.
4. Ejecutar asesores de seguridad y rendimiento.
5. Revisar logs sin mostrar datos sensibles.
6. Verificar RLS con usuarios diferentes.
7. Confirmar que no hay ramas, buckets o Edge Functions no autorizados.
8. Confirmar que no hay cambios de cuenta u organizacion.
9. No hagas cambios estructurales sin crear primero una migracion.

La checklist debe incluir para cada punto:

- COMPROBADO;
- como se comprobo;
- test o archivo;
- resultado;
- o PENDIENTE DE PRUEBA MANUAL con pasos exactos.

Comprueba:

1. Registro.
2. Login.
3. Recuperacion.
4. RLS.
5. Dos usuarios.
6. Dos perfiles.
7. Migracion local.
8. Reanudacion.
9. Nuevo dispositivo.
10. Offline.
11. Outbox.
12. Reintentos.
13. Idempotencia.
14. Conflictos.
15. Logout.
16. PIN.
17. bloqueo automatico.
18. sesion cifrada.
19. passkeys activadas.
20. passkeys desactivadas.
21. navegador sin WebAuthn.
22. comercios.
23. alias.
24. rawConcept.
25. fusion.
26. archivo repetido.
27. duplicado exacto.
28. posible duplicado.
29. compras iguales reales.
30. pendiente-confirmado.
31. bandeja.
32. acciones masivas.
33. transferencias.
34. reembolsos.
35. errores.
36. conciliacion.
37. recurrencia semanal.
38. mensual.
39. trimestral.
40. anual.
41. subida.
42. ausencia.
43. cancelacion.
44. forecast.
45. rango.
46. no doble conteo.
47. deuda fija.
48. amortizacion anticipada.
49. Snowball.
50. Avalanche.
51. movimientos vinculados.
52. backups.
53. restauracion.
54. exportaciones.
55. PWA.
56. responsive movil 360px.
57. responsive PC.
58. accesibilidad.
59. build.
60. secretos.
61. service worker.
62. textos de privacidad.
63. limites de Supabase.
64. coste.
65. documentacion.
66. MCP conectado al proyecto correcto.
67. migraciones remotas iguales a las versionadas.
68. tipos TypeScript regenerados desde remoto.
69. asesores de seguridad revisados.
70. asesores de rendimiento revisados.
71. ausencia de ramas, buckets y Edge Functions no autorizados.
72. ausencia de cambios no autorizados de cuenta u organizacion.
73. `.mcp.json` sin secretos.
74. OAuth del MCP fuera del repositorio.

Revisa especificamente:

- que no se mantenga "privacidad total";
- que no se prometa coste cero perpetuo;
- que no se diga "sin backend";
- que no se diga "ningun dato sale";
- que no se diga "sin red" de forma absoluta;
- que se explique local-first;
- que se explique Supabase;
- que se explique PIN;
- que se explique passkey;
- que se explique biometria;
- que se explique recovery;
- que se explique backup.

Ejecuta:

1. npm run test
2. npx tsc --noEmit
3. npm run lint si existe
4. npm run build
5. pruebas Supabase locales
6. pruebas RLS
7. pruebas de migracion
8. pruebas de sincronizacion
9. pruebas financieras
10. asesores de seguridad y rendimiento mediante MCP
11. comparacion de migraciones locales y remotas
12. regeneracion de tipos TypeScript desde remoto
13. inspeccion de ramas, buckets y Edge Functions
14. git diff --check

Actualiza:

- README;
- FUNCIONALIDADES.md;
- docs;
- politica o pantalla de privacidad;
- instrucciones Supabase;
- configuracion local;
- restauracion;
- seguridad;
- FAQ.

No hagas commit todavia.
```

## CIERRE COMPLETO DE LA SESION FINAL

### Mensaje F1

```text
/review-critico
```

### Mensaje F2

```text
Usa el subagente privacy-auditor para auditar la aplicacion completa, no solo los ultimos cambios. Revisa autenticacion, RLS, sincronizacion, almacenamiento local, PIN, passkeys, backups, service worker, logs, exportaciones, errores, aislamiento, redaccion de privacidad, configuracion MCP, permisos habilitados, `.mcp.json`, OAuth y correspondencia entre migraciones locales y remotas.
```

### Mensaje F3

```text
Usa el subagente finance-auditor para auditar la aplicacion financiera completa. Revisa movimientos, splits, transferencias, reembolsos, duplicados, conciliacion, presupuestos, dashboard, recurrencias, forecast, deudas, Snowball, Avalanche, exportaciones, sincronizacion y restauracion.
```

### Mensaje F4

```text
/audit-financiero aplicacion completa
```

### Mensaje F5

```text
/review-ux toda la app, pantalla por pantalla, en movil y PC
```

### Mensaje F6

```text
/audit-coste-cero
```

### Mensaje F7

```text
Interpreta el resultado de /audit-coste-cero con el nuevo alcance: no se puede prometer coste cero para siempre porque existe Supabase. Corrige cualquier dependencia innecesaria de pago, verifica que las funciones esenciales no usen APIs de pago, documenta los limites del plan gratuito actual y elimina cualquier promesa absoluta.

Corrige tambien todos los hallazgos criticos y altos del resto de auditores.

Despues:

1. Ejecuta npm run test.
2. Ejecuta npx tsc --noEmit.
3. Ejecuta npm run lint si existe.
4. Ejecuta npm run build.
5. Repite RLS, sincronizacion, migracion y fixtures financieros.
6. Ejecuta git diff --check.
7. Busca secretos con las herramientas disponibles.
8. Revisa que `.env` real este ignorado.
9. Revisa git status --short.
10. Añade al staging solo los archivos finales necesarios.
11. Crea:
    Antes de crear este commit:

- usa MCP para ejecutar los asesores de seguridad y rendimiento;
- lista las migraciones remotas y comparalas con `supabase/migrations`;
- regenera tipos TypeScript desde el remoto si hubo cambios de esquema;
- confirma que no existen cambios remotos sin migracion versionada;
- confirma que no se han creado ramas, buckets o Edge Functions fuera del alcance;
- confirma que `.mcp.json`, `.env.example` y los archivos del repositorio no contienen secretos.

git commit -m "docs: verificacion final de ampliacion y seguridad"
12. Ejecuta git push.
13. Si el push es rechazado, haz fetch y rebase seguro, resuelve conflictos, repite toda la validacion afectada y vuelve a hacer push.
14. Muestrame:
    - hash del commit;
    - rama;
    - resultado del push;
    - resumen de tests;
    - hallazgos corregidos;
    - pendientes manuales;
    - pasos exactos para probarlos.

No cierres la sesion afirmando que esta todo comprobado si queda una prueba manual pendiente.
```

---

# PRUEBAS MANUALES RECOMENDADAS DESPUES DE CADA PUSH

Estas pruebas no sustituyen tests ni auditorias.

## DESPUES DE SESION 0

- Abrir `/mcp` y comprobar que `supabase` esta conectado.
- Confirmar el Project Reference ID.
- Confirmar que `.mcp.json` no contiene secretos.
- Confirmar commit y push de la configuracion MCP.

## DESPUES DE FASE 1

- Crear cuenta.
- Verificar correo.
- Iniciar sesion.
- Recuperar contraseña.
- Cerrar sesion.
- Intentar acceder a ruta privada.
- Comprobar que un usuario no ve datos de otro.

## DESPUES DE FASE 2

- Crear movimiento offline.
- Recuperar red.
- Verlo sincronizado.
- Abrir otro navegador.
- Iniciar sesion.
- Descargar perfil.
- Editar la misma entidad en dos dispositivos.
- Resolver conflicto.
- Migrar un perfil local.

## DESPUES DE FASE 3

- Activar PIN.
- Bloquear.
- Desbloquear offline.
- Fallar PIN varias veces.
- Recuperar.
- Registrar passkey.
- Probar fallback.
- Desactivar feature flag.

## DESPUES DE FASE 4

- Importar Amazon con tres conceptos distintos.
- Asociar alias.
- Fusionar.
- Buscar.
- Ver rawConcept.

## DESPUES DE FASE 5

- Importar mismo archivo dos veces.
- Importar pendiente y confirmado.
- Importar dos compras iguales reales.
- Marcar no duplicado.

## DESPUES DE FASE 6

- Importar lote con errores.
- Resolver bandeja.
- Vincular transferencia.
- Vincular reembolso.
- Conciliar saldo.
- Abrir dashboard final.

## DESPUES DE FASE 7

- Confirmar mensual.
- Simular subida.
- Simular cobro ausente.
- Revisar rango.
- Comparar con movimientos reales.

## DESPUES DE FASE 8

- Crear prestamo.
- Simular extra.
- Comparar plazo y cuota.
- Comparar Snowball y Avalanche.
- Descargar tabla.
- Vincular pago.

---

# RECORDATORIOS

- `/clear` antes de cada fase.
- No pases de fase sin push correcto.
- No uses force push.
- No guardes secretos.
- No uses MCP para DDL ad hoc.
- No dejes Supabase distinto de las migraciones versionadas.
- No uses account, functions, branching o storage sin instruccion expresa.
- No desactives RLS.
- No elimines IndexedDB.
- No uses floats para dinero.
- No resuelvas conflictos silenciosamente.
- No borres movimientos por heuristica.
- No llames biometria a cualquier passkey.
- No prometas coste cero perpetuo.
- No prometas privacidad total.
- No cierres una fase con tests fallando.

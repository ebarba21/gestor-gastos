# CLOUD_SYNC_SECURITY: sincronizacion, autenticacion y seguridad

Documento de seguridad de la ampliacion. Cubre la arquitectura local-first con copia remota opcional, el modelo de autenticacion y autorizacion (Supabase Auth + RLS), la politica de secretos, la sincronizacion idempotente y la resolucion de conflictos, la migracion, el PIN y el cifrado de sesion, las passkeys, las amenazas y mitigaciones, lo que la app NO protege y el procedimiento de recuperacion.

Relacionado: `ARCHITECTURE.md` (capas y motor de sync), `DATA_MODEL.md` (campos de sync, outbox, conflictos, seguridad local) e `IMPLEMENTATION_ROADMAP.md` (fases). Ante contradiccion con `CLAUDE.md`, mandan los invariantes.

Esta ampliacion es OPCIONAL: sin cuenta, la app funciona 100% en local y nada de este documento aplica salvo el PIN local.

---

## 1. Arquitectura local-first

- **Base operativa**: IndexedDB (Dexie) en el dispositivo. Toda lectura y escritura de la app pasa primero por aqui. La app funciona offline.
- **Copia remota privada**: Supabase (Postgres) guarda una copia por usuario. No es la fuente de la UI; se usa para sincronizar entre dispositivos, confirmar mutaciones, reconstruir un dispositivo y resolver conflictos.
- **Principio**: la red nunca es requisito para el uso normal. La sincronizacion es un proceso en segundo plano, por lotes y bajo disparadores (login, recuperar conexion, tras mutacion, volver a primer plano, boton manual).

## 2. Limites de responsabilidad entre Dexie y Supabase

| Responsabilidad | Dexie (local) | Supabase (remoto) |
|-----------------|---------------|-------------------|
| Fuente de la UI | Si (siempre) | No |
| Escritura del usuario | Primaria (optimista) | Confirmacion diferida |
| Disponibilidad offline | Total | No aplica |
| Autorizacion final | Repos locales (profileId/owner) | RLS (ultima linea) |
| Copia entre dispositivos | No | Si |
| Reconstruccion de dispositivo | Destino | Origen |
| Archivos bancarios originales | Pueden quedar en local si el usuario los guarda aparte | Nunca por defecto |

Regla: la seguridad NUNCA depende solo de una capa. El cliente valida, pero la autoridad final de acceso remoto es RLS en Postgres.

## 3. Modelo de autenticacion

- Proveedor: **Supabase Auth**. Metodo base: email + contrasena.
- Operaciones: registro, login, restauracion de sesion, cierre de sesion, recuperacion de contrasena, cambio de contrasena, estado de email por verificar, reautenticacion para acciones sensibles.
- **Distincion de credenciales** (no confundir en UI ni en codigo):
  - Contrasena de cuenta: identifica a la persona ante Supabase. Viaja a Supabase Auth (nunca se guarda en claro en la app).
  - PIN local: protege el acceso en el dispositivo. Nunca sale del dispositivo.
  - Passkey/biometria: verificacion del sistema via WebAuthn. La app no recibe datos biometricos.
- Errores de login/recuperacion redactados para no revelar innecesariamente si una cuenta existe.

## 4. Modelo de autorizacion y RLS

- Toda tabla financiera remota lleva `owner_user_id` (directo o via join a `profiles`) y `profile_id`.
- **Row Level Security activo en TODAS** las tablas financieras. Politicas explicitas por operacion:
  - **SELECT**: solo filas cuyo `owner_user_id = auth.uid()` (y, para hijos, cuyo perfil pertenezca al usuario).
  - **INSERT**: `with check` que exige `owner_user_id = auth.uid()`; no se puede insertar para otro propietario.
  - **UPDATE**: `using` + `with check` que impiden cambiar `owner_user_id` (el propietario es inmutable).
  - **DELETE**: solo filas propias (en la practica se usa borrado logico via UPDATE de `deleted_at`).
- **Tablas hijas sin `owner_user_id` propio** (p. ej. `merchant_aliases`, `recurring_occurrences`, `debt_payments`): la propiedad se valida por pertenencia del perfil. NO basta con filtrar en SELECT; el `WITH CHECK` de INSERT y UPDATE (y el `USING` de SELECT/DELETE) debe verificar explicitamente `profile_id IN (SELECT id FROM profiles WHERE owner_user_id = auth.uid())`. Sin ese `WITH CHECK`, un cliente podria insertar una fila hija con un `profile_id` ajeno aunque el SELECT lo oculte. Es el punto donde suelen aparecer fugas reales, asi que se audita en cada tabla hija.
- Un usuario **anonimo** no lee ni escribe nada (sin politica permisiva para `anon`).
- Funciones, RPC y vistas SECURITY DEFINER (si las hubiera) replican la misma autorizacion; se prefieren funciones `security invoker` para que RLS aplique.
- `revision` la incrementa un trigger del servidor en cada UPDATE; el cliente no puede falsearla.

## 5. Politica de secretos y variables de entorno

- Frontend (Vite): solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (Supabase renombro la "anon key" a "publishable key"; se usa el nombre nuevo de forma consistente en todo el proyecto). Es publica por diseno y NO da acceso a datos sin sesion valida (RLS lo impide).
- **Prohibido** en el frontend: `service_role` o cualquier clave de servicio, JWT secrets, claves de administracion. Nunca en el bundle, ni en el repo, ni en logs.
- `.env` real ignorado por git; se versiona solo `.env.example` con nombres y sin valores.
- Validacion clara al arrancar si falta configuracion; los tests unitarios locales no requieren Supabase funcionando.
- Secretos de servidor (si se usan migraciones/CI) viven fuera del cliente, en el entorno del propietario del proyecto.

## 6. Sincronizacion e idempotencia

- **Cola de salida (outbox)** local con `mutationId` unico por mutacion (ver `DATA_MODEL.md` seccion 11).
- **Idempotencia**: el `entityId` es el mismo UUID en local y remoto; el push usa upsert por PK. Reenviar una mutacion (mismo `mutationId`/`entityId`) no duplica ni corrompe.
- **Por lotes**: importaciones grandes se agrupan por `importBatchId`. Reintentos con espera progresiva, limites, cancelacion segura, reanudacion y progreso.
- **Borrado logico**: `delete` = set `deleted_at`; nunca fisico para entidades sincronizables mientras otros dispositivos puedan reintroducirlas.
- **Lecturas**: la app lee de Dexie; el PULL descarga filas con `revision` mayor a la conocida y hace upsert local. Nunca una consulta remota por render.
- Mientras la app esta bloqueada por PIN, no se sincroniza en segundo plano.

## 7. Conflictos

- Surgen cuando el `baseRevision` de una mutacion ya no es la revision remota vigente.
- Se conservan version local y remota; se muestran entidad y diferencias.
- **Financieros** (movimientos, splits, transferencias, reembolsos, deudas, pagos): los resuelve la persona (mantener local / remota / combinar solo campos seguros no monetarios). Nunca merge automatico de importes.
- **No financieros** (`Setting`): last-write-wins documentado, sin conflicto visible.
- La resolucion se registra y genera una mutacion idempotente sobre `remote_revision`.

## 8. Migracion

- Al iniciar sesion con datos locales sin vincular: asistente de migracion (ver `ARCHITECTURE.md` seccion 16 y `DATA_MODEL.md` seccion 13.2). Conserva UUID, asigna `owner_user_id`, sube por lotes respetando dependencias, valida recuentos y relaciones, ofrece backup previo, no borra datos locales y solo marca migrado tras verificar. Reanudable e idempotente.
- Al iniciar sesion en dispositivo vacio: descarga y reconstruye IndexedDB con progreso; valida esquema y relaciones; queda operativo offline.

## 9. PIN local

- Opcional. Minimo 6 digitos. Activacion, confirmacion, cambio, desactivacion, bloqueo manual y automatico (inmediato, 1, 5, 15, 30 min) y al volver del segundo plano.
- **Almacenamiento**: nunca en claro y nunca hash rapido sin sal. Derivacion con Web Crypto (PBKDF2 u derivacion robusta disponible en navegador), sal aleatoria, parametros (iteraciones, algoritmo) versionados y documentados. Se guarda un verificador, no el PIN. No se registra el PIN. No se envia a Supabase.
- **Intentos**: contador con espera progresiva. Recuperacion mediante autenticacion de cuenta (si el usuario olvida el PIN pero recuerda su contrasena). Sin cuenta y sin PIN, no hay via de recuperacion del PIN salvo restablecer los datos locales.
- **Offline**: el PIN desbloquea localmente sin internet cuando ya existe una sesion valida cifrada. Las acciones remotas que requieran reautenticacion no se permiten sin red y se informa con claridad.

## 10. Cifrado de sesion

- Cuando el PIN esta activo, la sesion de Supabase persistida se cifra con **AES-GCM**. La clave se deriva del PIN (misma familia de KDF, sal propia).
- La clave vive **solo en memoria** mientras la app esta desbloqueada; se elimina de memoria al bloquear.
- No existe una copia de la sesion sin cifrar en ningun otro storage. Se adapta el storage del SDK de Supabase Auth para leer/escribir cifrado.
- Errores de descifrado se tratan explicitamente (PIN incorrecto, datos corruptos): se pide PIN o se ofrece cerrar sesion; nunca se degrada a texto plano.
- Al cerrar sesion se eliminan los datos de sesion.

## 11. Passkeys y limitaciones de navegadores

- Solo APIs oficiales y WebAuthn. Deteccion de `PublicKeyCredential` y de autenticador de plataforma cuando sea posible. No se construye un servidor WebAuthn casero.
- Registro de passkey desde sesion autenticada (nombre de dispositivo, listado, eliminacion), inicio/desbloqueo, cancelacion y credencial no reconocida.
- Feature flag `VITE_ENABLE_PASSKEYS`; si la integracion oficial de Supabase sigue experimental, desactivada por defecto, documentando el riesgo y sin presentarla como universal.
- **Terminologia honesta**: se dice "passkey" cuando el sistema pueda solicitar biometria, PIN del dispositivo o llave fisica. Solo se dice "biometria" cuando se detecta un autenticador de plataforma compatible, y aun asi se explica que la app no recibe datos biometricos.
- **Limitaciones**: soporte desigual entre navegadores/plataformas, credenciales ligadas al dispositivo/proveedor, comportamiento distinto en incognito y en PWA instalada. Por eso siempre hay fallback por contrasena/PIN; nadie se queda sin metodo de acceso valido.

## 12. Amenazas principales y mitigaciones

| Amenaza | Mitigacion |
|---------|-----------|
| Acceso no autorizado a la API remota | RLS por `owner_user_id`; rol anon sin acceso; clave publicable inutil sin sesion |
| Escalada entre usuarios o perfiles | Doble clave `owner_user_id`+`profile_id` en todas las capas; propietario inmutable |
| Duplicacion/perdida de datos en reintentos | Idempotencia por `mutationId`/UUID; upsert por PK; borrado logico |
| Sobrescritura silenciosa entre dispositivos | Revisiones + conflictos explicitos; sin merge financiero automatico |
| Robo de sesion en el dispositivo | Cifrado de sesion con clave derivada del PIN; clave solo en memoria; bloqueo automatico |
| Fuga de secretos | Sin `service_role` en cliente; `.env` ignorado; sin secretos en logs |
| Datos financieros en cache del SW | El SW no cachea respuestas remotas de Supabase |
| Exposicion de conceptos bancarios en logs | Logs sin datos financieros completos ni PIN; errores con mensajes cortos |
| Regex maliciosa en alias/reglas | Compilacion con manejo de error; sin bloquear el motor |
| Phishing de la contrasena de cuenta | Fuera del control tecnico de la app; se documenta; reautenticacion para acciones sensibles |

## 13. Que NO protege la app (limites honestos)

- No protege frente a un **dispositivo comprometido** (malware, atacante con la app desbloqueada, backups del SO sin cifrar).
- No protege frente al **proveedor de infraestructura** (Supabase puede acceder tecnicamente a los datos alojados; no hay cifrado extremo a extremo de la base remota).
- No protege frente al **robo de la contrasena de cuenta** por phishing o reutilizacion.
- No garantiza **disponibilidad**: los limites y la continuidad del plan gratuito los fija el proveedor.
- No cifra la **base local completa** mas alla de la sesion (el cifrado de toda la BD local sigue fuera de alcance).
- No ofrece **privacidad total** ni **coste cero perpetuo**: se describe siempre el modelo real.

## 14. Procedimiento de recuperacion

- **Olvido de contrasena de cuenta**: flujo oficial de recuperacion de Supabase (email). Tras restablecer, la sesion vuelve; los datos remotos siguen intactos.
- **Olvido de PIN (con cuenta)**: recuperacion reautenticando con la contrasena de cuenta; se re-cifra la sesion con un PIN nuevo. Los datos no se pierden.
- **Olvido de PIN (sin cuenta)**: no hay via de recuperacion del PIN; el usuario debe restablecer los datos locales (perdida de la copia local salvo backup previo). Por eso se recomienda backup y/o activar cuenta.
- **Perdida/robo de dispositivo**: cerrar sesion desde otro dispositivo si el SDK lo permite; cambiar la contrasena de cuenta; los datos remotos siguen protegidos por RLS. La copia local del dispositivo perdido queda protegida por el PIN si estaba activo.
- **Reconstruccion**: en un dispositivo nuevo, iniciar sesion descarga y reconstruye los perfiles remotos.
- **Backups**: por perfil (JSON), sin PIN/tokens/sesiones; permiten recuperar aunque no haya cuenta. Restauracion idempotente.

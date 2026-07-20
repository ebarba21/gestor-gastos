# Guia de validacion manual (propietario del proyecto)

Estas pruebas requieren tus credenciales reales, tu proyecto Supabase y/o un dispositivo fisico, por
eso no se automatizan desde el repositorio. Complementan a `docs/CHECKLIST_AMPLIACION_FINAL.md` (que
cubre todo lo verificable de forma automatica). Hazlas en orden: cada bloque asume que el anterior
quedo bien.

Convencion de cada paso: **Que hacer** -> **Que debe pasar (OK)** -> **Si falla**.

Proyecto Supabase: `skwhlbwpnsdgmdsfozcr` · Dashboard:
`https://supabase.com/dashboard/project/skwhlbwpnsdgmdsfozcr`

---

## 0. Prerequisitos (una sola vez)

1. **Node y dependencias**. En la raiz del proyecto:
   ```powershell
   node --version   # 18+ recomendado
   npm install
   ```
   - OK: `npm install` termina sin errores.
2. **Acceso al Dashboard de Supabase** del proyecto de arriba (con tu cuenta de Supabase).
3. **Navegadores**: Chrome o Edge (para PWA, instalacion y Lighthouse). Opcional: un segundo navegador
   o ventana de incognito para la prueba de dos usuarios.

> Nota de seguridad: en el frontend solo se usa la **clave publicable** (publishable / anon public).
> NUNCA pongas la `service_role` ni ninguna Secret Key en variables `VITE_*` ni en el repo.

---

## A. Crear `.env.local` con tus claves reales

**Que hacer**
1. Copia la plantilla (no borres `.env.example`):
   ```powershell
   Copy-Item .env.example .env.local
   ```
2. Abre el Dashboard > **Project Settings > API**:
   `https://supabase.com/dashboard/project/skwhlbwpnsdgmdsfozcr/settings/api`
   - Copia **Project URL** -> pegalo en `VITE_SUPABASE_URL`.
   - Copia **Publishable key** (apartado "Project API keys", la etiquetada como *publishable* / *anon
     public*) -> pegalo en `VITE_SUPABASE_PUBLISHABLE_KEY`.
   - NO copies la **service_role** / Secret key.
3. Guarda `.env.local`. Debe quedar asi (con tus valores):
   ```
   VITE_SUPABASE_URL=https://skwhlbwpnsdgmdsfozcr.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOi... (tu clave publicable)
   VITE_ENABLE_PASSKEYS=false
   ```
4. Comprueba que git NO lo trackea:
   ```powershell
   git status --short        # .env.local NO debe aparecer
   git check-ignore .env.local   # debe imprimir: .env.local
   ```
5. Arranca la app:
   ```powershell
   npm run dev
   ```
   Abre `http://localhost:5173` y ve a la pantalla **Cuenta**.

**Que debe pasar (OK)**
- La pantalla Cuenta muestra opciones de registro/inicio de sesion (estado "configurado"), NO el aviso
  de "modo local sin cuenta".
- `git status` no lista `.env.local`.

**Si falla**
- Si la pantalla Cuenta sigue en "modo local": revisa que los nombres de variable sean EXACTOS
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`), sin espacios, y **reinicia** `npm run dev`
  (Vite solo lee `.env.local` al arrancar).
- Si aparece un aviso de configuracion invalida: la URL debe empezar por `https://` y terminar en
  `.supabase.co`; la clave no debe estar vacia.

---

## B. Registro, login y recuperacion de contrasena (E2E real)

### B.0 Configurar las URLs de Auth (una sola vez, en el Dashboard)
**Que hacer**: Dashboard > **Authentication > URL Configuration**:
- **Site URL**: `http://localhost:5173`
- **Redirect URLs**: anade `http://localhost:5173/cuenta`
- Guarda.

> Sin esto, los enlaces de verificacion de email y de recuperacion no vuelven a la app.

### B.1 Registro
**Que hacer**
1. Con `npm run dev` en marcha, pantalla **Cuenta** > registrarse con un email real tuyo (puedes usar
   un alias tipo `tucorreo+test1@gmail.com`) y una contrasena.
2. Revisa tu bandeja de entrada: debe llegar un correo de verificacion. Pulsa el enlace.

**Que debe pasar (OK)**
- Tras registrar, la app indica "revisa tu correo para verificar" (email pendiente).
- El enlace del correo te devuelve a `http://localhost:5173/cuenta` y el email queda verificado.
- En el Dashboard > **Authentication > Users** aparece el usuario, con su fecha de confirmacion.

**Si falla**
- No llega el correo: revisa spam; en Dashboard > Authentication > Providers comprueba que Email esta
  habilitado; los proyectos nuevos tienen limites de envio (unos pocos correos/hora).
- El enlace no vuelve a la app: revisa Redirect URLs (B.0).

### B.2 Login / logout
**Que hacer**: cierra sesion (boton de la pantalla Cuenta) y vuelve a iniciar sesion con el mismo
email y contrasena.
**OK**: la pantalla Cuenta pasa a "sesion iniciada" y muestra tu email. Tras logout, vuelve a
"sin sesion".
**Si falla**: si dice "correo o contrasena incorrectos" con datos correctos, confirma que verificaste
el email (B.1); un email sin verificar puede bloquear el acceso segun tu configuracion.

### B.3 Recuperacion de contrasena
**Que hacer**
1. Cierra sesion. En la pantalla Cuenta pulsa "He olvidado mi contrasena" e introduce tu email.
2. Revisa el correo, pulsa el enlace de recuperacion, define una contrasena nueva.
3. Inicia sesion con la nueva contrasena.

**OK**
- Llega el correo de recuperacion; el enlace te lleva a la app en modo "define nueva contrasena".
- Tras cambiarla, inicias sesion con la nueva y NO con la antigua.
- Nota (correcto por diseno anti-enumeracion): si introduces un email que no existe, la app tambien
  dice "te hemos enviado un correo" (no revela si la cuenta existe). Solo veras error si hay problema
  de red o limite de envios.

---

## C. RLS: aislamiento entre usuarios y usuario anonimo

Dos formas. La C.1 (pgTAP) es la mas rigurosa; la C.2 (con la app) es la mas rapida. Haz al menos una.

### C.1 Test pgTAP local (requiere Supabase CLI + Docker)
**Que hacer**
1. Instala Docker Desktop y la Supabase CLI (`https://supabase.com/docs/guides/local-development`).
2. En la raiz del repo:
   ```powershell
   supabase start          # levanta Postgres local con las migraciones de supabase/migrations
   supabase test db        # ejecuta supabase/tests/rls_isolation_test.sql (pgTAP)
   ```
3. Al terminar:
   ```powershell
   supabase stop
   ```

**OK**: `supabase test db` reporta todos los asserts en verde (dos usuarios no ven datos del otro,
`anon` no lee nada, no se puede cambiar el propietario de una fila).
**Si falla**: revisa que Docker este arrancado y que no haya otro Postgres ocupando el puerto; el
detalle del assert fallido indica la politica RLS afectada.

### C.2 Prueba con la app (dos cuentas + anonimo)
**Que hacer**
1. **Usuario A**: inicia sesion con la cuenta A, crea un perfil y algun movimiento. Activa la cuenta y
   deja que sincronice (ver bloque D si te pide migrar). Cierra sesion.
2. **Usuario B**: en una ventana de **incognito** (o segundo navegador), registra/inicia sesion con
   una cuenta B distinta.
3. Observa la lista de perfiles y movimientos del usuario B.
4. **Anonimo (opcional, tecnico)**: sin sesion, intenta leer la API REST directamente. En una consola:
   ```powershell
   curl "https://skwhlbwpnsdgmdsfozcr.supabase.co/rest/v1/transactions?select=*" `
     -H "apikey: <TU_CLAVE_PUBLICABLE>"
   ```

**OK**
- El usuario B NO ve ningun perfil ni movimiento del usuario A.
- La llamada `curl` anonima devuelve `[]` (lista vacia) o un error de autorizacion, nunca datos.
**Si falla**: si B viese datos de A, seria una fuga grave de RLS: NO uses la app con datos reales y
avisa. (En la verificacion automatica esto quedo cubierto: RLS activo en las 24 tablas.)

---

## D. Migracion local, dispositivo nuevo, PIN y passkeys

### D.1 Migracion de datos locales a la cuenta
**Que hacer**
1. Empieza en **modo local** (sin sesion): crea 1-2 perfiles y varios movimientos.
2. **Antes** de migrar, descarga un backup por si acaso (Ajustes > Exportar/Backup; ver bloque F).
3. Ve a la pantalla Cuenta e inicia sesion. La app debe ofrecer un **asistente de migracion**.
4. Sigue el asistente (acepta el backup previo que ofrece) y espera a que termine.

**OK**
- El asistente sube tus perfiles y movimientos sin perder ni duplicar; al terminar, los recuentos
  coinciden con lo que tenias en local.
- La pantalla de sincronizacion muestra "sincronizado".
**Si falla**: si algo queda a medias, el asistente es reanudable: vuelve a lanzarlo. Tus datos locales
no se borran hasta que la migracion se marca verificada.

### D.2 Dispositivo nuevo (reconstruccion)
**Que hacer**
1. En una ventana de **incognito** (simula un dispositivo limpio, IndexedDB vacia) abre la app e inicia
   sesion con la MISMA cuenta que migraste en D.1.
2. Espera a la reconstruccion.

**OK**: la app descarga y reconstruye tus perfiles y movimientos; luego, si cortas la red (DevTools >
Network > Offline) y recargas, sigue funcionando con esos datos.
**Si falla**: comprueba conexion y que la sesion es la misma cuenta; la reconstruccion muestra progreso.

### D.3 PIN y bloqueo automatico
**Que hacer**
1. Con sesion iniciada, ve a **Ajustes > Seguridad** (o la pantalla equivalente) y **activa un PIN**
   (minimo 6 digitos). Confirmalo.
2. Configura el **bloqueo automatico** (p. ej. 1 minuto) y prueba a bloquear manualmente.
3. Corta la red (DevTools > Network > Offline) y **desbloquea con el PIN**.
4. Verifica el cifrado de sesion: DevTools > **Application** > IndexedDB / Local Storage. Busca la
   entrada de sesion de Supabase.

**OK**
- Tras bloquear, la app pide el PIN para volver a entrar; con la red cortada, el PIN desbloquea igual.
- La sesion persistida aparece **cifrada** (texto ilegible / base64 opaco), no un JSON con tu token
  legible.
- Introducir un PIN incorrecto no entra y, tras varios intentos, aplica espera progresiva.
**Si falla**: si olvidas el PIN teniendo cuenta, se recupera reautenticando con la contrasena de
cuenta; sin cuenta, la unica via es restablecer los datos locales (por eso el backup de D.1).

### D.4 Passkeys (opcional, experimental)
**Que hacer**
1. Configura en el Dashboard > **Authentication > Passkeys** (Relying Party ID, Display Name, Origins)
   segun `docs/FASE3_CONFIGURACION_MANUAL.md`.
2. En `.env.local` pon `VITE_ENABLE_PASSKEYS=true` y **reinicia** `npm run dev`.
3. Con sesion iniciada, registra una passkey (huella/cara/PIN del sistema o llave fisica) desde la
   pantalla de Seguridad. Luego bloquea y **desbloquea con la passkey**.

**OK**
- Puedes registrar la passkey y desbloquear con ella; SIEMPRE queda la contrasena/PIN como alternativa.
- La app nunca te pide "datos biometricos": la biometria la gestiona tu sistema operativo.
**Si falla / navegador sin soporte**: si el navegador no soporta WebAuthn o la passkey no se reconoce,
la app debe seguir permitiendo el acceso por contrasena/PIN sin bloquearte. Deja
`VITE_ENABLE_PASSKEYS=false` si no vas a usarlas.

---

## E. PWA, responsive y accesibilidad

### E.1 Instalacion como PWA
**Que hacer**
```powershell
npm run build
npm run preview
```
Abre `http://localhost:4173` en Chrome o Edge. En la barra de direcciones pulsa el icono de **instalar**
(o menu del navegador > "Instalar aplicacion").
**OK**: la app se instala y se abre en **ventana propia** (sin barra de direcciones), con su icono. Al
cerrar la red y reabrir, sigue funcionando (offline).
**Si falla**: la instalacion requiere `https` o `localhost`; por eso se prueba en `localhost:4173`, no
por IP de red. Si no aparece el icono, recarga y comprueba en DevTools > Application > Manifest que el
manifest y el service worker estan "activated".

### E.2 Movil fisico (360px) y responsive
**Que hacer (opcion A, movil real)**
```powershell
npm run dev -- --host
```
Vite mostrara una URL "Network" tipo `http://192.168.x.x:5173`. Abrela desde tu movil conectado a la
**misma wifi**.
**Que hacer (opcion B, emulado)**: en Chrome/Edge, DevTools (F12) > icono de dispositivo (Toggle device
toolbar) > pon el ancho en **360 px**.
**OK**: la interfaz se ve comoda, sin desbordes horizontales ni texto cortado; la navegacion es usable
con el pulgar; a 360px todo entra sin scroll horizontal.
**Si falla**: anota la pantalla concreta que desborda a 360px. Nota: por IP de red (opcion A) el
navegador no registra el service worker (requiere https o localhost), asi que offline/instalacion se
prueban en E.1; por LAN solo pruebas la interfaz y los flujos.

### E.3 Accesibilidad
**Que hacer**
1. **Teclado**: navega una pantalla clave (p. ej. crear movimiento) solo con `Tab` / `Shift+Tab` /
   `Enter` / `Esc`. Comprueba que el foco es visible y que puedes completar la accion sin raton.
2. **Lector de pantalla**: activa Narrador (Windows: `Ctrl+Win+Enter`), NVDA o VoiceOver y recorre la
   pantalla; los botones y campos deben anunciarse con un nombre util.
3. **Lighthouse**: Chrome DevTools > pestana **Lighthouse** > marca "Accessibility" > "Analyze page
   load". Revisa la puntuacion y las incidencias.
4. **Color**: alterna tema claro/oscuro (Ajustes) y comprueba contraste; en los graficos, la identidad
   de cada serie no depende solo del color (hay etiqueta/forma).

**OK**: puedes operar por teclado con foco visible; el lector anuncia controles con nombre; Lighthouse
sin errores graves de accesibilidad.
**Si falla**: apunta el control sin nombre accesible o el contraste insuficiente y la pantalla donde
ocurre.

---

## F. Exportaciones y backup (recomendado, cierra el ciclo de "tus datos son tuyos")

**Que hacer**
1. **Ajustes > Exportar**: descarga el Excel completo y el del dashboard; abrelos en Excel/LibreOffice.
2. **Backup**: descarga el backup JSON del perfil.
3. **Restauracion**: crea un **perfil nuevo desde el backup** (modo "crear perfil", no sobrescribir) y
   compara que los movimientos y saldos coinciden.

**OK**: las cifras del Excel coinciden con lo que ves en pantalla; el perfil restaurado desde el backup
es identico al original (mismos movimientos, saldos y categorias).
**Si falla**: si al restaurar falta algo o cambian importes, guarda el JSON y avisa.

---

## Registro de resultados (rellena a mano)

| # | Prueba | Resultado (OK / FALLA) | Notas |
|---|--------|------------------------|-------|
| A | `.env.local` y pantalla Cuenta configurada | | |
| B.1 | Registro + verificacion email | | |
| B.2 | Login / logout | | |
| B.3 | Recuperacion de contrasena | | |
| C | RLS (pgTAP y/o dos usuarios + anonimo) | | |
| D.1 | Migracion local -> cuenta | | |
| D.2 | Dispositivo nuevo (reconstruccion) | | |
| D.3 | PIN, auto-bloqueo, sesion cifrada | | |
| D.4 | Passkeys (si aplica) | | |
| E.1 | Instalacion PWA + offline | | |
| E.2 | Responsive 360px / movil | | |
| E.3 | Accesibilidad (teclado, lector, Lighthouse) | | |
| F | Exportaciones y backup/restauracion | | |

Cuando todas esten en OK, la ampliacion queda validada de extremo a extremo tambien en tu entorno real.

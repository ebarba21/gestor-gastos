# Puesta en marcha: PC, iPhone y varios usuarios

URL de la app: **https://ebarba21.github.io/gestor-gastos/**

La app se publica sola en GitHub Pages cada vez que se hace push a `main`
(`.github/workflows/deploy.yml`). Antes de publicar se ejecutan los tests y el build: si algo
falla, no se publica y la version anterior sigue en linea.

## 1. Configuracion unica (ya hecha, aqui solo para referencia)

| Donde | Que | Valor |
| --- | --- | --- |
| GitHub > Settings > Pages | Source | GitHub Actions |
| Supabase > Authentication > URL Configuration | Site URL | `https://ebarba21.github.io/gestor-gastos/` |
| Supabase > Authentication > URL Configuration | Redirect URLs | `https://ebarba21.github.io/gestor-gastos/**` |
| Supabase > Authentication > Sign In / Providers > Email | Confirm email | Desactivado (ver punto 4) |

La URL del proyecto Supabase y la clave publicable van en el workflow. Ambas son publicas por
diseno (acaban en el JavaScript del navegador) y sin sesion no dan acceso a ningun dato: lo
impide RLS. Nunca se pone la clave `service_role` en el repo ni en variables `VITE_*`.

Para apuntar a otro proyecto Supabase sin tocar el codigo: GitHub > Settings > Secrets and
variables > Actions > Variables > `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.

## 2. Instalar la app

**iPhone (Safari, no Chrome):** abre la URL > boton Compartir > "Anadir a pantalla de inicio".
Se abre a pantalla completa como una app, con navegacion inferior. Instalada asi, iOS no borra
los datos locales aunque pases dias sin abrirla (en una pestana normal de Safari si podria).

**PC (Chrome o Edge):** abre la URL > icono de instalar en la barra de direcciones.

Funciona sin conexion una vez abierta por primera vez.

## 3. Primer uso (cada persona, en su propio dispositivo)

1. Crea un perfil (p. ej. con tu nombre).
2. Ve a **Cuenta** > Registrarse con email y contrasena. Desde ese momento tus datos se copian
   a tu cuenta privada y puedes usarlos en tus otros dispositivos.
3. En el segundo dispositivo (p. ej. el iPhone): instala la app, ve a **Cuenta** e inicia
   sesion con el mismo email. La app reconstruye tus perfiles y movimientos desde la nube.
4. Opcional: **Ajustes > Seguridad** para poner un PIN de bloqueo.

Cada cuenta solo ve sus propios datos (RLS en todas las tablas). Varias personas pueden usar
el mismo PC: cada una con su cuenta, y la app no muestra los perfiles de otra cuenta.

## 4. Registro libre de usuarios

Con **Confirm email** desactivado, cualquiera con la URL puede registrarse y entra al momento.
Es lo practico para un grupo pequeno: el correo gratuito de Supabase solo envia emails de
confirmacion a los miembros del equipo del proyecto, asi que con la confirmacion activada los
demas usuarios nunca recibirian el enlace.

Consecuencias a tener en cuenta:

- No hay recuperacion de contrasena por email. Si alguien la olvida: Supabase > Authentication
  > Users > el usuario > "Send password recovery" no llegara; lo practico es borrar el usuario y
  que se registre de nuevo (antes, que exporte un backup desde su dispositivo), o configurar
  SMTP propio.
- Para recuperar los emails (confirmacion y contrasena olvidada): Supabase > Authentication >
  Emails > SMTP Settings con un proveedor propio (p. ej. una cuenta de Gmail con contrasena de
  aplicacion, `smtp.gmail.com`, puerto 465). Despues se puede volver a activar Confirm email.
- Plan gratuito de Supabase: el proyecto se pausa tras unos dias sin actividad. Si la app dice
  que no puede sincronizar, entra en el Dashboard y pulsa Restore. Los datos locales de cada
  dispositivo siguen intactos mientras tanto.

## 5. Cargar el historico desde un Excel exportado

El Excel que genera **Exportar > Movimientos** se puede convertir en un backup que conserva
categorias, subcategorias, cuentas, tipo, estado y exclusiones (la importacion bancaria normal
solo lee fecha, concepto e importe):

```bash
EXCEL=historico.xlsx SALIDA=backup.json PERFIL="Eric" \
  npx vitest run --config vitest.gen.config.ts scripts/excelABackup.gen.ts
```

El script valida que el numero de movimientos, la suma total, el saldo por cuenta y el reparto
por categoria del backup cuadran con el Excel antes de escribir el fichero.

Para cargarlo, **antes de registrarte** (con el perfil todavia local): crea el perfil >
**Exportar** > Restaurar un backup > elige el `.json` > **Sobrescribir este perfil**. Despues
ve a **Cuenta**, registrate y acepta el asistente de **Sincronizacion**, que sube el perfil
completo a tu cuenta y valida los recuentos.

Si ya tenias sesion iniciada, usa **Crear perfil nuevo** al restaurar y vincula ese perfil
desde **Sincronizacion**. La app no deja sobrescribir un perfil que ya esta sincronizado,
porque la copia de la nube quedaria desalineada.

Notas: las cuentas se crean con saldo inicial 0 (ajustalo en **Cuentas** para que el saldo
coincida con el del banco) y las reglas de autocategorizacion no viajan en el Excel.

## 6. Actualizar la app

Cualquier push a `main` publica una nueva version. Las apps instaladas muestran un aviso
"Nueva version disponible" y se actualizan al aceptarlo.

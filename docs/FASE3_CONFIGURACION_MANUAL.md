# Fase 3: configuracion manual pendiente (passkeys)

Este documento recoge los pasos que NO se pueden aplicar por migracion SQL ni por el MCP de
Supabase (son ajustes del servicio de Auth, no del esquema de Postgres) y que un humano con
acceso al Dashboard debe completar antes de activar `VITE_ENABLE_PASSKEYS=true` en produccion.

Proyecto de referencia (entorno de desarrollo, sin datos reales): `skwhlbwpnsdgmdsfozcr`.

## Por que hace falta un paso manual

Los passkeys (WebAuthn) de Supabase Auth son una integracion **experimental** del SDK
(`@supabase/supabase-js` >= 2.105.0). Requieren:

1. Activar la funcion en el proyecto (Dashboard o Management API), indicando el **Relying
   Party** (dominio) contra el que se registran las credenciales.
2. Opt-in explicito en el cliente (`auth.experimental.passkey: true`), que en este repo se activa
   automaticamente cuando `VITE_ENABLE_PASSKEYS=true` (ver `src/lib/supabase/client.ts` y
   `src/lib/supabase/env.ts`).

Ninguno de los dos pasos es DDL de Postgres, por eso no hay migracion en `supabase/migrations/`
para esta fase (confirmado: `list_tables`/`list_migrations` del proyecto no cambian con esta
fase; las estructuras nuevas de Fase 3 -- `DeviceSecurity`, `EncryptedSession`,
`WebAuthnCredentialRef` -- son device-local en Dexie, nunca tablas remotas).

## Pasos en el Dashboard

1. Abrir **Authentication > Passkeys** en el proyecto `skwhlbwpnsdgmdsfozcr`.
2. Activar **Enable Passkey authentication**.
3. Rellenar:
   - **Relying Party Display Name**: nombre legible mostrado en el dialogo del autenticador (p.
     ej. "Gestor de Gastos").
   - **Relying Party ID**: dominio pelado de la app en produccion (sin esquema, puerto ni ruta;
     p. ej. `tu-dominio.example`). En desarrollo local, `localhost`/`127.0.0.1` son validos.
   - **Relying Party Origins**: lista de origenes permitidos, separados por coma (hasta 5), p.
     ej. `https://tu-dominio.example`. Cada origen debe coincidir o ser subdominio del Relying
     Party ID. HTTPS es obligatorio salvo direcciones loopback.
4. Guardar. El Dashboard precarga estos valores a partir de la Site URL del proyecto; revisarlos
   si la app se sirve desde un dominio distinto.

**Aviso critico**: cambiar el Relying Party ID despues de que haya usuarios con passkeys
registrados invalida TODAS esas credenciales (tendran que registrar una nueva). Elegir el valor
con cuidado antes de que nadie use la funcion, y no cambiarlo despues salvo migracion planificada.

### Alternativa: Management API

Los mismos valores se pueden leer/escribir con la Management API de Supabase (requiere un token
de acceso personal, fuera del cliente/frontend):

```bash
export SUPABASE_ACCESS_TOKEN="tu-token-personal"
export PROJECT_REF="skwhlbwpnsdgmdsfozcr"

# Leer la configuracion actual
curl -X GET "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  | jq '{passkey_enabled, webauthn_rp_id, webauthn_rp_display_name, webauthn_rp_origins}'

# Activar passkeys
curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "passkey_enabled": true,
    "webauthn_rp_display_name": "Gestor de Gastos",
    "webauthn_rp_id": "tu-dominio.example",
    "webauthn_rp_origins": "https://tu-dominio.example"
  }'
```

No usar `service_role` para esto: el token de acceso de Management API es personal, de un
administrador del proyecto, y nunca debe llegar al frontend ni al repositorio.

## Despues de configurar el Dashboard

1. Poner `VITE_ENABLE_PASSKEYS=true` en el `.env.local` (o variable de entorno del hosting) SOLO
   cuando los tres campos anteriores esten confirmados.
2. Probar registro (`Ajustes > Seguridad > Passkeys > Registrar un passkey`) y desbloqueo desde la
   pantalla bloqueada con una cuenta de prueba, en el dominio real (WebAuthn ata las credenciales
   al origen exacto).
3. Confirmar que, con el flag en `false` (valor por defecto del repo), la seccion de passkeys no
   aparece y nada toca `navigator.credentials` (cubierto por `src/security/webauthn.test.ts`).

## Estado actual de este repo

- `VITE_ENABLE_PASSKEYS` no esta definido en `.env.example` con valor real (queda en `false` por
  defecto, ver el propio `.env.example`).
- El Dashboard del proyecto `skwhlbwpnsdgmdsfozcr` (entorno de desarrollo) **no se ha modificado**
  como parte de esta fase: los passkeys siguen desactivados hasta que alguien complete los pasos
  de este documento de forma deliberada.
- Contrasena de cuenta y PIN local siguen siendo la via de acceso principal en todos los casos;
  los passkeys son siempre un metodo adicional, nunca el unico (invariante de la fase).

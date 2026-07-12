---
description: Auditoria de coste y ausencia de dependencias de pago innecesarias
---

Audita la app desde el punto de vista de coste. Modelo vigente (ver `CLAUDE.md` y `specs/CLOUD_SYNC_SECURITY.md`): las funciones esenciales no requieren APIs de pago y operan sin cuenta y sin red; la sincronizacion es OPCIONAL y usa Supabase dentro de su plan gratuito actual. No se promete "coste cero perpetuo": los limites y precios los fija el proveedor.

Comprueba:

1. Dependencias instaladas (revisa package.json completo, incluidas devDependencies) y si alguna requiere pago obligatorio para funciones esenciales.
2. Servicios externos usados: solo se admite el proyecto Supabase del propio usuario (persistencia remota opcional). Cualquier otro servicio externo es un hallazgo.
3. Llamadas de red (busca fetch, axios, XMLHttpRequest, WebSocket, navigator.sendBeacon en src/): solo deben ir a assets propios o al endpoint de Supabase (`VITE_SUPABASE_URL`, desde variable de entorno).
4. APIs externas de pago o que condicionen funciones esenciales: no deben existir. Sin IA externa. Sin `service_role` en el frontend.
5. Hosting necesario: la app es estatica (hosting gratuito o el propio dispositivo). Supabase solo es necesario si el usuario activa la sincronizacion.
6. Base de datos: IndexedDB local es la base operativa; Supabase es copia remota opcional.
7. Autenticacion: Supabase Auth es OPCIONAL; la app debe funcionar en modo local sin cuenta.
8. Analytics y telemetria (incluida la de dependencias de terceros): prohibidas.
9. Funcionalidades esenciales que dependan de free tiers de forma que dejen de funcionar al superarlos: no debe haberlas (la sincronizacion puede degradarse, pero el modo local nunca deja de funcionar gratis).
10. Textos: que no prometan "coste cero para siempre" ni "gratis para siempre"; deben describir el modelo real.

Entrega un veredicto final claro: CUMPLE o NO CUMPLE, con la lista de hallazgos. Si detectas una dependencia de pago innecesaria para lo esencial, o una llamada a un dominio que no sea asset propio ni el Supabase del usuario, propon alternativa local-first o su eliminacion.

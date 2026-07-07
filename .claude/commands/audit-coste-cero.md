---
description: Auditoria de coste 0 euros y ausencia de dependencias externas
---

Audita la app desde el punto de vista de coste 0 euros.

Comprueba:

1. Dependencias instaladas (revisa package.json completo, incluidas devDependencies).
2. Servicios externos usados.
3. Llamadas de red (busca fetch, axios, XMLHttpRequest, WebSocket, navigator.sendBeacon en src/).
4. APIs externas.
5. Hosting necesario para que la app funcione.
6. Base de datos (debe ser solo IndexedDB local).
7. Autenticacion (no debe existir auth cloud).
8. Analytics.
9. Telemetria (incluida la de dependencias de terceros).
10. Funcionalidades que dependan de free tiers.

La app debe poder funcionar sin pagar nada y sin depender de proveedores que puedan requerir pago para funcionalidad esencial.

Si detectas algo que pueda generar coste o enviar datos fuera del dispositivo, propon alternativa local-first o elimina esa dependencia. Entrega un veredicto final claro: CUMPLE o NO CUMPLE, con la lista de hallazgos.

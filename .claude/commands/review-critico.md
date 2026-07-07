---
description: Revision critica de la ultima implementacion (no asumir que esta bien)
---

Revisa la implementacion anterior con criterio critico. No asumas que esta bien.

Comprueba:

1. Si cumple exactamente el requisito.
2. Si rompe otra funcionalidad.
3. Si mezcla logica de negocio con UI.
4. Si hay casos borde sin cubrir.
5. Si hay validaciones ausentes.
6. Si hay errores silenciosos.
7. Si la solucion escala con muchos movimientos (decenas de miles).
8. Si el codigo es mantenible.
9. Si funciona en PC y movil.
10. Si mantiene datos separados por profileId.
11. Si introduce alguna dependencia de pago o externa innecesaria.
12. Si compromete la privacidad local.

Ejecuta los tests (npm run test) y el typecheck (npx tsc --noEmit) como parte de la revision.

Despues corrige lo que encuentres y explica que has cambiado. Si no encuentras problemas, justifica por que cada punto esta cubierto, senalando el codigo concreto.

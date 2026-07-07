---
description: Auditoria de calculos financieros
argument-hint: funcionalidad o modulo a auditar (opcional, por defecto toda la app)
---

Audita todos los calculos financieros relacionados con: $ARGUMENTS

Si no se indica ambito, audita toda la logica de calculo de la app (services de estadisticas, dashboard, presupuestos y exportaciones).

Comprueba:

1. Signos de importes positivos y negativos.
2. Diferencia entre ingresos y gastos.
3. Que las transferencias internas quedan excluidas de estadisticas.
4. Que los movimientos marcados como excluidos no computan.
5. Tratamiento correcto de reembolsos.
6. Tratamiento correcto de movimientos divididos.
7. Periodos de fechas (limites inclusivos/exclusivos, zonas horarias, cambio de mes y de ano).
8. Redondeos (importes en centimos como enteros, conversion a euros solo en presentacion).
9. Moneda.
10. Casos con datos vacios (sin movimientos, sin categorias, periodo sin datos).
11. Filtrado por profileId en cada calculo.
12. Que el dashboard no mezcla perfiles.
13. Que las exportaciones reflejan exactamente los mismos calculos que la interfaz.

No cambies la logica sin explicar antes que problema has encontrado. Para cada problema: describe el caso concreto que falla, propon la correccion, y anade un test que lo cubra.

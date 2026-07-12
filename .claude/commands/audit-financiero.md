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
8. Redondeos (importes en centimos como enteros, tipos de interes en micro-fraccion 1e-6, conversion a euros/porcentaje solo en presentacion). Half-up una vez por magnitud; repartos que cuadran exactamente; en deudas sin pre-dividir la tasa por 12 como entero (BigInt intermedio, redondeo final). Ver `specs/FINANCIAL_ALGORITHMS.md`.
9. Moneda.
10. Casos con datos vacios y limite (sin movimientos, sin categorias, periodo sin datos, interes 0, cuota insuficiente, ultimo pago, poco historico).
11. Filtrado por profileId (y ownerUserId con cuenta) en cada calculo.
12. Que el dashboard no mezcla perfiles ni usuarios.
13. Que las exportaciones reflejan exactamente los mismos calculos que la interfaz.
14. Modulos de la ampliacion, si aplican al ambito: duplicados con niveles de confianza (sin borrar ni duplicar dinero; pending-confirmed sin doble conteo), conciliacion, recurrencias y forecast por rango (exclusiones correctas, sin duplicar recurrentes ya cobrados), deudas (calendario, amortizacion, Snowball/Avalanche deterministas, vinculacion de pagos sin doble conteo). Contrasta contra los fixtures de control.
15. Integridad bajo sincronizacion/migracion/restauracion: sin perdida, duplicacion, mezcla ni sobrescritura silenciosa; mutaciones idempotentes.

No cambies la logica sin explicar antes que problema has encontrado. Para cada problema: describe el caso concreto que falla, propon la correccion, y anade un test que lo cubra.

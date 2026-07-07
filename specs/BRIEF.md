# BRIEF: requisitos completos del gestor de gastos

Este documento es la fuente de requisitos original. A partir de el se generan PRD.md, ARCHITECTURE.md y DATA_MODEL.md.

## Criterio de arquitectura

- PWA responsive, usable e instalable en PC y movil.
- Coste 0 euros en todo momento: sin backend obligatorio, sin APIs de pago, sin BBDD cloud de pago, sin auth cloud de pago, sin IA externa, sin suscripciones.
- Local-first y client-side: React + TypeScript + Vite, Tailwind, IndexedDB con Dexie, SheetJS, Recharts, Vitest, PWA con service worker y manifest.
- Sincronizacion entre dispositivos: fuera del MVP. Cada dispositivo tiene sus datos locales. Exportar/importar backups para mover datos manualmente entre PC y movil.
- Privacidad multiusuario: perfiles locales separados dentro de la app. Cada perfil solo ve sus datos. Sin vista global entre perfiles salvo autorizacion expresa. Arquitectura preparada para cifrado local con contrasena (implementacion en fase 2).

## Funcionalidades del MVP

1. Crear perfiles locales de usuario.
2. Cambiar entre perfiles locales.
3. Separacion completa de datos por perfil (profileId en todo).
4. Importar movimientos desde CSV y XLSX.
5. Mapeo manual de columnas del archivo importado a campos internos.
6. Plantillas de importacion reutilizables.
7. Previsualizacion de movimientos antes de importar.
8. Deteccion de posibles duplicados antes de importar.
9. CRUD individual de movimientos.
10. Edicion y borrado masivo de movimientos.
11. Filtrar, buscar y ordenar por fecha, concepto, categoria, subcategoria, cuenta, importe, tipo, etiquetas y estado.
12. Categorias, subcategorias y etiquetas.
13. Cuentas o fuentes: banco principal, tarjeta, efectivo, PayPal, cuenta conjunta, etc.
14. Reglas de autocategorizacion basadas en condiciones.
15. Condiciones de reglas: contiene texto, no contiene, empieza por, termina en, coincide exactamente, regex opcional, importe mayor que, importe menor que, rango de fechas, cuenta concreta, tipo de movimiento, prioridad.
16. Importacion de reglas desde CSV o XLSX.
17. Aplicacion automatica de reglas a movimientos nuevos.
18. Aplicacion retroactiva de reglas a movimientos antiguos.
19. Cada movimiento registra si fue categorizado manualmente o por regla.
20. Simulacion de reglas antes de aplicarlas (cuantos movimientos afectaria).
21. Presupuestos o metas por categoria, subcategoria, cuenta y periodo.
22. Evaluacion de gastos e ingresos respecto a metas.
23. Dashboard con graficos y tablas.
24. Metricas del dashboard: gasto por categoria, evolucion mensual, ingresos vs gastos, ahorro neto, tasa de ahorro, top gastos, gastos recurrentes, comparativa contra promedio, forecast de cierre de mes.
25. Exportar datos a Excel.
26. Exportar: movimientos filtrados, todos los movimientos, reglas, categorias, cuentas, metas y dashboard.
27. Backups y restauracion.
28. Backups por perfil.
29. Movimientos especiales: transferencias internas, reembolsos, movimientos divididos, movimientos excluidos de estadisticas.
30. UX clara, rapida y segura. Usabilidad por encima de decoracion.

## Requisitos no funcionales

- Rendimiento fluido con decenas de miles de movimientos (virtualizacion de listas si hace falta).
- Funcionamiento offline completo.
- Confirmacion previa en acciones destructivas o masivas.
- Acciones criticas con posibilidad de deshacer donde sea razonable.
- Sin llamadas de red innecesarias. Sin telemetria.
- Importes en centimos (enteros). Moneda por defecto EUR.

## Navegacion minima

1. Selector o gestor de perfil.
2. Dashboard.
3. Movimientos.
4. Importar datos.
5. Reglas.
6. Categorias.
7. Cuentas.
8. Presupuestos y metas.
9. Exportaciones.
10. Ajustes.

## Fase 2 (fuera del MVP, pero disenar sin bloquearlo)

1. Movimientos recurrentes avanzados.
2. Reembolsos avanzados.
3. Splits avanzados.
4. Transferencias internas inteligentes.
5. Forecast avanzado.
6. Cifrado local real con Web Crypto.
7. App desktop con Tauri.
8. Sincronizacion cloud opcional.
9. Autohosting opcional.
10. Multiusuario cloud real.

## Criterio final de orden

1. Primero modelo de datos.
2. Despues perfiles y aislamiento.
3. Despues importacion.
4. Despues reglas.
5. Despues dashboard.
6. Despues exportaciones y backups.
7. Despues PWA, responsive y pulido.

Si el dashboard se construye antes de resolver como se categoriza, excluye, divide, reembolsa o separa por perfil un movimiento, los graficos daran datos poco fiables.

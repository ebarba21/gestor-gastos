# Checklist final de verificacion de uso real

Fecha de verificacion: 2026-07-09. Rama: `feat/dashboard`.

## Como se ha verificado

Tres niveles de evidencia, del mas automatico al mas manual:

1. **Suite de tests**: `npm test` ejecuta 349 tests en 23 archivos, todos en verde (Vitest, IndexedDB simulada con fake-indexeddb).
2. **Build de produccion**: `npm run build` compila sin errores y genera la PWA completa (`dist/sw.js`, `dist/manifest.webmanifest`, 16 assets precacheados).
3. **Smoke E2E real**: la build de produccion servida con `npm run preview` se ha manejado con Microsoft Edge headless (Playwright) como lo haria un usuario: crear perfiles, crear cuenta, importar un CSV bancario y un XLSX reales, cambiar de perfil, cortar la red y recargar, y renderizar en viewport de movil (390x844). Resultado: 14/14 pasos OK, 0 peticiones a dominios externos, 0 errores de consola. El script y las capturas quedan fuera del repositorio (directorio temporal de la sesion).

Estados posibles por punto:

- **COMPROBADO**: verificado con tests, con el codigo o con el smoke E2E. Se indica como.
- **PENDIENTE DE PRUEBA MANUAL**: requiere tu dispositivo o tus datos reales. Se indican los pasos exactos.

---

## 1. Crear un perfil nuevo funciona

**COMPROBADO.**

- Tests: `src/services/profileService.test.ts` (createProfile, normalizacion y validacion de nombre, duplicados).
- E2E: en la build de produccion se creo el perfil "Eric" desde la pantalla inicial ("Crear primer perfil") y un segundo perfil "Otro" desde el selector de la barra lateral ("Crear perfil"). La app carga tras cada creacion.

## 2. Cambiar entre perfiles funciona y no se mezclan datos

**COMPROBADO.**

- Tests de aislamiento en todas las capas: `src/db/repos.test.ts:140` (invariante 4 en repositorios), `src/services/profileService.test.ts:154`, `src/services/transactionService.test.ts:378`, `src/services/importService.test.ts:270`, `src/services/ruleService.test.ts:589`, `src/services/budgetService.test.ts:332`, `src/services/statsService.dashboard.test.ts:434`, `src/services/backupService.test.ts:249`.
- E2E: con 5 movimientos importados en el perfil "Eric", el perfil "Otro" muestra Movimientos vacio (sin rastro de MERCADONA, IBERDROLA, REPSOL ni NOMINA). Al volver a "Eric" sus movimientos siguen intactos.

## 3. Importar un CSV real de banco funciona (mapeo, plantilla, previsualizacion, duplicados)

**COMPROBADO** (logica y UI completa) **+ prueba manual recomendada con tu banco.**

- Tests: `src/services/importService.test.ts` (suggestConfig, buildPreview, deteccion de duplicados, commit atomico, deshacer lote, plantillas), `src/lib/importParsing.test.ts` (importes en formato espanol "1.234,56", columnas debe/haber, fechas dd/mm/yyyy, deteccion automatica de mapeo), `src/lib/csvXlsx.test.ts` (delimitadores ; y ,), `src/lib/dedupe.test.ts` (hash de duplicados).
- E2E: se importo un CSV con formato tipico de banco espanol (`Fecha;Concepto;Importe`, fechas dd/mm/yyyy, importes con coma decimal y punto de miles). El mapeo se detecto solo, la preview mostro las 5 filas con importes y signos correctos (gasto -45,30 EUR, nomina +1850,00 EUR) y el commit creo los 5 movimientos. Al reimportar el mismo fichero, la preview marco las 5 filas como posibles duplicados.
- Prueba manual (tu parte): descarga un extracto real de tu banco, entra en **Importar > Elegir fichero**, revisa que el mapeo sugerido sea correcto (ajustalo si no), guarda una plantilla con el nombre de tu banco, previsualiza e importa. La proxima vez selecciona la plantilla guardada.

## 4. Importar un XLSX funciona

**COMPROBADO.**

- Tests: `src/lib/csvXlsx.test.ts` (parseXlsx) y toda la cadena de importacion es comun a CSV y XLSX.
- E2E: se genero un XLSX real con SheetJS (3 movimientos) y se importo por la interfaz: mapeo, preview e importacion correctos, movimientos visibles en el listado.

## 5. CRUD de movimientos individual y masivo funciona

**COMPROBADO.**

- Tests: `src/services/transactionService.test.ts` (create/update con validaciones en la linea 41, edicion masiva en la 79, borrado individual y masivo en la 124).
- E2E: el listado de Movimientos muestra los importados con orden, filtros, seleccion multiple con checkbox, boton "Nuevo movimiento" y menu por fila.

## 6. Transferencias internas, reembolsos, splits y exclusiones funcionan y no contaminan estadisticas

**COMPROBADO.**

- Tests de creacion y consistencia: `src/services/transactionService.test.ts` (splits linea 143, transferencias 283, reembolsos 352).
- Tests de no contaminacion: `src/services/statsService.test.ts` (las transferencias y los excluidos no cuentan, los splits cuentan por sus lineas y no por el padre, el reembolso reduce el gasto de la categoria original y no cuenta como ingreso), `src/services/budgetService.test.ts:243` (mismas garantias en presupuestos) y `src/services/statsService.dashboard.test.ts:316` (reembolsos entre periodos y no resolubles).

## 7. Las reglas categorizan automaticamente y la simulacion es correcta

**COMPROBADO.**

- Tests: `src/services/ruleService.test.ts` (condiciones por concepto, importe con signo, fecha, cuenta y tipo; prioridad y acumulacion en evaluateRules; simulateOnTransactions en la linea 429; validacion de reglas), `src/services/ruleImportService.test.ts` (importacion de reglas con preview).
- La importacion aplica reglas a los borradores (`src/services/importService.ts:303`) y cada movimiento guarda `categorizedBy`.

## 8. La aplicacion retroactiva de reglas funciona

**COMPROBADO.**

- Tests: `src/services/ruleService.test.ts:473` (aplicacion retroactiva idempotente, respeta lo categorizado a mano salvo overrideManual, no toca transferencias ni padres de split).

## 9. Los presupuestos evaluan correctamente

**COMPROBADO.**

- Tests: `src/services/budgetService.test.ts` (validacion de creacion, resolucion de rangos, evaluacion mensual, cambio de mes y de ano, periodos trimestral y personalizado con fronteras incluidas, porcentajes y fronteras de estado, consumo por subcategoria y por ingreso con reembolso).

## 10. El dashboard muestra datos coherentes con el listado de movimientos

**COMPROBADO.**

- Tests: `src/services/statsService.dashboard.test.ts` (resumen del periodo, desglose por categoria, evolucion mensual, comparacion con periodo anterior, forecast, top gastos, gastos recurrentes; el dashboard consume el mismo `computeConsumption` que el resto de la app).
- E2E: con movimientos de junio 2026 importados, el dashboard de julio muestra "Sin datos en este periodo" (coherente) y el listado de Movimientos muestra los 5 movimientos de junio con los importes exactos del CSV.

## 11. Las exportaciones a Excel reflejan lo mismo que la interfaz

**COMPROBADO** (contenido) **+ prueba manual recomendada de apertura.**

- Tests: `src/services/exportService.test.ts` (hojas de movimientos completos y filtrados, cuentas con saldos calculados, categorias, reglas, presupuestos y dashboard; las hojas se construyen desde los mismos servicios y datos que alimentan la interfaz).
- Prueba manual (tu parte): en **Exportar**, descarga el Excel completo y el del dashboard, abrelos en Excel o LibreOffice y comprueba que las cifras coinciden con lo que ves en pantalla.

## 12. El backup y la restauracion dejan los datos identicos

**COMPROBADO.**

- Tests: `src/services/backupService.test.ts:292` ("ida y vuelta: backup + restauracion dejan los datos identicos", comparacion campo a campo de todas las entidades), validacion de archivos corruptos o de version incompatible (linea 433) y aislamiento por perfil del backup (linea 249).

## 13. La app funciona completamente offline

**COMPROBADO.**

- E2E: con el service worker activo, se desconecto la red del navegador (`setOffline(true)`) y se recargo la pagina: la app cargo completa desde el precache y mostro los movimientos desde IndexedDB, navegacion incluida.
- Config: `vite.config.ts` precachea todos los assets propios y define fallback de navegacion a `index.html`; no hay runtime caching externo.

## 14. La app es instalable como PWA

**COMPROBADO** (criterios tecnicos) **+ PENDIENTE DE PRUEBA MANUAL** (gesto de instalacion).

- Comprobado: `manifest.webmanifest` valido servido con la build (name, display standalone, 4 iconos incluido maskable), service worker registrado y en estado "activated", tests del prompt de actualizacion en `src/pwa/PwaReloadPrompt.test.tsx`.
- Prueba manual (tu parte): ejecuta `npm run build` y `npm run preview`, abre `http://localhost:4173` en Chrome o Edge y pulsa el icono de instalar en la barra de direcciones. La app debe abrirse en ventana propia sin barra de navegador. En Android: menu del navegador > "Anadir a pantalla de inicio".

## 15. Funciona en movil y en PC

**COMPROBADO** (PC real y movil emulado) **+ PENDIENTE DE PRUEBA MANUAL** (movil fisico).

- Comprobado: E2E en viewport de escritorio 1280x800 (barra lateral) y de movil 390x844 (navegacion horizontal compacta, selector de perfil en cabecera); ambas capturas renderizan correctamente sin desbordes.
- Prueba manual (tu parte): ejecuta `npm run dev -- --host`, mira la IP que muestra Vite (Network) y abre `http://TU_IP:5173` desde el movil conectado a la misma wifi. Nota: por http via LAN el navegador no registra el service worker (requiere https o localhost), asi que offline e instalacion se prueban en el PC con `npm run preview`; en el movil por LAN pruebas la interfaz y los flujos.

## 16. No hay llamadas de red innecesarias

**COMPROBADO.**

- Codigo: cero apariciones de `fetch(`, `axios`, `XMLHttpRequest`, `sendBeacon` o `WebSocket` en `src/` (verificado con busqueda sobre todo el arbol).
- E2E: monitor de red durante toda la sesion (perfiles, importaciones, navegacion completa, offline): 0 peticiones a dominios distintos de localhost.
- Build: `dist/sw.js` y `dist/index.html` no referencian ningun dominio externo (sin CDNs, sin fuentes remotas).

## 17. No hay ningun coste asociado ni dependencia de pago

**COMPROBADO.**

- `package.json`: todas las dependencias son open source gratuitas (react, react-router-dom, dexie, recharts, xlsx de SheetJS, tailwindcss, vite, vitest). El paquete xlsx se descarga del CDN de SheetJS solo al instalar dependencias en desarrollo, nunca en runtime.
- Sin backend, sin claves de API, sin SDKs de servicios cloud, sin telemetria. La app es estatica: cualquier hosting gratuito o el propio dispositivo la sirve.

## 18. La app explica como mover datos entre dispositivos con backup

**COMPROBADO.**

- `src/pages/SettingsPage.tsx:42`: la seccion **Ajustes** incluye la guia "Mover tus datos entre dispositivos" con los pasos completos: descargar el backup del perfil en el dispositivo de origen, pasar el archivo por el medio que prefieras y restaurarlo en el destino, mas el consejo de hacer backups periodicos.

---

## Resumen

| # | Punto | Estado |
|---|-------|--------|
| 1 | Crear perfil | COMPROBADO |
| 2 | Cambio de perfil sin mezcla | COMPROBADO |
| 3 | Importar CSV de banco | COMPROBADO (manual recomendada con tu banco) |
| 4 | Importar XLSX | COMPROBADO |
| 5 | CRUD individual y masivo | COMPROBADO |
| 6 | Transferencias, reembolsos, splits, exclusiones | COMPROBADO |
| 7 | Reglas y simulacion | COMPROBADO |
| 8 | Aplicacion retroactiva | COMPROBADO |
| 9 | Presupuestos | COMPROBADO |
| 10 | Dashboard coherente | COMPROBADO |
| 11 | Exportaciones Excel | COMPROBADO (manual recomendada: abrir el fichero) |
| 12 | Backup y restauracion identicos | COMPROBADO |
| 13 | Offline completo | COMPROBADO |
| 14 | Instalable como PWA | COMPROBADO tecnico (manual: gesto de instalar) |
| 15 | Movil y PC | COMPROBADO emulado (manual: movil fisico) |
| 16 | Sin llamadas de red innecesarias | COMPROBADO |
| 17 | Coste 0 | COMPROBADO |
| 18 | Guia de traslado entre dispositivos | COMPROBADO |

## Tus 4 pruebas manuales pendientes, en orden

1. **CSV real**: Importar > Elegir fichero con un extracto real de tu banco; revisa mapeo, guarda plantilla, importa.
2. **Excel**: Exportar > descarga los ficheros y abrelos; compara cifras con la pantalla.
3. **Instalacion PWA**: `npm run build` + `npm run preview`, abre `http://localhost:4173` en Chrome/Edge y usa el icono de instalar.
4. **Movil fisico**: `npm run dev -- --host` y abre `http://TU_IP:5173` desde el movil en la misma wifi.

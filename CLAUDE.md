# Gestor de Gastos PWA (local-first, coste 0)

App de gestion de gastos personales. PWA responsive para PC y movil. Local-first. Multiusuario por perfiles locales. Coste 0 euros garantizado.

## INVARIANTES (nunca violar, bajo ninguna circunstancia)

1. Coste 0 euros: sin backend, sin APIs de pago, sin bases de datos cloud, sin autenticacion cloud, sin servicios de IA externos, sin suscripciones, sin free tiers de los que dependa funcionalidad esencial.
2. Local-first: todos los datos financieros se almacenan en IndexedDB del dispositivo. Ningun dato financiero sale del dispositivo, nunca.
3. Sin llamadas de red en runtime salvo los assets propios de la PWA (service worker). Prohibido fetch/axios/XMLHttpRequest hacia dominios externos.
4. Aislamiento por perfil: TODA query, calculo, exportacion y vista filtra por profileId. Ningun perfil puede ver datos de otro. No existe vista global entre perfiles salvo autorizacion expresa del usuario.
5. Sin telemetria ni analytics de ningun tipo.

## Stack (no cambiar sin autorizacion del usuario)

- React + TypeScript + Vite
- Tailwind CSS
- IndexedDB via Dexie
- SheetJS (xlsx) para importar/exportar CSV y XLSX
- Recharts para graficos
- Vitest para tests
- PWA: service worker + manifest (vite-plugin-pwa)

## Convenciones de codigo

- Importes monetarios siempre en centimos como enteros. Nunca floats para dinero.
- Logica de negocio en `src/services/`, separada de UI (`src/components/`, `src/pages/`).
- Acceso a datos solo a traves de repositorios en `src/db/`. Los componentes nunca tocan Dexie directamente.
- Cada repositorio recibe profileId de forma obligatoria (parametro requerido, no opcional).
- Cada funcionalidad nueva incluye tests en Vitest (minimo: logica de negocio y calculos).
- Cada movimiento guarda si fue categorizado manualmente o por regla (campo categorizedBy).
- Validaciones y manejo de errores explicitos. Sin errores silenciosos.
- Tipado estricto (strict: true en tsconfig). Sin any salvo justificacion comentada.
- Nunca usar el simbolo del guion largo en textos de UI, documentacion ni commits.

## Orden de construccion (respetar siempre)

1. Modelo de datos
2. Perfiles y aislamiento de datos
3. Importacion (CSV/XLSX, mapeo de columnas, plantillas, duplicados)
4. Reglas de autocategorizacion
5. Dashboard
6. Exportaciones y backups
7. PWA, responsive y pulido

Nunca implementar una fase posterior si la anterior no esta completa y con tests en verde.

## Flujo de trabajo obligatorio al implementar

1. Explica que vas a cambiar antes de tocar codigo.
2. Indica los archivos afectados.
3. Implementa el cambio.
4. Anade validaciones, manejo de errores y tests.
5. Revisa deuda tecnica y edge cases.
6. No rompas funcionalidad existente. Ejecuta los tests antes de dar por terminado.
7. Al terminar una funcionalidad, propon un commit con mensaje en formato conventional commits (feat:, fix:, docs:, chore:, test:, refactor:).

## Documentos de referencia

- `specs/BRIEF.md`: requisitos completos originales del usuario.
- `specs/PRD.md`: PRD del producto (generado en la sesion de planificacion).
- `specs/ARCHITECTURE.md`: arquitectura funcional.
- `specs/DATA_MODEL.md`: modelo de datos. Fuente de verdad de entidades y campos.

Antes de implementar cualquier funcionalidad, consulta estos documentos. Si una decision contradice los specs, avisa al usuario antes de continuar.

## Comandos y agentes disponibles

Slash commands: /review-critico, /new-feature, /fix-bug, /review-ux, /audit-financiero, /audit-coste-cero.
Subagentes: privacy-auditor (aislamiento y coste 0), finance-auditor (calculos financieros), code-reviewer (revision general).

Al terminar cada fase de construccion, ejecuta el subagente privacy-auditor y, si la fase toca calculos, tambien finance-auditor.

## Fuera del MVP (no implementar salvo peticion expresa)

Movimientos recurrentes avanzados, reembolsos avanzados, splits avanzados, transferencias internas inteligentes, forecast avanzado, cifrado local con Web Crypto (preparar arquitectura, no implementar), app desktop con Tauri, sincronizacion cloud, autohosting, multiusuario cloud real.

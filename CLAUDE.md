# Gestor de Gastos PWA (local-first, con sincronizacion privada opcional)

App de gestion de gastos personales. PWA responsive para PC y movil. Local-first. Multiusuario por perfiles locales. Sin APIs de pago para funciones esenciales; opera dentro de los limites gratuitos actuales del proveedor de sincronizacion.

Estado: la app funciona hoy 100% en local. Se esta ampliando (ver `specs/IMPLEMENTATION_ROADMAP.md`) para ofrecer, de forma OPCIONAL, una cuenta autenticada y sincronizacion privada entre dispositivos con Supabase, ademas de PIN, passkeys, comercios normalizados, duplicados avanzados, bandeja de revision, conciliacion, recurrencias, forecast y modulo de deudas. El modo local sin cuenta sigue siendo un ciudadano de primera clase.

## INVARIANTES LOCALES (nunca violar, bajo ninguna circunstancia)

1. Sin APIs de pago para funcionalidad esencial: sin servicios de IA externos y sin suscripciones obligatorias. La sincronizacion usa Supabase dentro de su plan gratuito actual; no se afirma "coste cero perpetuo" porque los limites y precios los fija el proveedor. Las funciones nucleo (registrar, importar, categorizar, analizar, exportar, backup) funcionan sin cuenta y sin red.
2. Local-first: IndexedDB (Dexie) es SIEMPRE la base operativa del dispositivo. La app lee y escribe primero en local y funciona offline. En modo local sin cuenta, ningun dato financiero sale del dispositivo. Con cuenta activada, solo los datos procesados sincronizados salen del dispositivo hacia Supabase (ver invariantes de nube).
3. Sin red externa no autorizada en runtime: prohibido fetch/axios/XMLHttpRequest hacia dominios externos salvo (a) los assets propios de la PWA servidos por el service worker y (b) el endpoint de Supabase del propio usuario cuando la cuenta esta activada. Ningun otro dominio. Sin CDNs, sin fuentes remotas, sin recursos de terceros.
4. Aislamiento por perfil y por propietario: TODA query, calculo, exportacion y vista filtra por profileId. Con cuenta, ademas por ownerUserId. Ningun perfil ni usuario puede ver datos de otro. No existe vista global entre perfiles salvo autorizacion expresa del usuario. El aislamiento se verifica en TODAS las capas (indices, repositorios locales, repositorios remotos y RLS), nunca solo en la UI.
5. Sin telemetria ni analytics de ningun tipo.

## INVARIANTES DE NUBE, SEGURIDAD Y SINCRONIZACION (aplican cuando hay cuenta)

Detalle completo en `specs/CLOUD_SYNC_SECURITY.md`. Nunca violar:

6. No usar floats para importes. Dinero siempre en centimos enteros. Tipos de interes siempre en representacion entera documentada (micro-fraccion 1e-6: fraccion anual x 1.000.000; p. ej. 3,25% = 0,0325 -> 32500).
7. No usar `service_role` ni ninguna clave de servicio en el frontend. Solo la clave publicable (`VITE_SUPABASE_PUBLISHABLE_KEY`, antes llamada "anon key") llega al cliente.
8. Toda tabla remota expuesta lleva Row Level Security (RLS) activo con politicas explicitas por SELECT/INSERT/UPDATE/DELETE. Un usuario anonimo no lee datos; nadie puede cambiar el propietario de una fila.
9. Ninguna query confia solo en filtros de UI. profileId y propietario se verifican en el repositorio local, en el repositorio remoto y en RLS.
10. Toda mutacion remota debe ser idempotente (mutationId unico en la cola de salida). Reenviar una mutacion no puede duplicar ni corromper datos.
11. Ningun conflicto financiero se resuelve en silencio. Movimientos, splits, transferencias, reembolsos, deudas y pagos generan un conflicto explicito que resuelve la persona. No se hace merge automatico campo a campo de importes.
12. No se pierde el concepto bancario original. `rawConcept` de un movimiento importado es inmutable; la normalizacion y la asociacion a comercio son datos anadidos, nunca sustituciones.
13. No se guardan PIN, contrasenas, tokens ni credenciales biometricas en texto plano. El PIN se deriva con Web Crypto (sal aleatoria, parametros versionados). La biometria la gestiona el sistema operativo via WebAuthn; la app nunca recibe datos biometricos.
14. No se afirma privacidad total ni coste cero perpetuo en ningun texto de UI, documentacion ni commit. Se describe con precision el modelo real (local-first + sincronizacion privada opcional protegida por Auth y RLS, sujeta a los limites del proveedor).
15. No se hace push si hay tests fallando, typecheck en rojo, build rota o hallazgos criticos abiertos. Los archivos bancarios originales no se suben por defecto: solo datos procesados y hashes.

## Stack (no cambiar sin autorizacion del usuario)

- React + TypeScript + Vite
- Tailwind CSS
- IndexedDB via Dexie
- SheetJS (xlsx) para importar/exportar CSV y XLSX
- Recharts para graficos
- Vitest para tests
- PWA: service worker + manifest (vite-plugin-pwa)

Ampliacion (sincronizacion opcional, ver roadmap):

- Supabase (Postgres + Auth + Row Level Security) como persistencia remota privada. Solo la clave publicable en frontend.
- WebAuthn del navegador para passkeys; Web Crypto para derivar el PIN y cifrar la sesion. Sin librerias de red adicionales.

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
- `specs/PRD.md`: PRD del producto (incluye la ampliacion cloud/seguridad/finanzas).
- `specs/ARCHITECTURE.md`: arquitectura funcional (local + remota + sincronizacion).
- `specs/DATA_MODEL.md`: modelo de datos. Fuente de verdad de entidades y campos (local y remoto).
- `specs/CLOUD_SYNC_SECURITY.md`: autenticacion, RLS, sincronizacion, PIN, passkeys, amenazas y recuperacion.
- `specs/FINANCIAL_ALGORITHMS.md`: invariantes y algoritmos financieros (duplicados, conciliacion, recurrencias, forecast, deudas, Snowball/Avalanche) y fixtures de control.
- `specs/IMPLEMENTATION_ROADMAP.md`: fases de la ampliacion, dependencias, migraciones, riesgos, rollback y criterios para no avanzar de fase.

Antes de implementar cualquier funcionalidad, consulta estos documentos. Si una decision contradice los specs, avisa al usuario antes de continuar.

## Comandos y agentes disponibles

Slash commands: /review-critico, /new-feature, /fix-bug, /review-ux, /audit-financiero, /audit-coste-cero.
Subagentes: privacy-auditor (aislamiento y coste 0), finance-auditor (calculos financieros), code-reviewer (revision general).

Al terminar cada fase de construccion, ejecuta el subagente privacy-auditor y, si la fase toca calculos, tambien finance-auditor.

## Ampliacion planificada (implementar solo en su fase del roadmap)

La ampliacion tiene orden y dependencias obligatorias (ver `specs/IMPLEMENTATION_ROADMAP.md`): Supabase + Auth + RLS -> sincronizacion local-first + migracion -> PIN/passkeys -> comercios normalizados -> duplicados avanzados -> bandeja de revision + conciliacion -> recurrencias + forecast -> deudas (Snowball/Avalanche). No se implementa una fase sin cerrar la anterior con tests en verde y auditorias sin hallazgos criticos.

## Fuera de alcance (no implementar salvo peticion expresa)

Perfiles compartidos entre cuentas, multiusuario cloud colaborativo en tiempo real, sincronizacion en tiempo real por defecto, subida automatica de extractos bancarios originales, cifrado extremo a extremo de la base remota, app desktop con Tauri, autohosting gestionado, asesoramiento financiero personalizado, prediccion de indices de tipos variables futuros.

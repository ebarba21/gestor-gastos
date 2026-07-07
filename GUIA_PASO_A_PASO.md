# Guia paso a paso: gestor de gastos con Claude Code en VS Code + GitHub

Sigue las fases en orden. No saltes ninguna. Los comandos se escriben en la terminal integrada de VS Code (se abre con Ctrl+` o desde el menu Terminal > New Terminal).

---

## FASE 0: instalar las herramientas (solo se hace una vez)

### 0.1 Instalar Git

1. Ve a https://git-scm.com/downloads y descarga el instalador para tu sistema (Windows en tu caso, probablemente).
2. Ejecuta el instalador. Acepta todas las opciones por defecto (siguiente, siguiente). En Windows esto instala tambien Git Bash, que Claude Code necesita.
3. Verifica: abre una terminal (en Windows: menu inicio, escribe "cmd", Enter) y ejecuta:
   ```
   git --version
   ```
   Debe responder algo como "git version 2.x.x".

### 0.2 Instalar Node.js

1. Ve a https://nodejs.org y descarga la version LTS.
2. Ejecuta el instalador con las opciones por defecto.
3. Verifica en una terminal NUEVA (cierra y abre otra):
   ```
   node -v
   npm -v
   ```
   Deben responder numeros de version (Node 20 o superior).

### 0.3 Instalar VS Code

1. Ve a https://code.visualstudio.com y descarga e instala.
2. Abrelo una vez para comprobar que funciona.

### 0.4 Crear cuenta de GitHub

1. Ve a https://github.com y crea una cuenta gratuita si no la tienes (Sign up). Apunta tu nombre de usuario, lo usaras despues.

### 0.5 Configurar tu identidad en Git

En cualquier terminal, ejecuta (con tus datos reales, el email debe ser el de tu cuenta de GitHub):

```
git config --global user.name "Eric Barba"
git config --global user.email "tu-email-de-github@ejemplo.com"
git config --global init.defaultBranch main
```

### 0.6 Instalar la extension de Claude Code en VS Code

1. Abre VS Code.
2. Pulsa Ctrl+Shift+X (vista de extensiones).
3. Busca "Claude Code". Instala la extension oficial publicada por Anthropic.
4. Aparecera un icono de chispa (spark) en la barra lateral izquierda. Haz clic en el.
5. Te pedira iniciar sesion. Elige "Claude.ai Subscription" (tu suscripcion de Claude), se abrira el navegador, pulsa Authorize y vuelve a VS Code. Ya estas autenticado.

Nota: la extension incluye su propia copia del CLI de Claude Code, no necesitas instalar nada mas para usarla desde el panel.

---

## FASE 1: crear el repositorio local con el setup

### 1.1 Crear la carpeta del proyecto

Crea una carpeta para el proyecto, por ejemplo:
- Windows: `C:\proyectos\gestor-gastos`
- Mac/Linux: `~/proyectos/gestor-gastos`

### 1.2 Copiar los archivos del setup

Descomprime el zip `gestor-gastos-setup.zip` y copia TODO su contenido a la raiz de la carpeta del proyecto. La estructura debe quedar asi:

```
gestor-gastos/
├── CLAUDE.md
├── GUIA_PASO_A_PASO.md
├── .gitignore
├── .claude/
│   ├── settings.json
│   ├── commands/        (6 comandos)
│   ├── agents/          (3 agentes)
│   └── hooks/
│       └── verificar.sh
└── specs/
    └── BRIEF.md
```

Importante: `.claude` y `.gitignore` empiezan por punto, son carpetas/archivos ocultos. Si al copiar no los ves, activa "ver archivos ocultos" en tu explorador de archivos (en Windows: pestana Vista > Elementos ocultos). Dentro de VS Code siempre son visibles.

### 1.3 Abrir la carpeta en VS Code

Menu File > Open Folder > selecciona `gestor-gastos`. Si pregunta si confias en los autores, di que si (eres tu).

### 1.4 Inicializar Git y hacer el primer commit

Abre la terminal integrada (Ctrl+`) y ejecuta, una linea cada vez:

```
git init
git add .
git commit -m "chore: setup inicial de Claude Code (CLAUDE.md, comandos, agentes, hooks, specs)"
```

Que hace cada comando: `git init` convierte la carpeta en repositorio, `git add .` marca todos los archivos para guardar, `git commit` guarda una foto del estado con un mensaje.

---

## FASE 2: conectar con GitHub (sincronizacion en la nube)

### 2.1 Crear el repositorio vacio en GitHub

1. Entra en https://github.com con tu cuenta.
2. Arriba a la derecha, boton "+" > "New repository".
3. Repository name: `gestor-gastos`.
4. Visibilidad: **Private** (es tu app de finanzas personales).
5. NO marques ninguna casilla de "Initialize this repository" (ni README, ni .gitignore, ni licencia). Debe crearse completamente vacio.
6. Pulsa "Create repository".

### 2.2 Conectar tu repo local con GitHub y subirlo

En la terminal de VS Code (sustituye TU_USUARIO por tu nombre de usuario de GitHub):

```
git remote add origin https://github.com/TU_USUARIO/gestor-gastos.git
git push -u origin main
```

La primera vez, Windows abrira una ventana de "Git Credential Manager" pidiendo iniciar sesion en GitHub por el navegador. Inicia sesion y autoriza. A partir de entonces queda guardado y no vuelve a pedirlo.

Verifica: recarga la pagina de tu repo en GitHub. Deben verse CLAUDE.md, specs/, .claude/, etc.

### 2.3 La rutina de sincronizacion (memorizala)

Cada vez que termines un bloque de trabajo:

```
git add .
git commit -m "mensaje describiendo el cambio"
git push
```

Tambien puedes pedirselo a Claude Code literalmente: "haz commit y push de los cambios con un mensaje adecuado". Con los permisos configurados te pedira confirmacion para el push, di que si.

Si algun dia trabajas desde otro ordenador, antes de empezar ejecuta `git pull` para bajar lo ultimo de GitHub.

---

## FASE 3: sesion de planificacion con Claude Code (Plan Mode)

Objetivo: generar el PRD, la arquitectura y el modelo de datos como archivos del repo. NADA de codigo todavia.

### 3.1 Abrir Claude Code

Haz clic en el icono de chispa en la barra lateral de VS Code (o Ctrl+Shift+P > "Claude Code: Open in New Tab").

### 3.2 Activar el modo Plan

En la parte inferior del cuadro de texto del chat hay un selector de modo (o pulsa Shift+Tab para alternar). Selecciona **Plan mode**. En este modo Claude propone un plan y no toca nada hasta que lo apruebes.

### 3.3 Pega este prompt exacto

```
Lee CLAUDE.md y specs/BRIEF.md. A partir de ellos genera tres documentos:

1. specs/PRD.md: PRD completo con objetivo, perfil de usuario, problemas que resuelve, funcionalidades imprescindibles y avanzadas, que queda fuera del MVP, casos de uso principales y secundarios, requisitos funcionales y no funcionales, requisitos de privacidad, responsive, PWA, coste 0, rendimiento, importacion, exportacion, sistema de reglas y dashboard, criterios de aceptacion, definicion del MVP y roadmap por fases.

2. specs/ARCHITECTURE.md: arquitectura funcional con modulos, responsabilidades, relaciones, flujos de datos, estados principales, estructura de carpetas de src/, navegacion por secciones, comportamiento offline, estrategia PWA, que acciones requieren confirmacion, cuales se pueden deshacer y como se garantiza el aislamiento por perfil.

3. specs/DATA_MODEL.md: modelo de datos completo para Dexie/IndexedDB con todas las entidades, campos, tipos, indices, relaciones y como se materializa el filtrado por profileId. Importes en centimos como enteros. Incluye el esquema de versionado de la base de datos para poder migrar en el futuro.

Se critico: si algo complica el MVP, muevelo a fase 2 pero explica como disenar ahora para no rehacer la arquitectura despues. No hagas preguntas salvo bloqueo real: toma decisiones razonables y explicalas brevemente.
```

### 3.4 Revisar y aprobar

Claude mostrara primero un plan. Leelo. Si estas de acuerdo, aprueba. Generara los tres archivos en specs/.

### 3.5 Revision tuya (paso critico)

Abre los tres archivos y leelos con calma, sobre todo DATA_MODEL.md: entidades, campos, como se separan los perfiles, como se modelan transferencias internas, splits, reembolsos y exclusiones. Todo lo que no te convenza, se lo dices en el chat y que lo corrija. Itera hasta que este bien. Todo lo demas se construye sobre esto.

### 3.6 Guardar en Git

```
git add .
git commit -m "docs: PRD, arquitectura y modelo de datos"
git push
```

---

## FASE 4: crear el esqueleto del proyecto (scaffolding)

### 4.1 Nueva conversacion limpia

En el chat de Claude Code escribe `/clear` (o abre una conversacion nueva). Empezar cada fase con contexto limpio evita que se degrade la calidad.

### 4.2 Cambia a modo normal (no Plan) y pega este prompt

```
Crea el esqueleto del proyecto segun specs/ARCHITECTURE.md:

1. Proyecto Vite con React y TypeScript en la raiz del repo (usa npm).
2. Instala y configura: Tailwind CSS, Dexie, xlsx (SheetJS), Recharts, Vitest con @testing-library/react, y vite-plugin-pwa (manifest y service worker basicos).
3. tsconfig con strict: true.
4. Estructura de carpetas de src/ segun la arquitectura (components, pages, services, db, etc.) con archivos indice vacios o minimos.
5. Script npm run test configurado y un test de ejemplo que pase.
6. La app debe arrancar con npm run dev mostrando una pantalla base con la navegacion principal vacia.

No implementes todavia ninguna funcionalidad de negocio. Al terminar, ejecuta npm run dev en segundo plano solo para verificar que compila, y npm run test.
```

### 4.3 Verificar tu mismo

En la terminal:

```
npm run dev
```

Abre http://localhost:5173 en el navegador. Debe verse la pantalla base. Para el servidor con Ctrl+C en la terminal.

### 4.4 Commit y push

```
git add .
git commit -m "chore: scaffolding Vite + React + TS + Tailwind + Dexie + PWA"
git push
```

---

## FASE 5: implementacion por fases

Orden obligatorio (esta en CLAUDE.md): 1 modelo de datos, 2 perfiles y aislamiento, 3 importacion, 4 reglas, 5 dashboard, 6 exportaciones y backups, 7 PWA/responsive/pulido.

### El ciclo que repites en CADA fase

1. `/clear` para empezar con contexto limpio.
2. Prompt de la fase (plantilla abajo).
3. Claude implementa. Revisa los diffs que te propone antes de aceptar (la extension te muestra cada cambio con botones de aceptar/rechazar).
4. Cuando diga que ha terminado, escribe: `/review-critico`
5. Despues escribe: `usa el subagente privacy-auditor para auditar esta fase` (y si la fase toca calculos: `usa el subagente finance-auditor`).
6. Si los auditores encuentran problemas, pidele que los corrija y repite el paso 5.
7. Prueba tu mismo la app con npm run dev. Toca todo lo nuevo.
8. Commit y push:
   ```
   git add .
   git commit -m "feat: <nombre de la fase>"
   git push
   ```

### Plantilla de prompt para cada fase

```
Implementa la fase <NUMERO Y NOMBRE> siguiendo specs/PRD.md, specs/ARCHITECTURE.md y specs/DATA_MODEL.md.

Alcance de esta fase: <pega aqui los puntos del BRIEF que correspondan a la fase>.

Recuerda los invariantes de CLAUDE.md. Incluye tests de toda la logica de negocio. No implementes nada de fases posteriores. Al terminar, ejecuta la suite completa de tests y el typecheck.
```

Ejemplo concreto para la fase 2:

```
Implementa la fase 2: perfiles y aislamiento de datos, siguiendo specs/PRD.md, specs/ARCHITECTURE.md y specs/DATA_MODEL.md.

Alcance: crear perfiles locales, cambiar entre perfiles, selector/gestor de perfil en la UI, y garantizar que toda la capa de datos exige profileId. Ningun perfil puede ver datos de otro. Sin vista global entre perfiles.

Recuerda los invariantes de CLAUDE.md. Incluye tests que demuestren el aislamiento (datos de un perfil no aparecen en queries de otro). Al terminar, ejecuta la suite completa y el typecheck.
```

---

## FASE 6: uso diario y mantenimiento

- Bug: escribe `/fix-bug` seguido de la descripcion. Ejemplo: `/fix-bug al importar un XLSX con fechas en formato dd/mm/yyyy los duplicados no se detectan`
- Funcionalidad nueva: `/new-feature` seguido de la descripcion.
- Mejorar una pantalla: `/review-ux movimientos` (o la pantalla que sea).
- Auditoria periodica: `/audit-coste-cero` y `/audit-financiero` de vez en cuando, y siempre antes de dar una version por buena.
- Revision antes de commits gordos: `usa el subagente code-reviewer`.
- Contexto: usa `/clear` al cambiar de tarea. Conversaciones eternas producen peores resultados.
- Sincronizacion: termina siempre la sesion con add + commit + push. GitHub es tu copia de seguridad.

## Como probar la app en el movil (sin coste)

Con el PC y el movil en la misma wifi:

```
npm run dev -- --host
```

La terminal mostrara una URL de red tipo http://192.168.1.XX:5173. Abrela desde el navegador del movil. Nota: la instalacion como PWA real requiere HTTPS; para eso, cuando la app este madura, puedes publicarla gratis en GitHub Pages (es hosting estatico gratuito y no rompe el coste 0; pidele a Claude Code que configure el deploy cuando llegues a la fase 7).

## Problemas tipicos

- "git no se reconoce como comando": cierra y vuelve a abrir VS Code (o el PC) tras instalar Git.
- El push pide credenciales cada vez: instala/actualiza Git for Windows, incluye Git Credential Manager.
- El hook falla con "bash no encontrado" en Windows: asegurate de que Git esta instalado (incluye bash) y reinicia VS Code.
- Claude no ve los comandos /: verifica que la carpeta .claude/commands esta en la raiz del proyecto abierto y reinicia la conversacion.

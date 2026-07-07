#!/usr/bin/env bash
# Hook PostToolUse: se ejecuta despues de cada edicion de archivos por Claude Code.
# 1) Bloquea llamadas de red introducidas en src/ (invariante coste 0 / privacidad).
# 2) Ejecuta el typecheck de TypeScript si el proyecto ya existe.
# Salida con codigo 2 = se bloquea y el mensaje de stderr vuelve a Claude para que lo corrija.

set -u

# Si el proyecto todavia no existe (fase de setup), no hacer nada.
if [ ! -f "package.json" ]; then
  exit 0
fi

# Asegura que node/npx esten disponibles aunque no esten en el PATH global
# (en Windows, instalacion estandar en "C:\Program Files\nodejs").
if ! command -v npx >/dev/null 2>&1; then
  for d in "/c/Program Files/nodejs" "/c/Program Files (x86)/nodejs" "$HOME/AppData/Local/Programs/nodejs"; do
    if [ -x "$d/npx" ] || [ -f "$d/npx.cmd" ]; then
      export PATH="$d:$PATH"
      break
    fi
  done
fi

# ---- 1. Guardia de red: sin fetch/axios/etc. en src/ ----
if [ -d "src" ]; then
  # Se permite el service worker (assets propios de la PWA).
  MATCHES=$(grep -rnE "fetch\(|axios|XMLHttpRequest|new WebSocket|sendBeacon|EventSource" src/ \
    --include="*.ts" --include="*.tsx" \
    | grep -v "sw.ts" | grep -v "service-worker" | grep -v "// coste0-ok" || true)
  if [ -n "$MATCHES" ]; then
    echo "VIOLACION DE INVARIANTE (coste 0 / privacidad): se han detectado posibles llamadas de red en src/:" >&2
    echo "$MATCHES" >&2
    echo "Elimina la llamada de red o, si es un falso positivo justificado, anade el comentario // coste0-ok en esa linea y explica el motivo al usuario." >&2
    exit 2
  fi
fi

# ---- 2. Typecheck (solo si hay dependencias instaladas) ----
if [ -d "node_modules" ] && [ -f "tsconfig.json" ]; then
  TSC_OUTPUT=$(npx tsc -b 2>&1)
  if [ $? -ne 0 ]; then
    echo "ERRORES DE TYPESCRIPT tras la ultima edicion:" >&2
    echo "$TSC_OUTPUT" | head -40 >&2
    exit 2
  fi
fi

exit 0

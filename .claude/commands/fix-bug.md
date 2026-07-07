---
description: Analizar y corregir un bug atacando la causa raiz
argument-hint: descripcion del bug
---

Hay un bug en la app. Analiza el problema como senior developer.

Bug reportado: $ARGUMENTS

Pasos obligatorios:

1. Reproduce mentalmente el flujo.
2. Identifica posibles causas.
3. Localiza los archivos probablemente afectados.
4. Propon hipotesis y verificalas leyendo el codigo.
5. Corrige la causa raiz, no solo el sintoma.
6. Anade un test que reproduzca el bug y demuestre que queda corregido.
7. Verifica que no se rompen casos relacionados (ejecuta la suite completa).
8. Indica si el bug afecta a PC, movil o ambos.
9. Verifica si el bug puede mezclar datos entre perfiles. Si es asi, tratalo como critico y revisa todos los puntos de acceso a datos similares.

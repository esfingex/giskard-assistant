# continue-here.md — giskard-assistant

*Handoff real — 2026-09-24, fin de la tanda de descomposición waves 0-8*

## Current Context Handoff

*   **Last Milestone**: Waves 0-9 completadas (incl. 7b: división de chatView.js; wave 9: promptHandlers + migración remota real a streamManager). `npm run verify` en verde.
*   **Immediate Next Step**: Verificación GUI manual (F5 → Extension Development Host) de TODA la tanda: Ctrl+L (injectCodeSnippet), botón ⚡Shell (toolExec), botones ctx (actionBtn), popover de modelos y sub-pestañas (archivos divididos en wave 7b), streaming remoto (NVIDIA/DeepSeek — cuerpo movido a streamManager en wave 9).
*   **Estado**: objetivo de descomposición cumplido — ningún archivo fuente supera 507 líneas (regla del usuario: ≤500 tolerable). Solo quedan mejoras opcionales.

## Restart Commands

*   [x] `cd /home/esfingex/workspace/giskard-assistant && npm install`
*   [x] `npm run verify`  (compile + 44/44 tests — estado verde al cerrar esta tanda)
*   [x] `git log --oneline -10`  (commits wave 0 → wave 8)

## Reglas de la tanda

*   Cada wave termina en: tsc limpio + 44/44 tests + commit con mensaje `refactor: wave N — ...`.
*   Splices grandes: usar Python (`str.index`/`replace` con asserts de conteo), no heredoc en fish.
*   Los métodos extraídos son funciones puras de `this` con contexto explícito; el host conserva factories `_xxxCtx()`.

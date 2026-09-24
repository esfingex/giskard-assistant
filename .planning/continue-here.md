# continue-here.md — giskard-assistant

*Handoff real — 2026-09-24, fin de la tanda de descomposición waves 0-8*

## Current Context Handoff

*   **Last Milestone**: Waves 0-6 + 8 commiteadas en `main`. Verificación en verde: `npm run verify` (tsc + 44 tests node:test).
*   **Immediate Next Step**: Wave 6b — extraer `_setWebviewMessageListener` (chatWebview.ts ~línea 950) a `cells/messageRouter.ts`. El listener despacha ~30 tipos del contrato; resolver primero el acoplamiento con `_handlePrompt` (último método grande, ~450 líneas) — sugerencia: extraer `_handlePrompt` por fases (contexto/routing/streaming) antes del router.
*   **Después**: Wave 7 — dividir `media/chatView.js` (1.182 líneas) y limpiar los 9 tipos muertos del allowlist en `tests/webviewContract.test.js` (los botones "ejecutar" `executeAction`/`executeShellCommand` envían mensajes que nadie maneja).

## Restart Commands

*   [x] `cd /home/esfingex/workspace/giskard-assistant && npm install`
*   [x] `npm run verify`  (compile + 44/44 tests — estado verde al cerrar esta tanda)
*   [x] `git log --oneline -10`  (commits wave 0 → wave 8)

## Reglas de la tanda

*   Cada wave termina en: tsc limpio + 44/44 tests + commit con mensaje `refactor: wave N — ...`.
*   Splices grandes: usar Python (`str.index`/`replace` con asserts de conteo), no heredoc en fish.
*   Los métodos extraídos son funciones puras de `this` con contexto explícito; el host conserva factories `_xxxCtx()`.

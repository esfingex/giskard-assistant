# STATE.md — giskard-assistant

*Última actualización: 2026-09-24 (wave 8, sesión de descomposición 4.3.0)*

## Development State

*   **Active Phase**: Descomposición COMPLETADA (waves 0-9). Regla del usuario: >500 líneas = monolítico — TODOS los archivos fuente quedan ≤507 líneas
*   **Current Milestone**: Waves 0-6 completadas y commiteadas. `chatWebview.ts`: 1.762 → 382 líneas (−78%).
*   **Git Position**: `main` @ wave 8

### Células extraídas (patrón: funciones puras con contexto explícito)

| Célula | Responsabilidad | Wave |
| :--- | :--- | :--- |
| `cells/streamManager.ts` | Streaming SSE (giskard-sys, Ollama generate/chat, API remota) | pre-0 |
| `core/webviewContract.ts` | Contrato tipado postMessage TS↔webview (fuente única) | 1 |
| `cells/connectionsHandlers.ts` | Conexiones: list/add/remove/reset/activate/test | 2 |
| `cells/agentLoop.ts` | Bucle agéntico, reglas, memoria, auto-verify, compress, plan | 3 |
| `cells/diffHandlers.ts` | Auto-trigger diff, smart-apply, snapshots/revert | 4 |
| `cells/knowledgeHandlers.ts` | Skills de agentes, Graphify LTM | 5 |
| `cells/chatStateHandlers.ts` | Models list, settings, acciones CLI, historial de pestañas | 6 |

### Fixes incluidos

* `npm test` roto → glob `tests/*.test.js` (wave 0)
* Setting fantasma: código leía `ollamaUrl`, declarado `ollamaBaseUrl` (wave 0)
* Contrato alineado con payloads reales + test drift-guard (`tests/webviewContract.test.js`) (wave 1)
* `clearContext` no vaciaba `_tabHistory` ni reseteaba auto-fix (wave 3)
* Registro de ventanas de contexto movido a `core/contextWindow.ts` — elimina import circular (wave 3)

## Architectural Decision Records (ADR)

### 1. Descomposición por células con contexto explícito
*   **Date**: 2026-09-24
*   **Context**: `chatWebview.ts` tenía 8 responsabilidades y 1.762 líneas; imposible de mantener.
*   **Decision**: Extraer células funcionales puras de `this` que reciben un contexto explícito (`StreamContext`, `ConnectionsContext`, `AgentLoopContext`, `DiffContext`, `KnowledgeContext`, `ChatStateContext`), siguiendo el patrón de `streamManager.ts`.
*   **Justification**: Mantiene los puntos de llamada estables vía factories `_cellCtx()`/`_agentCtx()`/`_diffCtx()`/`_stateCtx()`, permite verificar cada extracción con tsc + 44 tests, y evita ciclos de import (registo de contexto a `core/`).

### 2. Contrato postMessage como fuente única con drift guard
*   **Date**: 2026-09-24
*   **Context**: Tipos de mensaje dispersos como strings sueltos en TS y JS; drift ya existente (shapes de contratos no coincidían con payloads reales).
*   **Decision**: `core/webviewContract.ts` define unions `HostToWebviewMessage`/`WebviewToHostMessage`; `postMessage` del chat tipado; test `webviewContract.test.js` falla si aparece un tipo sin contrato (con allowlist documentado de listeners/senders muertos).
*   **Justification**: El compilador y el test detectan drift en ambos límites; los 9 tipos muertos quedan documentados para limpieza en wave 7.

## Pendiente (próximas oleadas)

*   ~~Wave 6b~~ **HECHA**: `cells/messageRouter.ts` (despacho de ~35 tipos con `ChatRouterDeps`; la política DeepSeek off-peak y el error boundary viven ahí).
*   **Wave 7b HECHA**: `media/chatView.js` (1.138 líneas, IIFE) dividido en 5 módulos de scope global compartido: `chatState.js` (107), `chatTabs.js` (296), `chatMessages.js` (198), `chatRouter.js` (412), `chatView.js` (167). Integridad verificada línea a línea (977=977).
*   **Wave 9 HECHA**: `cells/promptHandlers.ts` (483, el orquestador `_handlePrompt` con `PromptHost`); la copia débil de `streamFromRemoteApi` en streamManager reemplazada por la versión viva de chatWebview (URL normalization, truncado, timeouts). `chatWebview.ts` 954 → 382.
*   **Wave 7a HECHA**: listeners muertos eliminados; Ctrl+L restaurado (`injectCodeSnippet`); botones ctx reconectados vía `actionBtn` y ⚡Shell vía `toolExec` enjaulado. **Pendiente verificación GUI manual.**

*   ~~Hallazgo abierto~~ **RESUELTO (wave 7a)**: `executeAction`→`actionBtn`, `executeShellCommand`→`toolExec`, Ctrl+L→`injectCodeSnippet`.

## Active Blockers
*   None.

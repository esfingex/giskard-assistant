# Giskard Assistant — Instrucciones de Proyecto

Extensión VS Code (GPL-3.0) v4.3.0: asistente IA multiproveedor (Ollama local,
backend Rust giskard-sys en :3500, NVIDIA NIM, DeepSeek, Kimi, Qwen).
Publisher `giskard`, repo `github.com/esfingex/giskard-assistant`.

## Estado de la arquitectura (post waves 0-9, sep 2026)

`src/cells/chatWebview.ts` fue descompuesto de 1.762 → 382 líneas. Las células
viven en `src/cells/` con el patrón **funciones puras de `this` + contexto
explícito**; el host (chatWebview) conserva factories `_xxxCtx()`:

- `streamManager.ts` — streaming SSE (giskard-sys, Ollama generate/chat, remoto)
- `messageRouter.ts` — despacho de mensajes webview→host (tipado con union)
- `promptHandlers.ts` — orquestador de prompts (`PromptHost` estructural)
- `agentLoop.ts` — bucle agéntico local, reglas, memoria, auto-verify (límite 3)
- `connectionsHandlers.ts`, `chatStateHandlers.ts`, `diffHandlers.ts`,
  `knowledgeHandlers.ts`
- `webviewContract.ts` — **fuente única de los mensajes postMessage** (unions
  `HostToWebviewMessage` / `WebviewToHostMessage`)

El webview JS se dividió igual (wave 7b): `media/chatState.js` (DOM+estado),
`chatTabs.js`, `chatMessages.js`, `chatRouter.js`, `chatView.js` — scope global
compartido entre scripts (patrón de `chatUtils.js`, sin IIFE). El orden de
carga en `htmlShell.ts` importa (TDZ de const/let globales).

## Contratos que no se rompen a mano

1. **postMessage**: toda comunicación TS↔webview pasa por `webviewContract.ts`.
   El test `tests/webviewContract.test.js` (drift guard) falla si un type
   enviado/escuchado no está en el contrato. Los `case` del router usan
   narrowing del union — el compilador valida los campos por handler.
2. **giskard-sys REST**: envelope `{success, error?, data?}` — usar
   `GiskardResponse<T>` de `core/api.ts`. NO castear `res.json()` a `any` en
   estos endpoints.
3. **Proveedores IA**: `ProviderModelsResponse` (OpenAI-compatible y Ollama);
   giskard-sys usa el envelope.
4. **Streaming remoto**: la implementación viva vive en `streamManager.ts`
   (URL normalization, truncado 100k, timeout por tamaño de modelo, cached
   extractor multi-formato). No recrear versiones simplificadas.

## Pipeline de verificación (obligatorio antes de commit)

`npm run verify` = tsc strict + eslint (0 errores) + 44 tests node:test.

- ESLint flat config (`eslint.config.mjs`) + Prettier (`.prettierrc`: 4
  espacios, single quotes, width 110). `npm run format` antes de commit grande.
- `no-explicit-any` es warning documentado: aceptable SOLO en MCP (protocolo
  dinámico) y glue interno. En límites giskard-sys/webview se tipa.
- Los `catch { }` vacíos son convención deliberada (best-effort) — permitir
  `allowEmptyCatch`.

## Reglas del usuario (Iván) — vigentes

- **≤500 líneas por archivo**: más de eso es monolítico y se divide por oleadas
  con verificación y commit por wave.
- Trabajo por **oleadas** (waves): cada una termina en verify verde + commit
  con mensaje descriptivo. Splices grandes con Python (index/replace con
  asserts de conteo) — fish no soporta heredocs.
- DeepSeek oficial solo en off-peak (gate en messageRouter; ventanas UTC
  01:00-04:00 y 06:00-10:00 lun-vie).
- Los tests Python (`tests/run_tests.sh`) requieren giskard-sys vivo en :3500
  y entorno gráfico — no corren en CI del verify; los JS sí.

## Convenciones

- Comentarios de fondo/commit en el idioma del repo (español mezclado con
  inglés técnico — mantener el estilo existente).
- Células nuevas: contexto explícito (interface `XxxContext`), cero `this`.
- Antes de extraer un método monolítico: mapear `this.X` usados, diseñar la
  interface de contexto, splice con asserts, compilar inmediatamente.

## Pendientes conocidos (no redescubrir)

- Verificación GUI manual pendiente: Ctrl+L, ⚡Shell, botones ctx,
  popover/sub-pestañas, streaming remoto (cambios de waves 7a/7b/9).
- Tipos "sin emisor" actuales en el contrato: openSettings, resetConnections,
  saveSettings, searchSmithery, getExclusionPatterns, createNewChatTab (el
  router los maneja; la UI hoy no los envía).
- `.planning/STATE.md` y `continue-here.md` son el handoff real — mantenerlos
  al día al cierre de cada tanda.

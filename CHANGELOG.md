# CHANGELOG — Giskard Assistant (VSCode Extension)

## [4.2.6] - 2026-08-10

### Fixed
- **Aislamiento Total de Conexión por Sub-Chat y Modelo (`chatWebview.ts`):**
  - **Aislamiento 100% Independiente:** Cada pestaña de sub-chat (`Chat 1`, `Chat 2`, `Chat 3`...) resuelve su conexión destino analizando directamente la metadata del modelo seleccionado en dicha pestaña (`targetModel` ➔ `connGroup`).
  - **Sin Interferencia Global:** Se eliminó la dependencia de la conexión activa global del sidebar (`activeConn`) para ruteos de chat. Tener seleccionada la pestaña de NVIDIA NIM API en el sidebar ya no altera ni interfiere con las peticiones de `Chat 1` ruteadas al backend local de `Giskard-Sys`.

## [4.2.5] - 2026-08-10

### Fixed
- **Resolución de Tag de Modelo y Reset de Estado en `streamError` (`chatView.js` & `chatWebview.ts`):**
  - **Fix 1 (Reset de Estado DOM):** Al producirse un `streamError`, `chatView.js` resetea inmediatamente `currentBotMsgDiv = null` y `currentBotRawText = ''`, impidiendo que errores de conexión pasados o respuestas subsiguientes concatenen texto en la misma caja de mensaje.
  - **Fix 2 (Asignación de Tag de Modelo en Error):** `chatWebview.ts` envía `model: targetModel` en todos los mensajes de `streamError`, garantizando que la etiqueta que encabeza la caja refleje con precisión el modelo que falló (y no el modelo activo general del selector).
  - **Fix 3 (Aislamiento de Conexión Activa Remota):** La clasificación de fallback sólo marca un modelo como remoto si la etiqueta del proveedor coincide explícitamente con la conexión remota activa (`vendorTag === activeConn.tag`), evitando que modelos locales de Ollama (`hf.co/unsloth/...`) hereden el perfil de NVIDIA NIM API cuando la pestaña de NVIDIA está seleccionada.

## [4.2.4] - 2026-08-10

### Refactored
- **Limpieza de Cadenas Hardcodeadas de Puertos/IPs (`chatWebview.ts`):**
  - **Refactorización:** Se eliminaron las comprobaciones manuales de strings con puertos e IPs (`:3500`, `:11434`, `localhost`, `127.0.0.1`) en la selección de `connectorUrl`.
  - **Metadata de Conexión:** La resolución de la URL del backend se realiza directamente sobre el objeto `Connection` y la propiedad `type: 'local' | 'remote'` e `id` asignados al grupo del modelo (`connGroup.connectionUrl`).
  - **Compatibilidad:** Permite que `giskard-sys` u `Ollama` funcionen transparentemente en cualquier puerto configurado o IP remota de red sin requerir código de puerto hardcodeado.

## [4.2.3] - 2026-08-10

### Fixed
- **Fix de conector bloqueado ("Pensando...") para modelos Ollama / HuggingFace:**
  - **Causa Raíz 1 (Precedencia de URL):** La expresión de `connectorUrl` mezclaba precedencia lógica enviando peticiones de modelos locales a URLs de API remota (p. ej. NVIDIA NIM), causando timeouts colgados en el streaming de red.
  - **Causa Raíz 2 (Reemplazo indebido en fallback):** `_streamFromOllamaFallback` sobreescribía los nombres de modelo que contenían `/` (como `hf.co/unsloth/Qwen-AgentWorld...`) sustituyéndolos por el primer modelo detectado localmente.
  - **Solución:** Se corrigió el cálculo de `connectorUrl` asegurando que siempre resuelva al conector local `http://localhost:3500` para modelos de Giskard-Sys, y se eliminó la substitución de nombres con `/` para respetar modelos de HuggingFace Hub en Ollama.

## [4.2.2] - 2026-08-10

### Fixed
- **Resolución Inteligente de Proveedores por Conexión (Fix de "API Key missing for hf.co/..."):**
  - **Causa Raíz:** En `chatWebview.ts`, la heurística previa `!targetModel.startsWith('local:')` clasificaba erróneamente cualquier modelo cuyo nombre no iniciara explícitamente por `"local:"` como un modelo de API Remota. Para los modelos de Ollama descargados desde HuggingFace Hub (p. ej. `hf.co/unsloth/Qwen-AgentWorld-35B-A3B-GGUF:Q3_K_M`), se extraía el prefijo `hf.co` como etiqueta de proveedor remoto y fallaba solicitando una API Key inexistente.
  - **Fix Implementado:** Se introdujo `_modelConnectionMap` en `GiskardChatWebviewProvider`. Al cargar la lista de modelos (`_sendModelsList`), el webview asocia dinámicamente cada modelo a su grupo de conexión (`Giskard-Sys`, `Ollama`, `NVIDIA NIM`, `OpenAI`, `DeepSeek`, etc.).
  - **Ruteo Dinámico:** Si el modelo pertenece a la conexión local de `Giskard-Sys` u `Ollama`, se rutea localmente sin solicitar API Key remota. Si pertenece a una conexión remota (p. ej. `NVIDIA NIM`), se utilizan las credenciales de dicho perfil.
  - **Aumento de Timeout Remoto:** Se incrementó el tiempo de espera inicial en la API remota de 12s a 60s para acomodar modelos grandes o de razonamiento.

## [4.2.1] - 2026-08-10

### Fixed
- **Chat Model Popover — "No hay modelos disponibles" bug eliminado:** El popover del selector de modelos en el chat mostraba el mensaje de error aunque los modelos estuvieran marcados con ✓ en el árbol "Active LLM Models". Causa raíz: `_sendModelsList()` enviaba la lista `enabledModels` del store, que estaba vacía si el usuario nunca había hecho click/toggle manual sobre ningún modelo.
  - **`connectionStore.ts`**: Añadido método `setEnabledModels(models: string[])` para establecer la lista completa de modelos habilitados en un solo paso (bulk-set).
  - **`chatWebview.ts`**: Implementado **auto-seed** en `_sendModelsList()`: si `enabledModels` está vacío pero hay modelos disponibles de proveedores activos (`allFlatModels`), se habilitan todos automáticamente y se notifica al webview con `setEnabledModels`. El `postMessage` de `setEnabledModels` ahora se envía después del fetch de red, reflejando el estado real (incluyendo los auto-habilitados).

---

Registro cronológico de cambios, funciones e integraciones del proyecto **Giskard Assistant** desde la versión v1.0.0.

## [4.2.0] - 2026-08-06

### Agregado & Reestructuración de Arquitectura
- **Arquitectura Modular Multiproveedor (`src/core/providers/`):**
  - Creación del ruteador maestro y módulos clientes independientes para **NVIDIA NIM** (`nvidiaProvider.ts`), **DeepSeek** (`deepseekProvider.ts`), **Moonshot Kimi** (`kimiProvider.ts`), **Qwen / DashScope** (`qwenProvider.ts`), **Giskard-Sys** (`giskardSysProvider.ts`) y **Ollama Local** (`ollamaProvider.ts`).
- **Streaming Directo Autenticado para APIs Remotas (`_streamFromRemoteApi`):**
  - Transmisión en tiempo real SSE vía `/v1/chat/completions` con soporte nativo de Bearer Tokens en SecretStorage (OS Keychain).
- **Captura e Integración de Razonamiento Lógico (`reasoning_content`):**
  - Procesamiento y renderizado fluido de cadenas de pensamiento para modelos de razonamiento avanzado como `openai/gpt-oss-120b` (NVIDIA NIM) y DeepSeek-R1.
- **Ediciones *In-Place* en el Mismo Archivo Fuente:**
  - Sustitución de pestañas divididas `vscode.diff` por aplicación directa de cambios dentro de la pestaña activa del editor de VS Code, activando decoraciones nativas de Git/VSCode.
- **Integración Nativa MCP SSE (Puerto 3070):**
  - Descubrimiento e inspección de herramientas de filesystem e imágenes en 130ms mediante Handshake SSE evento-respuesta (`initialize` + `tools/list`).
- **Categorías Colapsables y Tagging Dinámico en Selector de Modelos:**
  - Listas colapsables `<details>` y `<optgroup>` clasificando modelos según proveedor activo (`NVIDIA`, `DEEPSEEK`, `KIMI`, `GISKARD-SYS`, `OLLAMA`) y permitiendo uso combinado local/remoto.
- **Daemon Nativo Linux Systemd para `giskard-sys`:**
  - Registro e integración de `giskard-sys.service` como daemon de usuario nativo en Linux.

---

## [3.9.0] - 2026-07-31

### Refactorización de Arquitectura
- **Desacoplamiento Total Backend/Frontend:**
  - Limpieza completa del System Prompt en `giskard-sys` eliminando reglas de maquetación y formateo CSS/UI.
  - Traslado del formateo visual, maquetación de listas, protección de bloques de código y envoltorio de árboles ASCII (`├──`, `└──`) a `giskard-assistant` (`media/chatView.js`).

---

## [3.8.0] - 2026-07-31

### Agregado
- **Demostración Interactiva Automática en Vivo (`giskard-sys.runLiveDemo`):**
  - Autocompletado del chat, activación de envio en tiempo real y transmisión de tokens visible en vivo sobre la ventana de VSCode.

---

## [3.7.0] - 2026-07-31

### Agregado
- **Apertura y Enfoque Automático de la Barra de Chat:**
  - Auto-ejecución del comando `giskard-sys.openChat` al activar la extensión para desplegar de inmediato el panel lateral del chat en la interfaz visible de VSCode.

---

## [3.6.0] - 2026-07-31

### Agregado
- **Botón de Detener Generación (`[ 🛑 Detener ]`):**
  - Implementación de `AbortController` y señal de cancelación en tiempo real en la extensión para abortar la generación del modelo inmediatamente si entra en bucle.
- **Alternancia de Botón Enviar / Detener:**
  - Alternancia dinámica del botón `Enviar ⚡` a `🛑 Detener` durante la transmisión SSE de tokens.

---

## [3.5.0] - 2026-07-31

### Corregido
- **Protección de Bloques de Código en Preprocesador:**
  - Separación de fragmentos de código (` ```...``` `) para evitar la alteración o colapso de saltos de línea y árboles ASCII de archivos.
- **Ajuste de Encabezados dentro de Cajas de Pensamiento (`<think>`):**
  - Estilizado de `h1-h4` dentro de `.think-content` con tipografía pequeña y proporcional para evitar que los títulos corten la traza.
- **Formateo Estricto de Listas Ordenadas en Prosa:**
  - Forzado de saltos de línea antes de subpuntos numerados (`1.`, `2.`, `3.`) para garantizar el renderizado de listas `<ol>` en Markdown.

---

## [3.4.0] - 2026-07-31

### Agregado
- **Bloques de Código y Shell Colapsables (`<details class="code-box" open>`):**
  - Encabezado interactivo `▶ 💻 Código / Shell (Ocultar/Mostrar)` para replegar/desplegar bloques de código de 1 clic.
- **Scroll Interno en Cajas de Pensamiento (`<think>`):**
  - Límite de altura `max-height: 180px` con scroll vertical interno en `.think-content`.
- **Scroll Inteligente Vertical y Horizontal en Código / Terminal:**
  - Límite de altura `max-height: 320px` con `overflow-y: auto` y `overflow-x: auto` en elementos `<pre>`.

---

## [3.3.0] - 2026-07-31

### Agregado
- **Detección Automática del Proyecto Activo en VSCode:**
  - Lectura en tiempo real de `vscode.workspace.workspaceFolders[0]`.
  - Inyección del prefijo contextual `[Proyecto Abierto en VSCode: <NombreProyecto> (<RutaAbsoluta>)]` en cada prompt.
- **Auto-Montaje de Workspace en Backend:**
  - Emisión automática del comando `/workspace/mount` hacia `giskard-sys` para autorizar la lectura y construcción del árbol de archivos en el Sandbox Jail.

---

## [3.2.0] - 2026-07-31

### Agregado
- **Personalización de Globos de Chat Independientes:**
  - Selector de color de fondo para Burbujas de Usuario (`.msg.user`).
  - Selector de color de fondo para Burbujas de IA (`.msg.bot`).
  - Selector de color de fondo para Cajas de Razonamiento (`details.think-box`).
- **Presets de Color de 1 Clic:**
  - Blanco Minimal (`#f8fafc` / `#ffffff`)
  - Neón Cyan (`#e0f2fe` / `#38bdf8`)
  - Matrix Emerald (`#ecfdf5` / `#34d399`)
  - Cyberpunk (`#faf5ff` / `#c084fc`)

---

## [3.1.0] - 2026-07-31

### Cambiado
- **Limpieza de Interfaz:**
  - Eliminado el selector redundante "Tema & Color de Texto" de la Pestaña 1 en favor de la pestaña dedicada "Paleta & Estilos".

---

## [3.0.0] - 2026-07-31

### Agregado
- **Pestaña Dedicada de Estilos "Paleta & Estilos":**
  - Adición de la tercera pestaña en el modal de Ajustes.
  - Selectores de color en tiempo real para texto principal, encabezados H1-H4 y bordes de acento.

---

## [2.9.0] - 2026-07-31

### Corregido
- **Limpieza de Maquetación Modal:**
  - Eliminación de etiquetas HTML duplicadas en el modal de Ajustes.

---

## [2.8.0] - 2026-07-31

### Agregado
- **Tema Blanco Minimalista (Estilo Antigravity):**
  - Tipografía clara en `#ffffff` / `#f8fafc` sobre fondos oscuros limpios.
  - Reducción de elementos gráficos pesados para una estética sobria.
- **Renderizado Independiente de Tablas Markdown:**
  - Función de preprocesamiento para separar tablas pegadas en filas HTML limpias.
  - Corrección de palabras unidas y listas numeradas dentro de párrafos.

---

## [2.7.0] - 2026-07-31

### Corregido
- **Gatillo Automático de Carga de Modelos:**
  - Consulta automática al endpoint `/ollama/models` al abrir el modal de ajustes.
  - Garantía de lista de modelos locales (`qwimi-k2.6:distill`, `qwen3-coder:30b`, `phi4:14b`, `aya-expanse:8b`).

---

## [2.6.0] - 2026-07-31

### Corregido
- **Filtro de Cajas Negras Vacías:**
  - Detección y ocultamiento automático de bloques de código vacíos (`!codeText.trim()`).
  - Inyección de regla en System Prompt para obligar a la IA a emitir comandos ejecutables en bloques ` ```bash `.

---

## [2.5.0] - 2026-07-31

### Agregado
- **Preprocesador Inteligente de Markdown (`preprocessMarkdown`):**
  - Formateo de tokens recibidos por SSE Stream.
  - Inserción de saltos de línea automáticos antes de títulos `##`, listas numeradas y bloques de código ` ```bash `.

---

## [2.4.0] - 2026-07-30

### Agregado
- **Soporte de Contexto de 128K Tokens:**
  - Contador de tokens en tiempo real hasta 131,072 tokens para modelos de razonamiento (`qwimi-k2.6:distill`).
- **Gestor Visual de Políticas de Comandos:**
  - Badges interactivos `[✖]` y `[+ Permitir]` para administrar comandos autorizados en `giskard-sys`.

---

## [2.3.0] - 2026-07-29

### Agregado
- **Integración con Graphify:**
  - Botón y endpoint para indexar grafos de conocimiento SQLite (`/extensions/graphify/run`).

---

## [2.2.0] - 2026-07-29

### Agregado
- **Command Policy Manager en Ajustes:**
  - Control de comandos autorizados para la ejecución en Sandbox Jail.

---

## [2.1.0] - 2026-07-28

### Agregado
- **Ejecución en Shell Integrada de VSCode:**
  - Botones "Ejecutar en Shell" en los bloques de código.
  - Creación y enfoque automático de Giskard Terminal.

---

## [2.0.0] - 2026-07-28

### Agregado
- **Aprobación de Cambios por Diff Nativo de VSCode:**
  - Botón "Ver Diff en VSCode" que invoca `vscode.diff`.
- **Caja de Razonamiento Auto-Colapsable:**
  - Desplegable interactivo "Pensamiento de la IA (Ocultar/Mostrar)".

---

## [1.5.0] - 2026-07-27

### Agregado
- Rediseño del modal de Ajustes en 2 pestañas organizadas ("Local & Visibilidad" vs "API Remota & Keys").

---

## [1.4.0] - 2026-07-27

### Agregado
- Agrupación y etiquetado de modelos por tipo de conexión (Badges OLLAMA vs CLI).

---

## [1.3.0] - 2026-07-27

### Agregado
- Filtros de visibilidad de modelos mediante casillas de verificación en Ajustes.

---

## [1.2.0] - 2026-07-26

### Agregado
- Poblamiento dinámico del selector de modelos desde el endpoint `/ollama/models`.

---

## [1.1.0] - 2026-07-26

### Agregado
- Integración del parser local `marked.min.js` para renderizado de GitHub Markdown enriquecido.

---

## [1.0.0] - 2026-07-25

### Agregado
- **Commit Inicial de la Extensión Soberana Giskard Assistant:**
  - Webview Panel dedicado en la barra lateral de VSCode.
  - Conexión soberana REST + SSE Streaming con el daemon `giskard-sys` en `http://localhost:3500`.

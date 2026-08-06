# CHANGELOG — Giskard Assistant (VSCode Extension)

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

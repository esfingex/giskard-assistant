# 🤖 Giskard Assistant — AI Assistant for VS Code

[![Version](https://img.shields.io/badge/version-4.2.6-blue.svg)](CHANGELOG.md)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-^1.80.0-blue.svg)](package.json)

**Giskard Assistant** es una extensión multiproveedor para Visual Studio Code diseñada para potenciar la programación asistida por Inteligencia Artificial de forma privada, versátil y de alto rendimiento.

Integra directamente modelos locales (**Ollama**), el backend en Rust Axum (**giskard-sys** en puerto 3500), y proveedores de IA remotos de última generación (**NVIDIA NIM**, **DeepSeek**, **Moonshot Kimi**, **Qwen/DashScope**, **OpenAI**, **Anthropic Claude**, **Google Gemini**).

---

## 🌟 Características Principales

### 1. 🤖 Ruteador Multiproveedor
* **Modelos Locales (Ollama & Giskard-Sys):** Ejecuta modelos locales en tu hardware (`qwen3-coder:30b`, `phi4:14b`, `aya-expanse:8b`, `deepseek-r1`, `gpt-oss:20b`).
* **Proveedores Remotos Autenticados:** Streaming directo vía Server-Sent Events (SSE) autenticado de forma segura mediante **SecretStorage** (Keychain del SO) sin almacenar claves en texto plano.
* **Badges y Clasificación por Capacidades:** Clasificación automática de modelos según sus capacidades:
  - 🧠 **Razonamiento Profundo** (`thinking`)
  - 🛠️ **Herramientas y Código** (`tools`)
  - 👁️ **Visión Multimodal** (`vision`)
  - 🧩 **Vectores y Embeddings** (`embedding`)

### 2. 💬 Multichat en Paralelo con Sub-Pestañas Internas
* Abre múltiples hilos de conversación simultáneos en el mismo panel lateral con la barra de sub-pestañas.
* Configura un modelo de IA distinto para cada pestaña (ej. Chat 1 con `deepseek-r1`, Chat 2 con `qwen2.5-coder:1.5b`).

### 3. 📝 Edición *In-Place* y Aplicación Directa de Código
* **Aplicación en 1-Click:** Aplica las sugerencias de código de la IA directamente sobre el archivo activo en el editor de VS Code.
* **Decoraciones Nativas:** Aprovecha el sistema de control de cambios (Undo/Redo) e inspección de diferencias nativas de VS Code.
* **Identificación Automática de Archivos:** Detección automática de la ruta del archivo fuente en comentarios de código (`// src/extension.ts`).

### 4. 💡 Visualizador de Pensamiento y Cadenas de Razonamiento (`<think>`)
* Cajas desplegables interactivas `<details class="think-box">` para inspeccionar la cadena de razonamiento lógico en tiempo real para modelos como DeepSeek-R1 y GPT-OSS.

### 5. 🛠️ Protocolo MCP (Model Context Protocol) & Herramientas
* **Integración MCP Stdio & SSE:** Conexión nativa con servidores MCP (Filesystem, GitHub, Smithery Registry).
* **Tool Bridge:** Lectura/Escritura atómica de archivos del workspace y ejecución enjaulada de comandos terminales autorizados.

### 6. 🕸️ Memoria BCF & Indexación Grafo Graphify
* **Alicanto CaveMem:** Compresión inteligente de historial en formato BCF.
* **Graphify LTM:** Indexación de estructura de código y relaciones de proyectos mediante grafos de conocimiento SQLite.

### 7. 🎨 Personalización Visual & Temas de Color
* Selector dinámico con 4 presets de color instantáneos:
  - 🌙 **Cyberpunk Dark**
  - 🔮 **Deep Neon Glassmorphic**
  - ☀️ **Clean Studio Light**
  - 🌌 **Midnight Emerald**
* Paleta interactiva para ajustar en tiempo real los colores de texto, encabezados `H1-H4`, bordes de acento y burbujas de chat.

### 8. ⌨️ Atajo Global `Ctrl+L` para Contexto de Código
* Presiona **`Ctrl+L`** en cualquier archivo del editor para adjuntar instantáneamente las líneas seleccionadas o el bloque activo directamente a la consulta del chat.

---

## 🏗️ Arquitectura del Proyecto

```text
giskard-assistant/
├── media/                       # Controladores e interfaz Webview (Vanilla JS + CSS)
│   ├── chatView.js              # Controlador principal del Chat y popover de modelos
│   ├── chatUtils.js             # Formateador Markdown, parser de bloques y tool calls
│   ├── connectionsView.js       # Gestor visual de conexiones y API keys
│   └── mcpView.js               # Gestor visual de servidores y herramientas MCP
├── src/                         # Extensión TypeScript (Extension Host)
│   ├── extension.ts             # Punto de entrada y registro de comandos/vistas
│   ├── cells/                   # Células funcionales del sistema
│   │   ├── chatWebview.ts       # Célula del panel lateral de chat y streaming SSE
│   │   ├── htmlShell.ts         # Estructura HTML y hojas de estilo CSS
│   │   ├── treeViewProvider.ts  # Proveedores de árboles de modelos y conexiones
│   │   ├── mcpHandlers.ts       # Manejadores del protocolo MCP
│   │   ├── toolHandlers.ts      # Puente de herramientas (Lectura/Escritura/Terminal)
│   │   ├── modelSettingsWebview.ts # Vista de ajustes avanzados por modelo
│   │   └── statusBar.ts         # Indicador de estado y heartbeat en la barra de VSCode
│   └── core/                    # Núcleo de datos y API Client
│       ├── api.ts               # Cliente HTTP/REST para backend Giskard-Sys
│       ├── connectionStore.ts   # Almacenamiento persistente SQLite / SecretStorage
│       └── providers/           # Ruteador e integraciones de proveedores IA
│           ├── index.ts         # Ruteador maestro
│           ├── nvidiaProvider.ts
│           ├── deepseekProvider.ts
│           ├── kimiProvider.ts
│           ├── qwenProvider.ts
│           ├── giskardSysProvider.ts
│           └── ollamaProvider.ts
├── package.json                 # Manifiesto de extensión y contribuciones de VSCode
└── tsconfig.json                # Configuración del compilador TypeScript
```

---

## 🛠️ Instalación y Requisitos

### Requisitos Previos
* **Visual Studio Code** `v1.80.0` o superior.
* **Node.js** `v18+` y `npm`.
* *(Opcional)* Instancia local de **Ollama** (`http://127.0.0.1:11434`) o servidor **Giskard-Sys** (`http://localhost:3500`).

### 1. Instalación mediante Archivo VSIX
Para instalar directamente el paquete compilado `.vsix`:

```bash
code --install-extension giskard-assistant-4.2.0.vsix --force
```

### 2. Compilación Manual (Desarrollo)

```bash
# 1. Clonar o navegar al directorio del proyecto
cd giskard-assistant

# 2. Instalar dependencias
npm install

# 3. Compilar código TypeScript
npm run compile

# 4. Generar paquete .vsix
npm run package
```

Para probar la extensión en un entorno de desarrollo interactivo de VS Code, presiona **`F5`** en VS Code para abrir una instancia de **Extension Development Host**.

---

## ⚙️ Comandos Disponibles

| Comando ID | Descripción / Función |
| :--- | :--- |
| `giskard-assistant.openChat` | Abre el Chat interactivo en el panel lateral principal de VS Code. |
| `giskard-assistant.openChatTab` | Abre una pestaña de Chat independiente en el editor principal. |
| `giskard-assistant.attachCodeToChat` | Adjunta el código o selección actual al chat (**`Ctrl+L`**). |
| `giskard-assistant.addModelOrConnection` | Abre el asistente interactivo para agregar modelos o conexiones IA. |
| `giskard-assistant.toggleConnectionActive` | Activa o desactiva un perfil de conexión IA guardado. |
| `giskard-assistant.toggleModelForChat` | Habilita/Deshabilita un modelo para la lista del chat. |
| `giskard-assistant.manageApiKey` | Gestiona claves de API y tokens de forma segura en SecretStorage. |
| `giskard-assistant.filterCapabilities` | Filtra el árbol de modelos por capacidad (🧠 🛠️ 👁️ 🧩). |
| `giskard-assistant.searchModels` | Busca modelos por nombre o término en el árbol lateral. |
| `giskard-assistant.addMcpServerTree` | Agrega un nuevo servidor MCP (stdio / sse). |
| `giskard-assistant.testMcpServerTree` | Prueba la conexión y descubre herramientas de un servidor MCP. |
| `giskard-assistant.selectThemeTree` | Aplica un tema visual a la interfaz del Chat. |
| `giskard-assistant.syncState` | Sincroniza el estado global de conexiones y modelos. |

---

## 🔧 Opciones de Configuración

Puedes personalizar la extensión mediante los ajustes de VS Code (`settings.json`):

```json
{
  "giskard-assistant.connectorUrl": "http://localhost:3500",
  "giskard-assistant.ollamaBaseUrl": "http://localhost:11434",
  "giskard-assistant.defaultModel": "auto",
  "giskard-assistant.clientId": "vscode-assistant",
  "giskard-assistant.autoSync": true,
  "giskard-assistant.language": "es"
}
```

---

## 📄 Licencia

Este proyecto está licenciado bajo la **GNU General Public License v3.0 (GPL-3.0)**. Consulta el archivo [LICENSE](LICENSE) para obtener más información.

# Extensión VSCode — Giskard-Sys Connector

Esta extensión conecta el editor **Visual Studio Code** directamente con el backend de **Giskard-Sys** (`http://localhost:3500`), permitiéndote listar e inspeccionar archivos dentro del Sandbox Jail desde la paleta de comandos de VSCode.

---

## 🛠️ Requisitos e Instalación

### 1. Instalación Directa (Recomendada)
El paquete `.vsix` **v0.13.0** incluye:
* ⚠️ **Manejo Elegante de Herramientas CLI Ausentes:** Si seleccionas `cli:gemini` o `cli:claude` sin tener el binario CLI instalado en el sistema, la extensión muestra un mensaje claro sugiriendo usar los modelos locales de Ollama (`qwimi-k2.6:distill`) o configurar claves en ⚙️ Ajustes.

```bash
code --install-extension extensions/vscode/giskard-sys-vscode-0.13.0.vsix --force
```

### 🛠️ Instalación de CLIs de Gemini y Claude (CachyOS / Arch Linux)
Para utilizar los modelos Orquestadores `cli:gemini` y `cli:claude` de forma nativa en tu consola o desde Giskard Copilot:

1. **Claude CLI (Anthropic):**
   ```bash
   npm install -g --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code
   ln -sf ~/.npm-global/bin/claude ~/.local/bin/claude
   ```
2. **Gemini CLI (Google AI):**
   ```bash
   pip install --break-system-packages --user google-genai google-generativeai
   chmod +x ~/.local/bin/gemini
   export GEMINI_API_KEY="tu-api-key-de-google"
   ```

---

## 🤖 Novedades de Giskard Copilot v0.2.0

* **🤖 Chat Lateral en la Barra de Actividad (Activity Bar):** Haz clic en el ícono del Robot en la barra lateral izquierda para abrir la consola interactiva Copilot.
* **🌐 Soporte Multimodelo Simultáneo:**
  * **Modelos Locales (Ollama):** `qwen3-coder:30b`, `phi4:14b`, `aya-expanse:8b`.
  * **CLIs Externos:** Integración directa con `gemini` (Gemini CLI) y `claude` (Claude CLI).
* **📄 Inyección de Contexto del Editor:** Casilla para adjuntar automáticamente el contenido del archivo activo que estás editando a la consulta.

---

### 2. Compilación Manual (Desarrollo)
Si deseas modificar el código en TypeScript:

```bash
cd extensions/vscode
npm install
npm run compile
npx @vscode/vsce package --no-dependencies
```

---

## 💻 Comandos Disponibles en VSCode

* **`giskard-sys.listSandbox`**: Lista los archivos y directorios del sandbox activo en el puerto `3500`.
* **`giskard-sys.readSandboxFile`**: Pide una ruta relativa dentro del sandbox y abre el contenido del archivo en una pestaña de editor en VSCode.

---

## ⚙️ Configuración

La extensión se conecta automáticamente a `http://localhost:3500` enviando el header `X-Client-Id: VSCode-Extension`.

# FASE 2 — Que el modelo local «razone de verdad»

> **Estado: ✅ IMPLEMENTADA** (bucle agente para modelos Ollama locales con
> `messages[]`, historial por tab, presupuesto de tokens y anti-bucle).
> Este documento sigue siendo la guía conceptual: el código real está en
> `src/core/contextWindow.ts`, `src/cells/chatWebview.ts` (`_streamOllamaChat`,
> `_agentLoopOllama`) y `src/cells/toolHandlers.ts` (`extractToolCalls`,
> `executeReadOnlyTool`).

> **Para quién es este documento**: para ti (el autor del proyecto) y para cualquier
> persona que quiera entender por qué un chat con IA «no recuerda nada» entre turnos,
> y cómo convertirlo en un **agente** que lea archivos, planee y ejecute cambios solo.
> Está escrito sin dar por sabidos los conceptos: si algo no te queda claro, busca el
> término en el glosario al final.

---

## 1. El problema de fondo: la IA no tiene memoria

Cuando chateas con un modelo local vía **Ollama**, cada mensaje que le envías es como
hablar con un **experto que sufre amnesia**: le das un prompt, responde, y *olvida todo*.

Esto pasa porque la API usada hoy es `/api/generate`, que funciona así:

```text
Tú:  [prompt completo]  ──────────────►  Ollama  ──►  [respuesta]
```

El «prompt completo» es **un solo texto gigante**. Si no se lo vuelves a mandar entero,
el modelo no tiene ni idea de lo que dijo antes.

### La forma en que hoy «se salva» la conversación

En `giskard-assistant` esto se compensa de forma artesanal: cada vez que el modelo
quiere leer un archivo, el webview acumula el contenido y lo **re-inyecta** en el
siguiente prompt a mano (`flushToolBatch()` en `media/chatView.js`). Eso:

- funciona a medias (un turno de profundidad),
- revienta el contexto si hay muchos archivos,
- y hace que el modelo no pueda recordar decisiones que tomó hace 5 mensajes.

---

## 2. La solución: `messages[]` en vez de un prompt suelto

Las APIs modernas de chat (OpenAI-compatible, y también la **API `/api/chat` de Ollama**)
permiten mandar un **historial estructurado**:

```text
POST /api/chat
{
  "model": "qwen-agentworld:35b",
  "messages": [
    { "role": "system",    "content": "Eres un agente de codificación en VS Code..." },
    { "role": "user",      "content": "Arregla el bug en src/main.py" },
    { "role": "assistant", "content": "Voy a leer el archivo primero." },
    { "role": "tool",      "content": "[contenido de src/main.py leído]" },
    { "role": "assistant", "content": "El bug está en la línea 12. Ya lo corregí..." }
  ]
}
```

El modelo recibe **la conversación completa de una vez**: lee la lista de mensajes en
orden y responde como quien ha estado en toda la conversación.

**Concepto clave — los roles**: cada mensaje tiene un rol:

- `system` — las instrucciones permanentes (quién es, qué herramientas tiene, qué NO debe tocar).
- `user` — lo que dice el humano.
- `assistant` — lo que respondió el modelo.
- `tool` — el resultado de una herramienta que el modelo pidió (el contenido de un archivo, la salida de un grep, etc.).

> ⚠️ **Por qué es tan importante el rol `tool`**: es lo que le permite al modelo *saber
> qué vio* cuando pidió leer un archivo. Sin ese mensaje, el modelo responde «ya lo leí»
> aunque no recuerde nada.

---

## 3. La ventana deslizante (sliding window)

Todo modelo tiene un **límite de contexto** (para qwen-agentworld 35B: 32.768 tokens).
Si el historial crece más que eso, la petición falla (el error que viste con tu 35B).

Entonces, ¿qué hacemos cuando la conversación es más larga que la ventana?
**Recortar, pero con criterio**:

```text
[system]  [user 1]  [assistant 1]  [user 2]  [assistant 2]  [user 3]
     └─────── siempre se queda ───────┘              └── se descarta lo viejo ──┘
```

Reglas típicas:

1. El `system` **nunca** se recorta.
2. Los archivos leídos recientemente **se conservan** (son el contexto de trabajo).
3. Se descarta primero lo más antiguo, **turno por turno** (nunca a mitad de un turno, o el modelo leería una respuesta cortada).
4. Si sigue sobrando espacio, se truncan los contenidos de archivos más viejos.

Esto se llama **ventana deslizante** porque el «recorte» se desplaza: a medida que llegan
mensajes nuevos, salen los viejos.

---

## 4. El presupuesto de tokens

Para recortar bien necesitamos **estimar cuánto ocupa cada mensaje**. No hace falta un
tokenizador exacto; una aproximación decente es:

```text
tokens ≈ caracteres / 4        (para código y texto en inglés)
tokens ≈ caracteres / 2.5      (para español, más denso)
```

Con eso, antes de mandar la petición calculamos:

```text
presupuesto_total = ventana_del_modelo (p. ej. 32768)
usado = system + historial + archivos + prompt_nuevo
si usado > presupuesto_total:
    recorta historial viejo
    si aún sobra: trunca archivos más viejos
    si aún sobra: avisa al usuario
```

**Por qué importa en este proyecto**: hoy el sistema inyecta el prompt completo con
`/api/generate` y **no sabe cuánto ocupa**. Con el presupuesto, cada petición entra
garantizada dentro de la ventana y nunca más «se cae» por contexto desbordado.

---

## 5. El bucle agente (el corazón de Codewhale / Claude / Antigravity)

Esto es lo que separa un *chat con IA* de un *agente*:

```text
┌────────────┐   mensaje del usuario   ┌────────────────────────────┐
│   Usuario  │ ───────────────────────►│      AGENTE (bucle)        │
└────────────┘                         └────────────────────────────┘
                                                   │
                                        [modelo genera respuesta]
                                                   │
                                    ¿la respuesta pide una herramienta?
                                                   │
                                    ┌──────────────┴──────────────┐
                                    │ no                          │ sí
                                    ▼                             ▼
                            ┌─────────────────┐          ┌──────────────────┐
                            │  Mostrar y fin  │          │ ejecutar tool     │
                            └─────────────────┘          │ (read, write,     │
                                                         │  list_dir, search)│
                                                         └────────┬─────────┘
                                                                  │
                                        [resultado → mensaje tipo "tool"]
                                                                  │
                                        ┌─────────────────────────▼──────────┐
                                        │  el modelo continúa CON el contexto │
                                        └─────────────────────────────────────┘
```

O sea, el bucle es: **el modelo habla → si pide una herramienta, la ejecutamos y le
devolvemos el resultado como un mensaje nuevo → el modelo sigue razonando con eso → repite** —
hasta que termina o llega a un máximo de pasos (anti-bucle).

### Cómo se vería en `giskard-assistant` (concreto)

Hoy el bucle vive a medias en el **webview** (`chatView.js`: `dispatchToolCalls` →
resultado → `flushToolBatch` → `send()` otra vez). Eso tiene 3 problemas:

1. Cada vuelta del bucle **reescribe el prompt completo a mano** en vez de usar `messages[]`.
2. El estado vive en el DOM (frágil: si el webview se recarga, se pierde).
3. No hay tope de iteraciones (el `_toolCallDepth` existe pero nunca se incrementa).

La Fase 2 movería el bucle al **extension host** (`chatWebview.ts`), donde ya está la
lógica de streaming, y lo haría así:

```typescript
// pseudo-código del bucle agente en chatWebview.ts
private async _agentLoop(history: ChatMessage[], maxSteps = 10) {
    for (let step = 0; step < maxSteps; step++) {
        const reply = await this._streamOllamaChat(history);   // /api/chat con messages[]
        const calls = parseToolCalls(reply);

        if (calls.length === 0) {
            // el modelo terminó: mostrar respuesta y salir
            this._postComplete(reply);
            return;
        }

        history.push({ role: 'assistant', content: reply });

        for (const call of calls) {
            const result = await executeTool(call);            // read_file, list_dir, ...
            history.push({ role: 'tool', content: result });   // ← la clave de todo
        }
        // siguiente iteración: el modelo continúa sabiendo qué vio
    }
    // anti-bucle: se superó maxSteps
    this._postError('El agente llegó al máximo de pasos de herramienta.');
}
```

### Cambios concretos de archivos (cuando se implemente)

- **`src/cells/chatWebview.ts`**
  - Nueva función `_streamOllamaChat(messages)` que llama a `POST {ollama}/api/chat` con
    `{ model, messages, stream: true, options: { num_ctx: 32768 } }` (el `num_ctx` ya se arregló).
  - `_agentLoop()` con historial por tab (`Map<tabId, ChatMessage[]>`).
  - Presupuesto de tokens antes de cada llamada (sección 4).
- **`src/core/` (nuevo módulo, p. ej. `contextWindow.ts`)**
  - `estimateTokens(text)` y `trimHistory(history, budget)` — la ventana deslizante.
- **`media/chatView.js`**
  - Dejar de re-inyectar prompts a mano (`flushToolBatch` se simplifica: ahora el host
    devuelve los resultados de herramientas como mensajes `tool`).
  - El webview solo muestra; el agente vive en el host.
- **`media/chatUtils.js`**
  - `parseToolCalls` ya sirve; se reutiliza tal cual para extraer tool calls del stream.

### Riesgos y por qué se hace por etapas

1. **Compatibilidad**: `/api/chat` existe en Ollama desde v0.1.17; conviene verificar la
   versión instalada y hacer fallback a `/api/generate` si falla.
2. **Coste de tokens**: mandar historial completo por turno usa más contexto que el
   re-inyect actual. Por eso el presupuesto (sección 4) es obligatorio, no opcional.
3. **Modelos sin soporte de tool calls nativo**: qwen-agentworld emite tool calls como
   texto `[TOOL_CALL] {...} [/END_TOOL]` (que tu `parseToolCalls` ya entiende). No hace
   falta el soporte nativo `tools` de la API; el formato textual funciona igual en el bucle.

---

## 6. Glosario rápido

- **Token**: unidad en la que los LLM «piensan»; aprox. 4 caracteres por token en inglés, menos en español.
- **Ventana de contexto (context window)**: número máximo de tokens que el modelo puede tener «en mente» en una petición.
- **`num_ctx`**: parámetro de Ollama que fija esa ventana por petición. Sin él, Ollama usa el mínimo por defecto (2048–8192), que revienta al leer archivos.
- **Prompt**: el texto que le mandas al modelo (todo lo que «ve» en esa petición).
- **System prompt**: el bloque de instrucciones permanentes que define quién es el modelo y qué puede hacer.
- **Mensaje `tool`**: el resultado de ejecutar una herramienta, devuelto al modelo como parte del historial.
- **Sliding window**: técnica de recorte que elimina lo más antiguo cuando el historial excede la ventana.
- **Bucle agente**: el ciclo modelo → tool call → ejecutar → resultado → modelo, que le permite al modelo completar tareas de varios pasos.
- **Anti-bucle**: límite de iteraciones del bucle para que un modelo que se enreda no corra para siempre.

---

## Anexo — Fase 3 y Fase 4 (implementadas)

Este documento se escribió junto con la implementación de Fases 3 y 4 en `giskard-assistant`:

- **Fase 3 — Capacidades de agente** (ya en el código):
  - Tools de workspace: `list_dir`, `search` (grep por contenido), `glob` → `src/cells/toolHandlers.ts`.
  - Plan → aprobar → ejecutar: el modelo emite `[PLAN] ... [/END_PLAN]`, el chat muestra botones, y `_handleApprovePlan` re-lanza la ejecución.
  - Diff nativo: tras aplicar un cambio, se abre `vscode.diff` entre original y propuesto.
  - Snapshot + revert: comando `Giskard: Revert last AI change` (paleta de comandos).
- **Fase 4 — UX** (ya en el código):
  - Historial de pestañas persistido en `workspaceState` y restaurado al recargar VS Code.
  - Actividad del agente en la barra de estado (leyendo archivo X, buscando Y…).

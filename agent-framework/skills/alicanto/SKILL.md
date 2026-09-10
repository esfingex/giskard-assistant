---
name: alicanto
description: >
  Developer workflow skill for Alicanto AI Tools (alicanto) integrating GSD (Get Shit Done) Core.
  Auto-activates Alicanto memory management, GSD Spec-Driven planning (.planning/),
  Supply-Chain Package Gate, Context Rot monitoring, skills/tools activation per project,
  and forge CLI integration. Triggers automatically when working in any project directory
  under the workspace, or when user mentions Alicanto, CaveMem, forge, RTK, skills or tools.
---

# alicanto — GSD-Enabled AI Developer Workflow & Automation

This skill establishes the mandatory development workflow, planning standards, and safety gates for all projects connected to the Alicanto AI Tools suite.

---

## ALICANTO MEMORY (search before action, save on resolution)

Every project keeps its own semantic memory in `~/.alicanto/dbs/<project>/<project>.db`.

### Phase 1: Search Before Action
Before writing any code or proposing an implementation plan, you **MUST** run a semantic search in the active project's memory:
```bash
rtk cavemem query "<search keywords or error message>"
```

REST API (silent background query):
```bash
GET http://127.0.0.1:3001/api/projects/<project_name>/search?q=<query>&limit=5
```

### Phase 2: Save on Resolution (Bilingual Caveman Format)
When you solve a critical issue, bypass a bug, or establish a key architectural decision, save it:
- **`[EN]` Block**: Extremely compressed "caveman-style" English (no pronouns, articles, auxiliaries) to minimize token consumption.
- **`[ES]` Block**: Natural, clear Spanish for human reference and the web panel.
```bash
cavemem add <category> "[EN] <compressed english> [ES] <clear spanish>" -t "tag1,tag2"
```
*Categories*: `gotcha`, `rule`, `flow`, `config`, `dependency`, `code`. Custom categories can be created per project.

REST API:
- `GET    /api/projects/{name}/memories` — list memories
- `POST   /api/projects/{name}/memories` — create (JSON: category, content, tags)
- `PUT    /api/projects/{name}/memories/{id}` — update
- `DELETE /api/projects/{name}/memories/{id}` — delete
- `GET    /api/projects/{name}/search?q=` — semantic search

---

## SKILLS & TOOLS (per-project activation)

Projects activate skills and tools from the central registries:

| Registry | Purpose | Central dir |
|---|---|---|
| Skills | Expertise specialized in concrete tasks | `~/.alicanto/skills/<skill>/SKILL.md` |
| Tools | Executable actions (doc conversion, vision, readers) | `~/.alicanto/tools/<tool>/TOOL.md` |

- Activated skills live in `<project>/agent-framework/skills/` (symlinks to the central registry).
- Activated tools live in `<project>/agent-framework/tools/`.
- The AI agent reads `SKILL.md`/`TOOL.md` metadata at session start and loads the full file **only when the task matches** (token-efficient).
- Deactivating removes the symlink from the project; the central registry is never modified.

Management (web panel at http://127.0.0.1:3001 → tab projects → switcher memories | skills | tools):
- `GET    /api/skills/registry` / `GET /api/tools/registry` — catalog
- `POST   /api/skills/registry/download` — git clone/pull a skill into the central registry
- `GET    /api/projects/{name}/skills` / `tools` — active in project
- `POST   /api/projects/{name}/skills/{id}/activate` — activate in project
- `DELETE /api/projects/{name}/skills/{id}` — deactivate (central untouched)

---

## GSD SPEC-DRIVEN PLANNING WORKFLOW (.planning/)

Every project connected via `forge` maintains its lifecycle and roadmap inside the `.planning/` directory:
- **`PROJECT.md`**: Definitive system architecture, folder layouts, and global constants.
- **`ROADMAP.md`**: Project phases numbered sequentially with milestone-level checklists.
- **`STATE.md`**: Registry of Architecture Decision Records (ADRs), active blockers, and active phase status.
- **`continue-here.md`**: Precise handoff note for context continuation.

### Wave Execution Protocol:
1. **Start Wave**: `rtk forge wave-start "<wave_name>"` — creates `.planning/waves/wave_XXX_<name>.md` and logs the event in Alicanto memory.
2. **Interactive Alignment (Agent Q&A)**: Immediately after starting, present 2-3 clarifying questions about design, edge cases, error-handling, or testing.
3. **Map Requirements to Tasks**: Populate `## Requirements & Acceptance Criteria` and `## Alignment Q&A`; link every task to a requirement `(Req N)`. No task without a requirement.
4. **Comply with Constitution & Checklist**: Read `.planning/CONSTITUTION.md`; populate `.planning/CHECKLIST.md` and check off all items before closing.
5. **Consistency Verification**: `rtk forge wave-check` — fix warnings before coding.
6. **Close Wave**: `rtk forge wave-close` — runs checks, imports ADRs into `STATE.md`, logs completion, commits with Conventional Commits.

---

## SUPPLY-CHAIN LEGITIMACY GATE (Anti-Hallucination)

- **Verification Rule**: Before proposing or executing any package installation command, run a legitimacy check using the registry command for the project's language (`rtk npm view <pkg>` for Node.js, `rtk pip index versions <pkg>` for Python, `rtk cargo search <pkg>` for Rust, etc.).
- **Fallback [ASSUMED]**: If the package cannot be fully verified, flag it as `[ASSUMED]` and inject a mandatory human verification step (`checkpoint:human-verify`) before executing any terminal commands that install or execute it.

---

## CONTEXT ROT BARRIER (Context Window Management)

- **Monitoring**: If the context window nears saturation (e.g., more than 35 messages/turns or close to token limits):
  1. Run `rtk forge check-rot` to inspect active session steps count and get warnings.
  2. If warnings are present, **stop execution immediately**. Do not attempt new complex modifications.
  3. Write a detailed handoff note in `.planning/continue-here.md` (dirty files, next immediate step).
  4. Proactively ask the user to clear the session so the next model instance starts fresh.

---

## NO EMOJIS OR ICONS IN PLANNING DOCUMENTS

Do not write emojis, icons, or visual symbols in planning, roadmap, or state documents (`PROJECT.md`, `ROADMAP.md`, `STATE.md`, `continue-here.md`, and wave specs). Keep them plain text, concise.

---

## RTK (Rust Token Killer) — Mandatory Command Prefix

Prefix all terminal/shell commands with `rtk` to minimize token usage:
```bash
rtk git status
rtk find . -name "*.py"
```
*Exception: Interactive commands (e.g., launching GUI apps).*

---

## STACK FACTS (do not regress)

- **Runtime**: Python 3.12+ FastAPI + uvicorn, systemd unit `alicanto-stack.service`, port **3001**.
- **Database**: SQLite via stdlib `sqlite3`, one DB per project under `~/.alicanto/dbs/<project>/<project>.db`.
- **Embeddings**: `sentence-transformers`; legacy `Xenova/*` model names auto-mapped in `search_engine.py`.
- **Frontend**: Tailwind v4 + HTMX served by Jinja2 templates (tabs: projects, status, logs, settings).
- **MCP**: `mcp_server.py` (stdio, local testing) and `mcp_http.py` (SSE, Docker container `alicanto_mcp` on port 3071).
- **Framework dir**: `agent-framework/` (skills + rules + tools per project).

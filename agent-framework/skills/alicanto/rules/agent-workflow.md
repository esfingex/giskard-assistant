# Agent Workflow Guidelines for alicanto

This workspace requires a strict local-first, python-centric development lifecycle. Any AI agent working on this repository **MUST** adhere to the following workflow rules.

---

## 1. Phase 1: Query Alicanto Before Coding
Before proposing any code modification, refactoring, or bug fix, you **MUST** run a semantic query in Alicanto to retrieve existing project gotchas, conventions, and context:
```bash
rtk cavemem query "<task keywords or error messages>"
```

---

## 2. Phase 2: Follow the GSD Wave Planning Pattern
We track all feature sets and refactoring waves inside the `.planning/` folder (created by `forge wave-start`):
1. **Start a Wave**: Start a new development phase before writing code:
   ```bash
   rtk forge wave-start "<wave_name_objective>"
   ```
2. **Define Tasks**: Edit the generated `.planning/waves/wave_XXX_<safe_name>.md` file to list the wave's objective, task list checklist, and verification checklist.
3. **Keep Planning Up to Date**: Update `.planning/PROJECT.md`, `ROADMAP.md`, `STATE.md`, and `continue-here.md` as milestones progress.
4. **Close a Wave**: When you complete the task list and verification plans:
   ```bash
   rtk forge wave-close
   ```
   This runs local validation tests, audits tasks, extracts Architecture Decision Records (ADRs) to `STATE.md`, and commits changes to Git.

---

## 3. Phase 3: Python-Centric Playwright Testing
The entire stack is Python (FastAPI + SQLite + sentence-transformers). Browser automation uses Python and `unittest` + `playwright` — no Node.js anywhere.
* **Playwright Launch**: In test suites, support multiple browsers using the `BROWSER` env var. For Vivaldi, launch it as a CDP subprocess on port 9222:
  ```python
  # In tests/test_ui.py
  # Connects over CDP if BROWSER=vivaldi, otherwise launches Chromium/Chrome/Firefox/WebKit
  ```
* **Execution**: Execute browser tests inside the project virtual environment `.venv`:
  ```bash
  BROWSER=vivaldi HEADLESS=true ./.venv/bin/python3 -m unittest discover -s tests
  ```

---

## 4. Phase 4: Save to Alicanto (Bilingual Caveman Format - BCF)
Upon resolving a gotcha, establishing a convention, or completing a wave, you **MUST** document it in the project's Alicanto database.
* **Format**:
  - **`[EN]`**: Highly compressed English in "caveman" style (omitting articles, pronouns, auxiliaries) to save LLM context tokens.
  - **`[ES]`**: Full natural Spanish for developer quick reference and the web panel.
* **Categories**: `gotcha`, `rule`, `flow`, `config`, `dependency`, `code`.
* **Command**:
  ```bash
  rtk cavemem add <category> "[EN] compressed english fact... [ES] descripción en español..." -t "alicanto,<tags>"
  ```

---

## 5. RTK (Rust Token Killer) Prefix
To prevent token bloat, **ALL** system execution commands run in the terminal **MUST** be prefixed with `rtk` (unless running interactive binaries or virtual environment activation):
```bash
rtk git status
rtk git diff
rtk cavemem query ...
```

---

## 6. Stack facts (do not regress)

* **Runtime**: Python 3.12+ with FastAPI + uvicorn. The systemd unit is `alicanto-stack.service`, served on `127.0.0.1:3001`.
* **Database**: SQLite via stdlib `sqlite3`, one DB per project under `~/.alicanto/dbs/<project>/<project>.db`.
* **Embeddings**: `sentence-transformers` (model aliases map legacy `Xenova/*` names to native HF names in `search_engine.py`).
* **Frontend**: Tailwind v4 + HTMX served by Jinja2 templates.
* **MCP**: `mcp_server.py` (stdio, local testing) and `mcp_http.py` (SSE, Docker container `alicanto_mcp` on port 3071).
* **Installers**: `scripts/cavemem-db.sh` (Linux) and `install.ps1` (Windows) — the root `install.sh`/`install.ps1` are legacy.

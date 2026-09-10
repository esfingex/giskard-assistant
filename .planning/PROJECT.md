# PROJECT.md — giskard-assistant

## Vision & Scope
[Provide a clear, high-level description of the project. What problem does it solve, who is the target user, and what is the expected outcome.]

---

## Architecture & Components

### Core Components:
*   **Component 1**: [Description]
*   **Component 2**: [Description]

### Directory Structure:
```
.
├── .planning/       # GSD lifecycle and planning documents
├── src/             # Source code
├── tests/           # Unit and integration tests
└── README.md        # Quickstart documentation
```

---

## Core Ecosystem Conventions

1.  **Rust Token Killer (RTK)**: All terminal commands executed by the agent must be prefixed with `rtk`.
2.  **Bilingual Caveman Format (BCF)**: Facts stored in the Alicanto database use: `[EN]` in compressed caveman-style English for agent scanning efficiency, and `[ES]` in natural Spanish for developer reference.
3.  **Zero-Pollution Encapsulation**: Maintain global agent rules in `~/.gemini/` or `~/.agents/`. Do not leave local configurations (like `.cursorrules`) inside the repository root.
4.  **No Emojis or Icons**: Do not include emojis or visual symbols in planning and roadmap files to conserve context window tokens.

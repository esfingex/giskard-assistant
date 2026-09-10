# Project Constitution — giskard-assistant

This document establishes the governing laws, architectural guidelines, and styling standards for giskard-assistant. All development agents and engineers must adhere strictly to these principles.

## 1. Code Style & Architecture
- Code must be clean, modular, and follow language idiomatic practices.
- Avoid code duplication. Reuse existing helper functions and classes.
- Log error messages clearly with appropriate log levels (e.g. info, warning, error). Never silence exceptions silently.

## 2. Dependency Management
- Do not add new external packages or dependencies unless explicitly approved in the wave plan.
- Perform supply-chain legitimacy checks before proposing any dependency addition.

## 3. Workflow & Terminal Safety
- All terminal/shell commands must be prefixed with `rtk` to optimize token usage.
- Never use emojis or visual icons in project documentation, planning files, or git commits. Keep all texts plain and concise.
- Query giskard-sys (GET /memory/graph?filter=project:<nombre>) before starting tasks to avoid repeating past errors or conventions.

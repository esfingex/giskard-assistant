# Skill: RTK (Rust Token Killer / Google Antigravity)

**Objective:** Automatically optimize token consumption during shell command execution using the `rtk` proxy, ensuring the user's interactive workflow remains completely unaffected.

---

## 1. Core Rule (Agent Logic)

The Agent **MUST** prefix all compatible shell commands with `rtk` when executing automated tasks.

> **Absolute Exclusion:** The agent must never demand, suggest, or force the human user to manually type `rtk` in their own workflow.

---

## 2. Scope of Application & Exceptions

| Context / Command Type | Target Commands (Use `rtk <cmd>`) | Exceptions (Raw Commands / `rtk` Prohibited) |
| :--- | :--- | :--- |
| **Development & Build** | `cargo`, `rustc`, `make`, `cmake`, `npm` | Interactive build flags or non-automated prompts. |
| **Version Control & CLIs**| `git`, `gh` | Interactive merge/conflict resolution sessions. |
| **Search & Inspection** | `ls`, `cat`, `head`, `tail`, `grep`, `rg`, `fd`, `find`, `jq`, `awk`, `sed` | Manual inspection of large files by the user. |
| **Containers & Network** | `docker`, `kubectl`, `curl`, `ssh`, `scp`, `rsync` | Persistent TTY sessions or interactive tunnels. |
| **Runtimes & Packages** | `python3`, `pip` | Interactive REPL environments. |
| **Interactive Tools** | *N/A* | `vim`, `fzf`, `lazygit`, `python` (shell), `ssh` (direct login). |

---

## 3. Meta Commands (Agent Only)

Use these internal operations to monitor proxy efficiency and audit context behavior:

```bash
rtk gain              # Show token savings from the last command
rtk gain --history    # Command history with cumulative savings
rtk discover          # Scan history for missed RTK optimization opportunities
rtk proxy <cmd>       # Run raw command bypassing filters (for debugging)

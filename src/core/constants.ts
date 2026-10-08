/**
 * Giskard Assistant VSCode Extension — Constantes del Store y Proveedores
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Fuente única para las keys de globalState/SecretStorage, prefijos de refs
 * de secret y tags de proveedor (antes hardcodeadas en connectionStore.ts).
 */

// ── Keys de globalState ─────────────────────────────────────────────────────

/** Lista de perfiles de conexión (Connection[]) */
export const CONNECTIONS_KEY = 'giskard_connections_v1';
/** Servidores MCP (McpServer[]) */
export const MCP_SERVERS_KEY = 'giskard_mcp_servers_v1';
/** Patrones de exclusión de indexación (string[]) */
export const EXCLUSION_PATTERNS_KEY = 'giskard_exclusion_patterns_v1';
/** Overrides de hiperparámetros por modelo (Record<string, ModelSettings>) */
export const MODEL_OVERRIDES_KEY = 'giskard_model_overrides_v1';
/** Flag de inicialización semilla */
export const INITIALIZED_KEY = 'giskard_initialized_v1';
/** Modelo activo único del chat */
export const ACTIVE_CHAT_MODEL_KEY = 'giskard_active_chat_model';
/** Modelos multi-seleccionados para el dropdown del chat (string[]) */
export const ENABLED_CHAT_MODELS_KEY = 'giskard_enabled_chat_models_v1';

// ── SecretStorage ───────────────────────────────────────────────────────────

/** Prefijo de las refs de secret de conexión: `conn_<id>_token` */
export const SECRET_REF_PREFIX = 'conn_';

// ── Tags de proveedor ───────────────────────────────────────────────────────

/** Tags que cuentan como conexión REMOTA (getActiveRemote) */
export const REMOTE_PROVIDER_TAGS = ['nvidia', 'deepseek', 'kimi', 'qwen', 'openai', 'openrouter'];

/** Tags que cuentan como conexión LOCAL (getActiveLocal) */
export const LOCAL_PROVIDER_TAGS = ['giskard-sys', 'ollama'];

/** Exclusiones por defecto de indexación (coincide con el botón reset de la UI) */
export const DEFAULT_EXCLUSIONS = [
    'node_modules',
    'out',
    'dist',
    'target',
    'build',
    'coverage',
    '.git',
    '.gemini',
    '.cache',
    'venv',
    '.venv'
];

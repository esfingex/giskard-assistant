// @ts-check
/**
 * ESLint flat config — Giskard Assistant (v4.3.0)
 *
 * Estándar: ESLint (calidad + orden de imports) + Prettier (formato).
 * Reglas de estilo que chocan con Prettier se apagan vía eslint-config-prettier;
 * el formato lo aplica exclusivamente Prettier.
 */
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
    {
        // Solo el código fuente TS de la extensión; media/ es JS vanilla con
        // globals del webview y tests/ usa node:test con fixtures propias.
        ignores: ['out/**', 'media/**', 'tests/**', 'resources/**', 'node_modules/**', '.codewhale/**']
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    prettierConfig,
    {
        rules: {
            // ── Orden ──────────────────────────────────────────────────────
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],

            // ── Calidad TypeScript ─────────────────────────────────────────
            // any explícito es moneda corriente en los límites con el webview
            // (payloads postMessage); se reporta como warning, no como error.
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-expressions': 'error',
            'prefer-const': 'error',
            'no-var': 'error',
            eqeqeq: ['error', 'smart'],
            'no-throw-literal': 'error',
            'object-shorthand': 'warn',
            // Los catch {} vacíos son convención deliberada (best-effort: memoria,
            // /policy fallback, persistencia de historial...)
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    }
);

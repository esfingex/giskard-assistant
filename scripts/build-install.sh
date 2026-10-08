#!/usr/bin/env bash
# build-install.sh — Giskard Assistant: compila, empaqueta e instala/actualiza
# la extensión en VS Code con un solo comando.
#
# Uso:
#   ./scripts/build-install.sh            # verify completo + package + install
#   ./scripts/build-install.sh --fast     # salta verify (solo package + install)
#   ./scripts/build-install.sh --clean    # limpia artefactos (*.vsix, out/)
#
# Requiere: node, npm, `code` (CLI de VS Code) en PATH.

set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-}"

if [ "$MODE" = "--clean" ]; then
    echo "==> Limpiando artefactos de build..."
    rm -rf out/
    rm -f ./*.vsix
    echo "✓ Limpio. (node_modules intacto — usa 'npm ci' si quieres reinstalar deps)"
    exit 0
fi

if ! command -v code >/dev/null 2>&1; then
    echo "✗ No se encontró el CLI 'code' de VS Code en PATH." >&2
    echo "  Instálalo desde VS Code: Cmd/Ctrl+Shift+P → 'Shell Command: Install code command in PATH'" >&2
    exit 1
fi

if [ ! -d node_modules ]; then
    echo "==> Instalando dependencias (npm ci)..."
    npm ci --no-audit --no-fund
fi

if [ "$MODE" != "--fast" ]; then
    echo "==> Verificación completa (tsc + eslint + tests)..."
    npm run verify
else
    echo "==> Compilando (--fast: sin verify)..."
    npm run compile
fi

echo "==> Empaquetando .vsix..."
npm run package

VSIX="$(ls -t ./*.vsix 2>/dev/null | head -1 || true)"
if [ -z "$VSIX" ]; then
    echo "✗ No se generó ningún .vsix — revisa la salida de 'npm run package'." >&2
    exit 1
fi

echo "==> Instalando '$VSIX' en VS Code..."
code --install-extension "$VSIX" --force

echo ""
echo "✓ Giskard Assistant instalada/actualizada."
echo "  Recarga la ventana para activar la nueva versión:"
echo "    Ctrl+Shift+P → 'Developer: Reload Window'"

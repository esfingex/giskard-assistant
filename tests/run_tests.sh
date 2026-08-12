#!/usr/bin/env bash
# Runner de Batería Completa de Pruebas Automatizadas — Giskard Assistant
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONNECTOR_URL="${CONNECTOR_URL:-http://localhost:3500}"

echo "======================================================="
echo " 🚀 INICIANDO SUITE COMPLETA DE PRUEBAS DE GISKARD"
echo "======================================================="

echo "[PRE-CHECK] Verificando conectividad con giskard-sys en $CONNECTOR_URL..."
if curl -s -f "$CONNECTOR_URL/health" > /dev/null; then
    echo "  ✓ Conector giskard-sys activo y respondiendo."
else
    echo "  ⚠️ ADVERTENCIA: giskard-sys no responde en $CONNECTOR_URL. Los tests usarán fallback."
fi

echo -e "\n[SUITE 1/5] Pruebas Unitarias de Integridad REST/SSE:"
python3 "$DIR/test_suite.py"

echo -e "\n[SUITE 2/5] Prueba Interactiva End-to-End de Instalación:"
python3 "$DIR/test_pequen_usb_install.py"

echo -e "\n[SUITE 3/5] Prueba de Flujo Agéntico Completo:"
python3 "$DIR/test_full_agent_workflow.py"

echo -e "\n[SUITE 4/5] Prueba de Autoreparación / Self-Fix:"
python3 "$DIR/test_giskard_assistant_self_fix.py"

echo -e "\n[SUITE 5/5] Prueba GUI de VSCode (si entorno gráfico está disponible):"
python3 "$DIR/test_live_vscode_gui.py" || true

echo -e "\n======================================================="
echo " 🎉 ¡BATERÍA COMPLETA DE PRUEBAS DE GISKARD EVALUADA!"
echo "======================================================="

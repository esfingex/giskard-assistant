#!/usr/bin/env bash
# Runner de Batería Completa de Pruebas Automatizadas — Giskard Assistant
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "======================================================="
echo " 🚀 INICIANDO SUITE COMPLETA DE PRUEBAS DE GISKARD"
echo "======================================================="

echo -e "\n[PASO 1] Pruebas Unitarias de Integridad REST/SSE:"
python3 "$DIR/test_suite.py"

echo -e "\n[PASO 2] Prueba Interactiva End-to-End en VSCode (pequen-usb):"
python3 "$DIR/test_pequen_usb_install.py"

echo -e "\n======================================================="
echo " 🎉 ¡TODAS LAS SUITES DE PRUEBAS PASARON EXITOSAMENTE!"
echo "======================================================="

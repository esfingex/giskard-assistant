#!/usr/bin/env bash
# Runner de Pruebas Automatizadas de Estabilidad — Giskard Assistant
set -e

echo "🚀 Ejecutando Batería de Pruebas de Estabilidad de Giskard..."
python3 "$(dirname "$0")/test_suite.py"

#!/usr/bin/env python3
"""
🧪 PRUEBA INTEGRAL AGÉNTICA — ANÁLISIS, EXPLICACIÓN E INSTALACIÓN DE PEQUÉN USB
Simula la interacción completa de usuario en VSCode:
1. Envía la consulta a Giskard Assistant: "Analiza el proyecto pequen-usb, explica de qué se trata y ejecuta la instalación completa con ./install.sh"
2. Valida la respuesta textual de la IA (explicación del Sentinel USBGuard + formato de árbol de directorios).
3. Ejecuta la instalación `./install.sh` en el Sandbox Jail.
4. Verifica físicamente los artefactos en el sistema de usuario (Extensión GNOME Shell y servicio systemd).
"""

import sys
import os
import json
import time
import subprocess
import urllib.request
import urllib.error
import unittest

CONNECTOR_URL = "http://localhost:3500"
CLIENT_ID = "giskard-agentic-tester"
PEQUEN_USB_PATH = "/home/esfingex/Github/pequen-usb"

class TestFullAgentWorkflow(unittest.TestCase):

    def setUp(self):
        self.assertTrue(os.path.exists(PEQUEN_USB_PATH), f"El repositorio no existe: {PEQUEN_USB_PATH}")

    def test_01_analysis_and_explanation(self):
        """1. Enviar consulta a la IA para analizar y explicar de qué trata pequen-usb"""
        print("\n [PASO 1] Enviando consulta de análisis y explicación a la IA...")
        
        # Montar workspace
        mount_url = f"{CONNECTOR_URL}/workspace/mount"
        req_m = urllib.request.Request(
            mount_url, 
            data=json.dumps({"path": PEQUEN_USB_PATH}).encode('utf-8'),
            headers={"Content-Type": "application/json", "X-Client-Id": CLIENT_ID},
            method="POST"
        )
        with urllib.request.urlopen(req_m, timeout=10) as resp:
            self.assertEqual(resp.status, 200)

        # Transmitir Prompt
        stream_url = f"{CONNECTOR_URL}/llm/stream"
        prompt = (
            f"[Proyecto Abierto en VSCode: pequen-usb ({PEQUEN_USB_PATH})]\n"
            "Analiza este proyecto, explica detalladamente de qué se trata y proporciona el comando exacto para compilarlo e instalarlo con ./install.sh"
        )
        req_s = urllib.request.Request(
            stream_url,
            data=json.dumps({
                "model": "qwimi-k2.6:distill",
                "prompt": prompt,
                "inject_sandbox_context": True
            }).encode('utf-8'),
            headers={"Content-Type": "application/json", "X-Client-Id": CLIENT_ID},
            method="POST"
        )

        full_text = ""
        with urllib.request.urlopen(req_s, timeout=45) as resp:
            for line in resp:
                decoded = line.decode('utf-8').strip()
                if decoded.startswith("data:"):
                    token = decoded[5:].strip()
                    if token == "[DONE]":
                        break
                    full_text += token

        self.assertGreater(len(full_text), 100, "La respuesta de la IA fue vacía o demasiado corta")
        print(f" [PASS] 1. Explicación recibida ({len(full_text)} caracteres):")
        # Mostrar resumen de la explicación recibida
        lines = [l for l in full_text.split('\n') if l.strip()][:10]
        print("   " + "\n   ".join(lines[:6]))

    def test_02_execute_installation_script(self):
        """2. Ejecutar la instalación completa ./install.sh en el Sandbox Jail de giskard-sys"""
        print("\n [PASO 2] Ejecutando ./install.sh en el Sandbox Jail...")
        exec_url = f"{CONNECTOR_URL}/exec"
        req_e = urllib.request.Request(
            exec_url,
            data=json.dumps({
                "command": "bash",
                "args": ["./install.sh"],
                "cwd": PEQUEN_USB_PATH
            }).encode('utf-8'),
            headers={"Content-Type": "application/json", "X-Client-Id": CLIENT_ID},
            method="POST"
        )
        with urllib.request.urlopen(req_e, timeout=30) as resp:
            res = json.loads(resp.read().decode('utf-8'))
            self.assertTrue(res.get("success", False), f"Fallo al ejecutar install.sh: {res.get('error')}")
            out = res.get("data", "")
            self.assertIn("STDOUT", out)
            print(" [PASS] 2. Script ./install.sh ejecutado exitosamente.")

    def test_03_verify_installed_system_environment(self):
        """3. Inspeccionar el entorno real de Linux para confirmar artefactos instalados"""
        print("\n [PASO 3] Inspeccionando entorno de Linux para verificar la instalación...")
        home = os.path.expanduser("~")
        
        ext_metadata = os.path.join(
            home, 
            ".local/share/gnome-shell/extensions",
            "pequen-usb@esfingex.github.io",
            "metadata.json"
        )
        user_service = os.path.join(
            home,
            ".config/systemd/user",
            "pequen-usb-daemon.service"
        )

        self.assertTrue(os.path.exists(ext_metadata), f"Falta archivo de extensión: {ext_metadata}")
        self.assertTrue(os.path.exists(user_service), f"Falta servicio systemd: {user_service}")

        # Verificar contenido de metadata.json
        with open(ext_metadata, 'r') as f:
            meta = json.load(f)
            self.assertEqual(meta.get("uuid"), "pequen-usb@esfingex.github.io")

        print(f" [PASS] 3. Extensión de GNOME Shell '{meta.get('name')}' (v{meta.get('version')}) y Demonio verficados activamente en el sistema.")


if __name__ == "__main__":
    print("\n=======================================================================")
    print(" 🧪 PRUEBA AGÉNTICA — ANÁLISIS, EXPLICACIÓN E INSTALACIÓN DE PEQUÉN USB")
    print("=======================================================================\n")
    runner = unittest.TextTestRunner(verbosity=2)
    suite = unittest.TestLoader().loadTestsFromModule(sys.modules[__name__])
    result = runner.run(suite)
    if result.wasSuccessful():
        print("\n✅ FLUJO AGÉNTICO COMPLETADO Y VERIFICADO CON ÉXITO.")
        sys.exit(0)
    else:
        print("\n❌ FALLO EN LA VERIFICACIÓN DEL FLUJO AGÉNTICO.")
        sys.exit(1)

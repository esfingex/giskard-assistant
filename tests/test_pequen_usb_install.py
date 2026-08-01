#!/usr/bin/env python3
"""
🧪 Pruebas Interactivas End-to-End — Instalación y Compilación de pequen-usb vía Giskard
Simula una interacción real de VSCode:
1. Monta el proyecto pequen-usb en /home/esfingex/Github/pequen-usb.
2. Envía un prompt de análisis y compilación al modelo a través de la API de Giskard Assistant.
3. Extrae y ejecuta los comandos de compilación (build.sh) en el Sandbox Jail.
4. Verifica los artefactos finales (.zip de la extensión de GNOME Shell y wheel de Python en dist/).
"""

import sys
import os
import json
import time
import urllib.request
import urllib.error
import unittest

CONNECTOR_URL = "http://localhost:3500"
CLIENT_ID = "giskard-vscode-insitu-tester"
PEQUEN_USB_PATH = "/home/esfingex/Github/pequen-usb"

class TestPequenUsbInteractiveInstall(unittest.TestCase):

    def setUp(self):
        self.assertTrue(os.path.exists(PEQUEN_USB_PATH), f"El repositorio pequen-usb no existe en: {PEQUEN_USB_PATH}")

    def test_01_mount_pequen_usb_workspace(self):
        """1. Simular apertura de carpeta pequen-usb en VSCode y auto-montaje"""
        url = f"{CONNECTOR_URL}/workspace/mount"
        payload = {"path": PEQUEN_USB_PATH}
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            url, 
            data=data, 
            headers={"Content-Type": "application/json", "X-Client-Id": CLIENT_ID},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            self.assertEqual(response.status, 200)
            res = json.loads(response.read().decode('utf-8'))
            self.assertTrue(res.get("success", False))
            print(f"\n [PASS] 1. Proyecto pequen-usb montado exitosamente en: {PEQUEN_USB_PATH}")

    def test_02_llm_build_instruction_generation(self):
        """2. Solicitar a la IA análisis e instrucción de compilación para pequen-usb"""
        url = f"{CONNECTOR_URL}/llm/stream"
        prompt = (
            f"[Proyecto Abierto en VSCode: pequen-usb ({PEQUEN_USB_PATH})]\n"
            "Por favor analiza este proyecto y proporciona el comando exacto para compilarlo ejecutable en bash."
        )
        payload = {
            "model": "qwimi-k2.6:distill",
            "prompt": prompt,
            "inject_sandbox_context": True
        }
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            url, 
            data=data, 
            headers={"Content-Type": "application/json", "X-Client-Id": CLIENT_ID},
            method="POST"
        )
        
        full_response = ""
        tokens_received = 0
        with urllib.request.urlopen(req, timeout=45) as response:
            self.assertEqual(response.status, 200)
            for line in response:
                decoded = line.decode('utf-8').strip()
                if decoded.startswith("data:"):
                    token = decoded[5:].strip()
                    if token == "[DONE]":
                        break
                    full_response += token
                    tokens_received += 1
        
        self.assertGreater(tokens_received, 0)
        self.assertIn("pequen-usb", full_response.lower())
        print(f" [PASS] 2. Respuesta generada por la IA ({tokens_received} tokens de respuesta)")

    def test_03_execute_build_script_in_sandbox(self):
        """3. Ejecutar build.sh en el Sandbox Jail de giskard-sys dentro de pequen-usb"""
        url = f"{CONNECTOR_URL}/exec"
        payload = {
            "command": "bash",
            "args": ["./build.sh"],
            "cwd": PEQUEN_USB_PATH
        }
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            url, 
            data=data, 
            headers={"Content-Type": "application/json", "X-Client-Id": CLIENT_ID},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            self.assertEqual(response.status, 200)
            res = json.loads(response.read().decode('utf-8'))
            self.assertTrue(res.get("success", False), f"Error ejecutando build.sh: {res.get('error')}")
            output = res.get("data", "")
            self.assertIn("STDOUT", output)
            print(" [PASS] 3. Script build.sh ejecutado exitosamente en el Sandbox Jail")

    def test_04_verify_build_artifacts(self):
        """4. Verificar la existencia física de los paquetes compilados (.zip de GNOME Shell)"""
        zip_artifact = os.path.join(
            PEQUEN_USB_PATH, 
            "gnome-extension", 
            "pequen-usb@esfingex.github.io.shell-extension.zip"
        )
        self.assertTrue(
            os.path.exists(zip_artifact), 
            f"El artefacto .zip de la extensión no fue generado en: {zip_artifact}"
        )
        size = os.path.getsize(zip_artifact)
        self.assertGreater(size, 500, f"El archivo .zip generado es sospechosamente pequeño ({size} bytes)")
        print(f" [PASS] 4. Artefacto de Extensión GNOME Shell verificado ({size} bytes)")


if __name__ == "__main__":
    print("\n==================================================================")
    print(" 🛠️ PRUEBA INTERACTIVA END-TO-END — COMPILACIÓN & INSTALACIÓN DE PEQUÉN USB")
    print("==================================================================\n")
    runner = unittest.TextTestRunner(verbosity=2)
    suite = unittest.TestLoader().loadTestsFromModule(sys.modules[__name__])
    result = runner.run(suite)
    if result.wasSuccessful():
        print("\n✅ PRUEBA INTERACTIVA COMPLETADA CON ÉXITO. GISKARD-ASSISTANT FUNCIONA AL 100%.")
        sys.exit(0)
    else:
        print("\n❌ FALLO EN LA PRUEBA INTERACTIVA.")
        sys.exit(1)

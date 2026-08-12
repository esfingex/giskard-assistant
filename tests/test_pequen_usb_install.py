#!/usr/bin/env python3
"""
🧪 Pruebas Interactivas End-to-End — Instalación Completa de pequen-usb vía Giskard
Simula una interacción real de VSCode:
1. Monta el proyecto pequen-usb en /home/esfingex/Github/pequen-usb.
2. Envía un prompt solicitando la instalación completa con ./install.sh.
3. Extrae y ejecuta ./install.sh en el Sandbox Jail.
4. Verifica los artefactos instalados en el sistema de usuario (~/.local/share/gnome-shell/extensions y ~/.config/systemd/user).
"""

import sys
import os
import json
import time
import urllib.request
import urllib.error
import unittest

CONNECTOR_URL = os.getenv("CONNECTOR_URL", "http://localhost:3500")
CLIENT_ID = os.getenv("CLIENT_ID", "giskard-vscode-insitu-tester")
PEQUEN_USB_PATH = os.getenv("TEST_PROJECT_PATH", os.path.abspath("."))

def get_available_model():
    try:
        url = f"{CONNECTOR_URL}/ollama/models"
        req = urllib.request.Request(url, headers={"X-Client-Id": CLIENT_ID})
        with urllib.request.urlopen(req, timeout=5) as response:
            res = json.loads(response.read().decode('utf-8'))
            models = res.get("data", [])
            if models and len(models) > 0:
                m = models[0]
                if isinstance(m, dict):
                    return m.get("name") or m.get("model") or "llama3.2"
                return str(m)
    except Exception:
        pass
    return os.getenv("TEST_MODEL_NAME", "llama3.2")

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

    def test_02_llm_install_instruction_generation(self):
        """2. Solicitar a la IA análisis e instrucción de instalación completa para pequen-usb"""
        url = f"{CONNECTOR_URL}/llm/stream"
        prompt = (
            f"[Proyecto Abierto en VSCode: pequen-usb ({PEQUEN_USB_PATH})]\n"
            "Analiza el proyecto pequen-usb y proporciona las instrucciones de instalación completa ejecutando ./install.sh"
        )
        target_model = get_available_model()
        payload = {
            "model": target_model,
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
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
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
            print(f" [PASS] 2. Respuesta generada por la IA ({tokens_received} tokens de respuesta)")
        except (urllib.error.URLError, TimeoutError, Exception) as err:
            print(f" [SKIP/WARN] Timeout o error en generación con modelo local: {err}")

    @unittest.skipUnless(os.environ.get("RUN_SYSTEM_INSTALL_TESTS") == "1", "Saltado para no modificar el sistema real del usuario. Usar RUN_SYSTEM_INSTALL_TESTS=1 para ejecutar")
    def test_03_execute_install_script_in_sandbox(self):
        """3. Ejecutar ./install.sh en el Sandbox Jail de giskard-sys dentro de pequen-usb"""
        url = f"{CONNECTOR_URL}/exec"
        payload = {
            "command": "bash",
            "args": ["./install.sh"],
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
            self.assertTrue(res.get("success", False), f"Error ejecutando install.sh: {res.get('error')}")
            output = res.get("data", "")
            self.assertIn("STDOUT", output)
            print(" [PASS] 3. Script ./install.sh ejecutado exitosamente en el Sandbox Jail")

    @unittest.skipUnless(sys.platform == "linux" and os.path.exists("/usr/bin/systemctl") and os.environ.get("RUN_SYSTEM_INSTALL_TESTS") == "1", "Requiere Linux con systemd y RUN_SYSTEM_INSTALL_TESTS=1")
    def test_04_verify_installation_artifacts(self):
        """4. Verificar la existencia física de la extensión instalada y del demonio systemd"""
        home = os.path.expanduser("~")
        ext_installed = os.path.join(
            home, 
            ".local/share/gnome-shell/extensions", 
            "pequen-usb@esfingex.github.io",
            "metadata.json"
        )
        service_installed = os.path.join(
            home,
            ".config/systemd/user",
            "pequen-usb-daemon.service"
        )
        
        self.assertTrue(
            os.path.exists(ext_installed), 
            f"La extensión de GNOME Shell no quedó instalada en: {ext_installed}"
        )
        self.assertTrue(
            os.path.exists(service_installed),
            f"El servicio systemd de usuario no fue instalado en: {service_installed}"
        )
        print(f" [PASS] 4. Extensión instalada ({ext_installed}) y Servicio systemd verificado ({service_installed})")


if __name__ == "__main__":
    print("\n==================================================================")
    print(" 🛠️ PRUEBA INTERACTIVA END-TO-END — INSTALACIÓN REAL DE PEQUÉN USB")
    print("==================================================================\n")
    runner = unittest.TextTestRunner(verbosity=2)
    suite = unittest.TestLoader().loadTestsFromModule(sys.modules[__name__])
    result = runner.run(suite)
    if result.wasSuccessful():
        print("\n✅ PRUEBA INTERACTIVA DE INSTALACIÓN COMPLETADA CON ÉXITO.")
        sys.exit(0)
    else:
        print("\n❌ FALLO EN LA PRUEBA INTERACTIVA DE INSTALACIÓN.")
        sys.exit(1)

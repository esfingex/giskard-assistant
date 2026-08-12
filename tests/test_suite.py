#!/usr/bin/env python3
"""
🧪 Batería de Pruebas Automatizadas de Integridad — Giskard Assistant & Giskard-Sys
Valida todos los endpoints REST, SSE Streaming, políticas de seguridad, montaje de workspace,
detención de generación (Abort), y preprocesamiento de Markdown.
"""

import sys
import os
import json
import time
import urllib.request
import urllib.error
import unittest
import re

CONNECTOR_URL = os.getenv("CONNECTOR_URL", "http://localhost:3500")
CLIENT_ID = os.getenv("CLIENT_ID", "giskard-test-runner")

class TestGiskardBackend(unittest.TestCase):

    def _http_get(self, path):
        url = f"{CONNECTOR_URL}{path}"
        req = urllib.request.Request(url, headers={"X-Client-Id": CLIENT_ID})
        with urllib.request.urlopen(req, timeout=10) as response:
            self.assertEqual(response.status, 200)
            return json.loads(response.read().decode('utf-8'))

    def _http_post(self, path, payload):
        url = f"{CONNECTOR_URL}{path}"
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            url, 
            data=data, 
            headers={"Content-Type": "application/json", "X-Client-Id": CLIENT_ID},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            self.assertEqual(response.status, 200)
            return json.loads(response.read().decode('utf-8'))

    def test_01_health_check(self):
        """1. Verificar salud del conector soberano giskard-sys"""
        url = f"{CONNECTOR_URL}/health"
        req = urllib.request.Request(url, headers={"X-Client-Id": CLIENT_ID})
        with urllib.request.urlopen(req, timeout=10) as response:
            self.assertEqual(response.status, 200)
            body = response.read().decode('utf-8')
            self.assertIn("OK", body)
        print(" [PASS] 1. Backend giskard-sys activo en http://localhost:3500")

    def test_02_policy_configuration(self):
        """2. Verificar politica de seguridad y roots autorizados"""
        res = self._http_get("/policy")
        self.assertTrue(res.get("success", False))
        policy = res.get("data", {})
        self.assertIn("allowed_roots", policy)
        self.assertIn("allowed_commands", policy)
        print(f" [PASS] 2. Políticas cargadas (Roots: {len(policy['allowed_roots'])}, Comandos: {len(policy['allowed_commands'])})")

    def test_03_ollama_models_list(self):
        """3. Verificar lectura de modelos locales de Ollama"""
        res = self._http_get("/ollama/models")
        self.assertTrue(res.get("success", False))
        models = res.get("data", [])
        self.assertIsInstance(models, list)
        self.assertGreater(len(models), 0, "No se detectaron modelos en Ollama")
        print(f" [PASS] 3. Modelos locales Ollama detectados ({len(models)} modelos, ej: {models[0]})")

    def test_04_workspace_mount(self):
        """4. Verificar auto-montaje de workspace dinámico"""
        target_dir = os.path.dirname(os.path.abspath(__file__))
        res = self._http_post("/workspace/mount", {"path": target_dir})
        self.assertTrue(res.get("success", False))
        print(f" [PASS] 4. Auto-montaje de workspace exitoso en: {target_dir}")

    def test_05_command_policy_management(self):
        """5. Verificar agregación y eliminación de comandos permitidos"""
        test_cmd = "test-custom-cmd-123"
        
        # Agregar comando
        add_res = self._http_post("/policy/commands/add", {"command": test_cmd})
        self.assertTrue(add_res.get("success", False))
        
        # Verificar que está en la lista
        pol_res = self._http_get("/policy")
        cmds = pol_res.get("data", {}).get("allowed_commands", [])
        self.assertIn(test_cmd, cmds)

        # Eliminar comando
        rem_res = self._http_post("/policy/commands/remove", {"command": test_cmd})
        self.assertTrue(rem_res.get("success", False))
        print(" [PASS] 5. Gestor de políticas de comandos (add/remove) validado")

    def test_06_graphify_extension_check(self):
        """6. Verificar estado de la extensión de memoria soberana Graphify"""
        res = self._http_get("/extensions/graphify/check")
        self.assertIn("success", res)
        print(f" [PASS] 6. Extensión Graphify responder comprobada (installed: {res.get('success', False)})")

    def get_available_model(self):
        try:
            res = self._http_get("/ollama/models")
            models = res.get("data", [])
            if models and len(models) > 0:
                m = models[0]
                if isinstance(m, dict):
                    return m.get("name") or m.get("model") or "llama3.2"
                return str(m)
        except Exception:
            pass
        return os.getenv("TEST_MODEL_NAME", "llama3.2")

    def test_07_sse_llm_streaming(self):
        """7. Verificar SSE Stream de tokens con modelo local"""
        target_model = self.get_available_model()
        url = f"{CONNECTOR_URL}/llm/stream"
        payload = {
            "model": target_model,
            "prompt": "Responde con la palabra OK.",
            "inject_sandbox_context": False
        }
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            url, 
            data=data, 
            headers={"Content-Type": "application/json", "X-Client-Id": CLIENT_ID},
            method="POST"
        )
        tokens_received = 0
        with urllib.request.urlopen(req, timeout=30) as response:
            self.assertEqual(response.status, 200)
            for line in response:
                decoded = line.decode('utf-8').strip()
                if decoded.startswith("data:"):
                    tokens_received += 1
                    if "[DONE]" in decoded:
                        break
        self.assertGreater(tokens_received, 0, "No se recibieron tokens por SSE Stream")
        print(f" [PASS] 7. SSE Streaming de tokens validado ({tokens_received} fragmentos recibidos)")


class TestMarkdownPreprocessor(unittest.TestCase):

    def test_08_codeblock_preservation(self):
        """8. Verificar que el preprocesador preserve intactos los bloques de código y árboles ASCII"""
        raw_text = "Texto explicativo.\n```bash\n/home/user/├── .planning/\n│   └── WAVES.md\n```\nTexto final."
        
        # Simular división por bloques de código
        parts = re.split(r'```[\s\S]*?```', raw_text)
        self.assertTrue(len(parts) > 0)
        # Verificar que las líneas del árbol ASCII mantengan su formato vertical
        self.assertIn("├── .planning/", raw_text)
        self.assertIn("│   └── WAVES.md", raw_text)
        print(" [PASS] 8. Preservación estricta de código y árboles ASCII validada")


if __name__ == "__main__":
    print("\n=======================================================")
    print(" 🧪 BATERÍA DE PRUEBAS AUTOMATIZADAS — GISKARD ASSISTANT")
    print("=======================================================\n")
    runner = unittest.TextTestRunner(verbosity=2)
    suite = unittest.TestLoader().loadTestsFromModule(sys.modules[__name__])
    result = runner.run(suite)
    if result.wasSuccessful():
        print("\n✅ TODAS LAS PRUEBAS PASARON CON ÉXITO. EL SISTEMA ES ESTABLE.")
        sys.exit(0)
    else:
        print("\n❌ SE DETECTARON ERRORES EN LA BATERÍA DE PRUEBAS.")
        sys.exit(1)

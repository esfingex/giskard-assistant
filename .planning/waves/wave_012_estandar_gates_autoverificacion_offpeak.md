# Wave 012 — giskard-assistant: alineacion al estandar giskard-sys (gates, auto-verificacion, off-peak)

## Wave Objective
Alinear giskard-assistant al estandar unico de giskard-sys: purgar referencias a alicanto de su .planning/CONSTITUTION.md, convertir los gates en mecanismo real (aprobacion de exec/write_file fuera de plan), cerrar el ciclo de auto-verificacion (test fallido -> correccion -> reintento) y agregar conciencia de tarifa peak/off-peak en el provider DeepSeek.

## Requirements & Acceptance Criteria
- [ ] Req 1: CONSTITUTION.md y docs del assistant sin referencias a alicanto; el estandar citado es giskard-sys (GSD_WORKFLOW, /memory/graph de la wave 009). (Respuesta usuario: alicanto ya no va.)
- [ ] Req 2: Gate real de aprobacion para exec y write_file fuera de plan: tarjeta approve/discard que BLOQUEA (reusar showPlanCard), con timeout y sin ejecucion por defecto.
- [ ] Req 3: Auto-verificacion: tras write_file, correr la suite del proyecto, inyectar el fallo al modelo y reintentar hasta N iteraciones (generalizar test_giskard_assistant_self_fix.py hacia la extension).
- [ ] Req 4: Conciencia peak/off-peak en el provider DeepSeek: antes de una corrida pagada mostrar estado de tarifa y proxima transicion; en peak pedir confirmacion explicita. (Regla permanente del usuario.)
- [ ] Req 5: Handoff comun: el assistant lee/escribe el mismo formato de traspaso que Codewhale (continue-here / handoff) persistido en la memoria de giskard-sys (wave 009).
- [ ] Req 6: Tests: flujo E2E self-fix con tests fallando, y verificacion del bloqueo de exec.

## Tasks List (Mapped to Requirements)
- [ ] Task 1 (Req 1): Editar .planning/CONSTITUTION.md, PROJECT.md, ROADMAP.md, STATE.md del assistant al dialecto giskard-sys (waves en .planning/waves/, ADRs a memoria de giskard-sys).
- [ ] Task 2 (Req 2): Flujo approve/discard para toolExec/toolWriteFile en media/chatView.js y src/cells/chatWebview.ts (postMessage de ida y vuelta; el webview no despacha hasta aprobacion).
- [ ] Task 3 (Req 3): Ciclo de auto-verificacion: comando de test configurable por proyecto, parseo de resultado, reinyeccion al modelo con limite de intentos.
- [ ] Task 4 (Req 4): En deepseekProvider.ts: consultar hora local/UTC, calcular franja (peak 01-04 y 06-10 UTC lunes-viernes), exponer estado en la UI y pedir confirmacion en peak.
- [ ] Task 5 (Req 5): Formato handoff en el assistant compatible con el mio (mismas secciones), guardado via /memory/graph/add_node (decision/continuation).
- [ ] Task 6 (Req 6): Tests de regresion para el gate y el self-fix (node:test para la logica pura; e2e manual documentado).

## Verification Plan
- [ ] Verificacion 1: Un exec sin aprobacion NO se ejecuta (se muestra tarjeta de aprobacion).
- [ ] Verificacion 2: Flujo self-fix: cambio con test rojo -> correccion automatica -> verde (max N intentos).
- [ ] Verificacion 3: En hora peak el provider avisa y pide confirmacion antes de una corrida pagada.
- [ ] Verificacion 4: Un handoff guardado por el assistant es legible por Codewhale (y viceversa) via giskard-sys.
- [ ] Verificacion 5: Cero referencias a alicanto en el repo (grep).

## Alignment Q&A (Interaction Notes)
- **Q**: Los gates son de seguridad o cosmeticos?
- **A**: Reales: bloquean hasta aprobacion explicita. (Requisito del usuario al comparar con el estandar de Codewhale.)
- **Q**: Peak/off-peak?
- **A**: Regla permanente del usuario para la API oficial de DeepSeek: solo trabajo pagado en off-peak; peak local Chile depende de UTC-3/-4. La extension debe avisar siempre.

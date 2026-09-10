# Quality Checklist — giskard-assistant

Use this checklist to verify functional correctness, code quality, and prevent regressions before closing any development wave.

## Functional Correctness
- [ ] Core business requirements are fully met and verified.
- [ ] Edge cases (empty inputs, network timeouts, invalid arguments) are handled.
- [ ] Application does not raise unhandled exceptions or crash under stress.

## Code Quality
- [ ] No temporary debug code (e.g. print statements, commented-out blocks) remains in the codebase.
- [ ] Variable and function names are descriptive and follow standards.

## Testing & Verifications
- [ ] Local unit/integration test suites are executed and pass successfully.
- [ ] Verification plan in the active wave is fully checked off.

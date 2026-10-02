# V2-RWAs — archived demo deployments (Base Sepolia)

| File | Status |
|---|---|
| `base-sepolia-2026-10-01-prereview*.json` | First live unit (vault `0x7668…dbf1`). Valid proofs, but the hook PREDATES the 2026-10-02 adversarial-review fixes (no pool pinning, no exit window, no drift cap). Superseded. |
| `base-sepolia-2026-10-02-INVALID-mutated-hook.deployment.json` | **INVALID — do not use.** Vault `0x4662…42e2` / hook `0x8D9B…6aC0` were deployed from a stale artifact left by a mutation test (the hook built with its LP gate removed). Caught by comparing the artifact's recorded source hash with the file on disk; the lifecycle was stopped before any proof run. A correct hook `0xaB8E…EAC0` was then created at its deterministic CREATE2 address by a resume against this record; the fresh deploy reused it (it had never been wired) — it is the LIVE hook. |

Since then `scripts/deploy-rwa-demo.mjs` refuses (1) any artifact whose recorded source hash differs from the file
on disk and (2) resuming a progress file from a different build/config.

The live unit is `config/rwaDemo.deployment.json` + `config/rwaDemo.json`.

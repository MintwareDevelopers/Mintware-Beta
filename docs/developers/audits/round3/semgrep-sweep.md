# Round 3 — Semgrep pass (2026-09-08)

**Tool:** Semgrep (already installed on this machine, run with its own default `--config auto`, no
custom/third-party ruleset). **Scope:** the LP Gateway contract surface + the not-yet-merged idle
adapter (`feat/lp-gateway-idle-yield-adapter`, read via `git show` without checking the branch out).

## Result

**0 findings**, both runs.

| Target | Files | Rules run | Findings |
|---|---|---|---|
| `contracts-v4/src/gateway/{MintwareLpGatewayPositionManager,MintwareLpGatewayStaging,MintwareLpGatewayFactory}.sol` + `contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol` | 4 | 66 (45 multilang community + 21 Solidity) | 0 |
| `contracts-v4/src/vaults/MintwareIdleYieldAdapter.sol` (PR #483, unmerged) | 1 | 66 | 0 |

## Honest caveat

The unauthenticated free tier only activates **21 Solidity-specific rules** (`semgrep login` unlocks
more from the registry — not done here, no account configured). This is a fast sanity pass, not a
substitute for Slither/Aderyn's deeper Solidity-specific analysis (running separately, see
`slither-sweep.md` / `aderyn-sweep.md` in this directory) or the invariant fuzzing / Halmos / adversarial
passes covering the same surface. Treat "0 findings" as "nothing in this shallow ruleset's blind spot,"
not as an independent clean bill of health on its own.

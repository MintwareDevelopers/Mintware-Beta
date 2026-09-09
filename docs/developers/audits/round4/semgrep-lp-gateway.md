# Round 4 — Semgrep pass (2026-09-08, post earn-vs-lp + D-4/IA-4)

**Tool:** Semgrep 1.156.0, `--config auto` (free-tier default, no custom/third-party ruleset, no
registry login). **Scope:** LP Gateway V1 on-chain surface — everything the round-4 multi-suite audit
covers — re-run because the source materially changed since the round-3 pass
(`docs/developers/audits/round3/semgrep-sweep.md`): the earn-vs-lp `deploy()` re-signature + in-contract
zap swap, `principalCap`/`deployedPairedValue` (IA-11), the D-4 `depositCap()` adapter-kind probe
surface, and IA-4's `CompoundDeferred` event.

## Result

**0 findings** — same as round-3.

| Target | Files | Rules run | Findings |
|---|---|---|---|
| `contracts-v4/src/gateway/{MintwareLpGatewayPositionManager,MintwareLpGatewayStaging,MintwareLpGatewayFactory}.sol` + `contracts-v4/src/vaults/{MintwareERC4626YieldAdapter,MintwareIdleYieldAdapter,IYieldAdapter}.sol` + `contracts-v4/src/lib/SeniorSharesMath.sol` | 7 | 68 (47 multilang community + 21 Solidity) | 0 |

## Honest caveat (unchanged from round-3)

Free tier = 21 Solidity-specific rules only (`semgrep login` unlocks more from the registry — not done
here). Fast sanity pass, not a substitute for Slither/Aderyn's deeper Solidity-specific analysis or the
Foundry invariant fuzzing / Halmos / adversarial-agent passes covering the same surface in this same
round. "0 findings" means "nothing in this shallow ruleset's blind spot," not an independent clean bill
of health.

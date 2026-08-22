# Mintware — Security Self-Assessment, ROUND 3: Defense-in-Depth Matrix (2026-08-22)

> **SELF-REVIEW, not an external audit.** A third pass, this time structured as the professional
> **defense-in-depth matrix** a firm (Trail of Bits / CertiK / Runtime Verification) runs: static
> analysis + unit/negative + stateful fuzzing/invariants + formal + economic/fork — layered, not
> unit-tests-alone. The **ETH senior tranche** was made a first-class target of its own reviewer.
> Testnet + unaudited; an external audit remains the gate before real value.

## Headline

**39 new tests added (28 ETH-senior + 11 rest-of-suite), all green. Zero High/Medium/Low findings.**
The prior two rounds' remediations hold under the adversarial matrix; the new coverage is net-new where
whole classes had none (settlement stateful invariants, staged-router 4626 pool invariants, an
access-control-negative sweep, first-depositor/inflation, fee-on-transfer, economic spot-manipulation).
The one **critical architecture check — delegatecall storage-layout collision — came back SAFE.**

## Layer-by-layer

### Layer 1 — Static analysis · **ATTEMPTED, env-blocked (honest)**
Slither (installed) + Aderyn 0.6.8 (installed for this pass) could not run to completion **in this
local environment**, for tooling reasons, not contract reasons:
- **Slither / crytic-compile** — five sequenced attempts. Blockers, in order: Hardhat mis-detection
  (the repo root is a Next.js app with hardhat deps) → forced Foundry framework → a missing nested
  git submodule (`ds-test` under `v4-core/forge-std`) on a full build → `--ignore-compile` resolved the
  project root to the **outer** worktree (dual `foundry.toml`) → symlinked the build-info → finally
  `crytic-compile` **cannot parse forge 1.5.1's build-info schema** (`KeyError: 'output'`), and a
  `pip install -U` did not close the version gap.
- **Aderyn** — its own compiler could not resolve the project's dynamic Foundry remappings
  (`@uniswap/v4-periphery/…`, `@openzeppelin/…`), which are generated, not committed.

**This is a tooling/CI-config issue, not a finding.** Recommendation: run Slither + Aderyn in CI with an
isolated Foundry root (analyze `contracts-v4/` as its own project), a pinned `crytic-compile`/forge pair,
and committed `remappings.txt`. Mitigating context: the two prior manual review rounds already covered
Layer-1's target classes by hand (reentrancy/CEI, access control, uninitialized state, shadowing,
arbitrary-send), and Layers 2/3/5 below exercise them dynamically.

### Layer 2 — Unit / negative / boundary · **27 new tests, green**
`test/audit/EthSeniorChecklist.t.sol` (19) + `test/audit/SuiteChecklist.t.sol` (8):
- **Access-control negative sweep** — every owner/role-gated setter reverts for a non-authorized caller
  (vault: all setters + `forceSettleJit`; the JIT seam `OnlyJitHook`; gateway RELAYER_ROLE; settlement
  `onlyRelayer`; CCTP `onlyRelayer`/`setRelayer`; factory `createVault` onlyOwner; registry; distributor
  registrar/rotation; matched-vault commit/activate/abort; staged-router pair/unstage owner-gate).
- **Zero-address injection** — constructors/initializers on vault, gateway, CCTP, yield vault revert
  `ZeroAddress` on every zero arg; vault rejects a USDC not in its pool.
- **First-depositor / inflation** — donation-inflation steal attempted against the `SeniorSharesMath`
  virtual offset on both the treasury vault and the staged-router 4626 pool → victim keeps ≥99%.
- **Fee-on-transfer / non-standard ERC-20** — USDT-style no-return-value round-trips via SafeERC20;
  `fundRent` (hot path) + distributor `fundFees` (M3) credit **actual-received** via balance-diff, never
  nominal, under a hostile fee-on-transfer token.
- **Zero & max amounts, event emission** — dust-rounds-to-zero reverts, slippage guards, and correct
  event args on deposit/redeem/burn/settle.

### Layer 3 — Stateful fuzzing / invariants · **8 new invariants, green @ 256×128k, 0 reverts**
`test/audit/EthSeniorInvariants.t.sol` (5) + `test/audit/SuiteInvariants.t.sol` (3) — the canonical
battery, on surfaces that previously had **no** stateful suite:
- **Solvency** — junior first-loss + senior realizable ≥ senior claimable (settlement: rail paid exactly
  Σ owed, tracked WETH backing ≤ real balance, junior buffer ≤ real USDC & monotonic-down, never
  insolvent). Staged router: Σ redeemable `stagedAssets` ≤ `adapter.totalAssets()`.
- **Share conservation** — Σ shares == totalSupply / poolShares; redemption never rounds in the user's
  favor (mulDiv floor).
- **Monotonic** — stage-id / epoch counters never decrease.

### Layer 4 — Formal verification · **already wired (unchanged this round)**
Halmos symbolically proves 3 live `MWDynamicFee` fee-bound properties; Coq machine-checks the 4
nonlinear mulDiv/solvency lemmas that defeat any SMT solver. Both run as CI gates. Certora / HEVM not
provisioned (Certora needs a cloud key). No formal-layer change was required by this round's findings.

### Layer 5 — Economic / external-vector · **green; storage check SAFE**
`test/audit/EthSeniorEconomic.t.sol` (4) + the oracle tests in `SuiteChecklist`:
- **Oracle / flash-loan spot manipulation** — a single-tx sandwich that craters spot makes the
  settlement swap **revert with WETH backing fully conserved** (never a cheap-WETH drain); a stale/
  not-ready oracle **fails closed** even at `minUsdcOut = 0`; the truncated in-pool oracle
  (`MWOracleGuard`) stays **frozen** under repeated intra-block pushes (deviation prices *against* the
  attacker, breaker trips) and cross-block moves are clamped to `maxTickMovePerBlock × elapsed`.
- **Storage-layout collision (delegatecall)** — the vault self-holds its V4 position via delegatecall.
  Verified with `forge inspect … storageLayout` that **all four** delegatecall libraries
  (`MWTreasuryPositionLib`, `MWPositionLib`, `MWJitLib`, `MWIdleLib`) declare **0 storage variables** and
  use **no raw `sstore`/`sload`/assembly** — structurally collision-proof (a Solidity `library` cannot
  hold state to overlay). **No slot overwrite possible across any delegatecall pair. RESULT: SAFE.**

## Findings

**High / Medium / Low: none.** The guards hold under every negative, edge, invariant, and economic case.

**Informational (no defect; documented behavior):**
- **Info-1 — funding paths assume standard tokens.** `MintwareTreasuryVault.commitTeam` (junior USDC) and
  `MintwareEthSettlement.fundWethBacking`/`fundJuniorBuffer` credit the **nominal** amount, not a
  balance-diff (unlike the hot-path `fundRent`). Correct for canonical USDC/WETH (the only intended
  assets); a fee-on-transfer token would over-credit. **Fixed with a NatSpec note** on each, stating the
  standard-token assumption for consistency with `fundRent`'s documented Bunni-safety.
- **Info-2 — staged router reads whole-pool `adapter.totalAssets()`** — correct under the deployer's
  documented invariant that each adapter instance is dedicated to the router + denominated in the staged
  token. Worth a deploy-time checklist item.
- **Info-3 — `MintwareVaultRegistry.deactivateVault` is not idempotent-guarded** (re-emits the event);
  harmless, no state corruption.

## Honest scope

Self-review, not an external audit. Layer 1's automated scanners were **not** run to completion here
(local tooling/version incompatibility — recommended for CI, documented above); Certora/HEVM/Echidna/
Medusa/Mythril are **not provisioned** in this environment. What *did* run — Slither-class coverage by
hand (rounds 1–2), 39 new dynamic tests across Layers 2/3/5, the Halmos+Coq formal gates, and the
delegatecall storage check — found **no new defect**. Everything remains **testnet + unaudited**; an
external audit is the gate before real value.

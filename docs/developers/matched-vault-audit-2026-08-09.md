# MintwareMatchedLiquidityVault — Deep-Dive Audit (2026-08-09)

Four independent adversarial angles: lock/split integrity · activation state machine · solvency/V4
accounting · spec-conformance. This vault is the **team-locked / community-matched launch vault** —
the correct, solvent implementation of the "fill one side, matched at threshold" design (it replaces
the flawed single-sided `MintwareDeFiVault4626`).

## What held (verified — the core promises are sound)

- **The lock is unbreakable.** `teamLiquidity` is zeroed only in `teamWithdraw`, hard-gated on
  `block.timestamp >= lockExpiry`. No rescue/sweep/emergency/delegatecall/selfdestruct anywhere;
  guardian pause can only *freeze*, never *release*; post-expiry debt reset prevents back-claiming
  lock-period fees. (Angle 1 could not break it.)
- **Solvent + fair.** The sibling's HIGH shares==liquidity rebalance bug is **designed out** — this
  vault is deploy-once (no rebalance; shares are literal V4 liquidity units removed 1:1). Community
  redemption returns a fair share of both tokens; first-vs-last is not a failure mode here. The
  reserve-absorption bug is structurally impossible (no path re-deploys idle balance). (Angle 3.)
- **Already current** on the big go-forward patterns: Rail B `weightedDistributor` routing ✅,
  Stage-1.4 kill-switch ✅. (Angle 4.)

## Findings

### ✅ FIXED this session
- **HIGH — Pool pre-init bricks `activate()` + freezes team funds** (angles 2, 4). V4 pool init is
  permissionless; a griefer could pre-init the public `poolKey` so a naive re-init reverts forever.
  **Fix:** initialize the pool atomically in `commitTeam` (front-run-proof) — tolerate an existing
  pool only at our launch price, else revert *before* any escrow so the team retries. Tests:
  `test_preinit_at_launch_price_commits_and_activates`, `test_preinit_at_hostile_price_reverts_commit_no_escrow`.
- **MED (HIGH for target) — Fee-on-transfer intake was nominal** (all 4 angles; meme tokens are
  usually taxed). **Fix:** balance-diff intake in `commitTeam` + `depositCommunity` (credit what
  arrived). Test: `test_commitTeam_balance_diff_for_tax_token`.

### ✅ FIXED (cont.)
- **HIGH (arch) — Not bound to the canonical hook.** Fixed: added an owner-set `expectedHook` +
  `setExpectedHook` (once); `_validatePoolKey` now requires `poolKey.hooks == expectedHook` once
  wired, so a launch can't land in an unprotected pool. Wrote **`DeployMatchedVault.s.sol`**
  (deploy vault → mine+deploy coordinator with the vault baked in → `setExpectedHook`), the vault's
  first deploy script. Tests (`DeployMatchedVault.t.sol`): wiring correct, wrong-hook commit reverts
  `BadPoolHook`, full commit→fund→activate lifecycle deploys through the vault-only-gated pool.

### ✅ FIXED (cont.)
- **MED — Imbalanced deploy strand.** `_deployMatched` now measures the ACTUAL consumed amounts via
  balance-diff and returns them; `activate` refunds the team's undeployed project side directly, and
  the community's undeployed quote is claimable **pro-rata to each depositor's contribution** via
  `claimUndeployedQuote()` (deposit-weighted, not fee/reputation-weighted). Test:
  `test_strand_refunded_at_non_1to1_price` (the non-1:1 case the old tests never hit).
- **LOW — Unlimited distributor approval.** Removed the standing `type(uint256).max` grants;
  `_realizeFees` now does JIT exact-amount `forceApprove(dist, lpX)` before `fundFees` and zeros it after.

### ⏳ REMAINING (minor, next batch)
- **LOW/INFO** — sybil-bypassable min-depositor floor (off-chain reputation is the real gate);
  floor-rounding dust in share derivation; FoT documentation mismatch in the base `_pay`.
- **Nice-to-have** — a dedicated solvency invariant (`position.liquidity == teamLiquidity + Σshares`)
  to guard future edits (the current invariant suite + the new non-1:1 test cover the behavior).

### Inherited (fixed / tracked elsewhere)
- Distributor CRIT #1 (claim-after-sweep double-spend) — **already fixed** this session.
- Distributor MED (permissionless `registerVault` front-run) — tracked in the full-platform audit.

## Product-copy note (not a bug)
The lock guarantees a **liquidity floor** for `lockDuration`, not "the team can't exit exposure"
(the team retains its un-committed supply). The code comments are accurate; marketing must not
over-claim beyond "locked liquidity floor."

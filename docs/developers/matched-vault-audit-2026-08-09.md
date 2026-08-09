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

### ⏳ REMAINING (next batch)
- **HIGH (arch) — Not bound to the canonical hook.** `commitTeam` accepts an arbitrary `PoolKey`
  and `_validatePoolKey` never checks `key.hooks` — a launch could land in an *unprotected* pool (no
  vault-only-LP gate, no oracle guard). And there is **no matched-vault deploy script** wiring
  `coordinator.setVault(thisVault)`. **Fix:** harden `_validatePoolKey` to require the expected
  coordinator hook + write a deploy script mirroring `DeployPairVault` (mine coordinator, `setVault`).
- **MED — Imbalanced deploy strands one party's principal** (all 3 security angles). `_deployMatched`
  binds on `min(L0,L1)`; the abundant side's remainder stays idle in the vault, unrefunded (team's
  proj side is a single-recipient refund; the community quote remainder needs a pro-rata/claimable
  path). Acute for non-1:1 launch prices with a wide MEME range. **Fix:** measure `used0/used1`,
  refund the team proj remainder, and make the community quote remainder claimable.
- **LOW — Unlimited `forceApprove` to the distributor** — tighten to JIT/bounded approval.
- **LOW/INFO** — sybil-bypassable min-depositor floor (off-chain reputation is the real gate);
  floor-rounding dust in share derivation; FoT documentation mismatch in the base `_pay`.
- **Test coverage** — add a solvency invariant (`position.liquidity == teamLiquidity + Σshares`) and
  a non-1:1 launch-price activation test (both would have caught the strand).

### Inherited (fixed / tracked elsewhere)
- Distributor CRIT #1 (claim-after-sweep double-spend) — **already fixed** this session.
- Distributor MED (permissionless `registerVault` front-run) — tracked in the full-platform audit.

## Product-copy note (not a bug)
The lock guarantees a **liquidity floor** for `lockDuration`, not "the team can't exit exposure"
(the team retains its un-committed supply). The code comments are accurate; marketing must not
over-claim beyond "locked liquidity floor."

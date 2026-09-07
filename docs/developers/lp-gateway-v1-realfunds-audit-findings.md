# LP Gateway V1 — Real-Funds Re-Audit: Unified Findings (Fable 5.1, 2026-09-07)

> Three independent passes reconciled: a core-contract pass (share math / NAV / deploy / withdraw / access
> control), an off-chain money-path pass (harvest, buffer ledger, routes, crons, registry), and an
> integrations pass (v4 PositionManager, Permit2, 4626 adapter, USDG, tests). Duplicates merged; ranked by
> impact **for putting a bounded amount of our own funds in**. Audit map: [`lp-gateway-v1-realfunds-audit-pack.md`](lp-gateway-v1-realfunds-audit-pack.md).
>
> **Verdict: NOT yet safe for real funds.** Four HIGHs must be fixed first (three are few-line contract changes,
> one is a key/ops hardening). Prior review's "fixed" table over-claims in three places (see §5).

---

## 1. Findings — ranked for real funds

### A-1 · HIGH · CONFIRMED (Forge PoC) — `withdraw` burns 100% of shares but does not deliver 100% of value when the adapter under-delivers; the remainder is stranded, and in the sole-holder case **unrecoverable**
`MintwareLpGatewayPositionManager.sol:254-286`. Effects (`sharesOf -= shares; totalShares -= shares`) run before sourcing; `staging.unstage(fromIdle)` is best-effort (a paused/illiquid Morpho, or the adapter owner's `setPerBlockWithdrawCap`, clamps it). The shortfall is pushed onto the LP leg, but `want = liq·remaining/deployedSpotVal` can hit `liq` — the whole LP is taken and the residual simply isn't paid. **No check that delivered ≥ claim, no revert, no share re-scale.**
- **PoC** (`test_audit_F1_…`, passes = demonstrates the bug): deposit 100k → adapter capped to 30k (`totalAssets` still 100k) → withdraw all → **30k received, 0 shares left, 70k stranded ownerless (`totalShares==0`)**.
- Sole holder: the orphaned NAV is priced against `nav + VIRTUAL` (1e6) → owned by the virtual shares → **cannot be recovered**. Multi-holder: silent wealth transfer to remaining holders.
- **Fix:** after sourcing, revert on material under-delivery (`IdleIlliquid`) — honest beats "never brick" here — *or* re-scale the burned shares to the value actually delivered. Also consult `staging.maxUnstageable()` (the PM never reads it) and surface `maxWithdrawableShares()` to the UI.

### A-2 · HIGH · CONFIRMED — A full LP drain **permanently bricks** the instance: `_sweepFees` on a zero-liquidity position reverts
`_sweepFees` (`.sol:368-374`) calls `_decreaseAndTake(0,…)` whenever `tokenId != 0` without checking liquidity. v4-core `Position.update` reverts `CannotUpdateEmptyPosition` on a zero delta against zero liquidity, and `DECREASE_LIQUIDITY` never burns the NFT — the position persists at `liquidity==0`.
- **Reachability:** any withdraw where `remaining ≥ deployedSpotVal` (the A-1 shortfall path, or the last holder exiting) sets `liqToRemove = liq`. Afterwards `deploy` → `_sweepFees` reverts unconditionally → **this instance can never redeploy** (factory `AlreadyExists` blocks a second one); `harvest` reverts; `withdraw` reverts whenever the adapter is short (A-1's precondition now bricks exits).
- **Fix (one line):** in `_sweepFees`: `if (positionManager.getPositionLiquidity(tokenId) == 0) return (0, 0);` — safe, a full decrease already collected all fees.

### A-3 · HIGH · CONFIRMED — `deploy` is unbounded and unpriced → a compromised owner key can **economically extract depositor principal**; the "capped deploy fraction" backstop does not exist
Three compounding facts:
1. **No price bound on `deploy`** (`.sol:314-319`): liquidity is minted at raw `getSlot0` spot; `minLiquidity` (M-03) is a *liquidity* floor, not a price check. Sandwichable.
2. **The cron disables even that floor**: `lib/gateway/deploy.ts:135` passes `minLiquidity = 0` by default (`LP_GATEWAY_DEPLOY_MIN_LIQUIDITY ?? '0'`), 600s deadline, public mempool. "M-03 fixed" was the hook only.
3. **No size cap, and the fraction converges to ~100%** (`deploy.ts:97`): `deployable = staged × ratio` *every run*, gated only by an absolute idle floor → 50% → 75% → 87.5% … The audit pack and the H-03 mitigation both *assumed* a fraction-of-NAV cap. It is a floor, not a cap.
- **Attack (compromised owner/oracle key):** pump the pool → `deploy(100% of staged, …, minLiq=0)` → dump → realize depositor principal through the pool, bounded only by pool depth. Plus the key already receives 100% of harvested fees (owner == `harvestRecipient`) and any restake net.
- **Key posture worsens it:** `getOracleSigner('root')` is **shared across every money surface** (card settle, x402, treasury refill); `ORACLE_SIGNER_PROVIDER` **defaults to a raw env key** — must verify prod is `privy`.
- **Fix:** on-chain `maxDeployBps` of NAV per call + a spot-vs-follower band check in `deploy` (reuse `_refOrSpot`); cron computes a real `minLiquidity` from current spot × (1−tol) and caps `deployable = max(0, ratio·totalNav − deployedValue)`; a **dedicated, Privy-enclaved gateway owner key** (not the shared root), minimally funded; assert `ORACLE_SIGNER_PROVIDER=privy` in prod.

### A-4 · HIGH (third-party) / tolerable (own funds) · CONFIRMED — The per-depositor buffer ledger doesn't exist, and when linked is corruptible
- **Never written:** nothing sets `card_spend_buffers.gateway_position_id` (only two readers exist) → `harvest.ts:212 if (!buf?.id) continue` fires for everyone → `credited = 0`; 100% of fees pile up in the seat wallet with **no per-user liability row**. The "off-chain IOU" is only aggregate `harvest_events`.
- **Stale shares (HIGH):** `harvest.ts:188-196` weights credits by DB `gateway_positions.shares`, written only by the *user-invoked* routes and never synced from chain. A depositor who withdraws on-chain but skips the route **keeps collecting real fee income** at everyone else's expense.
- **Swept fees uncredited:** fees swept by `withdraw()`/`deploy()` (`_sweepFees`) reach the seat but `harvest.ts` decodes only its own `collectTx` logs → seat balance − Σ`harvest_events` grows silently.
- **Lost updates:** non-atomic read-modify-write; `lib/org/bufferMonitor.ts:78-81` **overwrites** `buffer_balance_atomic` from on-chain balance → harvest credits erased.
- **Own-funds reading:** with one depositor who is also the operator, all four collapse to "I owe myself" — no leak. **Must fix before any third-party depositor.**
- **Fix (one design):** an event-indexed (`Harvested` logs from the PM, keyed `(tx_hash,log_index)`), **on-chain-share-weighted** (`sharesOf`/`totalShares` via multicall), atomically-written (`FOR UPDATE` RPC) credit ledger in its **own** table the monitor never touches.

### A-5 · MEDIUM (real funds) · CONFIRMED — The live RH-testnet rig uses `MockYieldAdapter`, whose `withdraw` has **no access control — anyone can drain it**
`test/mocks/MockYieldAdapter.sol:30-35` (transfers to any `msg.sender`), deployed by `scripts/deploy-lp-gateway-robinhood.mjs`. Zero value today, but **never point real funds at this rig** — the real deployment must use `MintwareERC4626YieldAdapter`, and the production adapter has **never been composed behind the gateway in any test** (see §4).

### A-6 · MEDIUM · PLAUSIBLE — Hooked pools aren't rejected; the whole safety argument assumes `hooks == address(0)`
Constructor (`.sol:133-136`) validates only that the quote is in the pool. A hook reverting in `beforeRemoveLiquidity` bricks every LP-sourced withdraw; `afterAddLiquidityReturnDelta` bricks every deploy. Availability, not theft (`nonReentrant` holds). **Fix:** `if (address(poolKey_.hooks) != address(0)) revert HookedPoolUnsupported();`

### A-7 · MEDIUM · CONFIRMED — Registry H-01 proves "claims to front", not "is the audited contract"; `staging` unverified; upsert allows hot-swap
`registry.ts:72-104` reads `quoteAsset()`/`poolKey()` from the *candidate* — a hostile contract can echo them while `deposit()` steals; `registerInstance` upserts on `(pool, chain)` so an active instance's PM can be replaced. Curator-trust-conditional (curator == operator for own funds). **Fix:** require `factory.instanceForPool(poolId).positionManager == candidate && .staging == supplied && .active`; block the upsert when an active row exists.

### A-8 · LOW–MEDIUM — Availability / DOA (no loss) cluster
- `_sweepFees`/adapter: `withdraw` "never bricks" depends on `adapter.totalAssets()` never reverting (`try/catch` the staged read).
- Morpho supply cap / `maxDeposit==0` reverts `deposit`, `compoundQuote`, and the `deploy` re-stage (whole tx reverts, no loss).
- Prod deploy script never wires `adapter.setVault(staging)` → first deposit reverts `OnlyVault` (DOA); add to script + post-deploy assert.
- Constructor doesn't validate `tickLower < tickUpper`, `% tickSpacing`, or `pairedAsset != 0` (native-ETH pools) — all DOA-on-deploy.
- Harvest "idempotency" on `collect_tx` is vacuous (dedupes after mining a fresh tx); a crash mid-credit leaves partial state. Subsumed by the A-4 ledger fix.
- Deploy cron zaps *before* the L-02 claim (both concurrent runs swap); failed tx locks the window. Inert while the zap is unwired.

### A-9 · LOW / INFO
- Swap seams (`routerSwap.ts`, `v4SwapExec.ts`) are **fail-closed today** (return `0n`, `executeV4Swap` has no call site) — but when wired: `minOut` is quoted from the same manipulable pool, slippage env accepts up to 5000 bps, and the zap funds the paired leg from the **seat wallet** (an operator subsidy / accounting hole). Resolve before wiring.
- Signed deposit/withdraw messages embed `txHash`/`pool` but routes never compare them to the body (no funds impact — `ctx.user` + PM-emitted-event checks hold); tighten to make the comment true.
- `/api/gateway/request` accepts free-text `pool_address`; rate limit fails open (Upstash unset).
- `receipt.to === PM` rejects smart-account/4337 deposits → they become the "unregistered depositor" in A-4.
- `_pairedToQuote` theoretical overflow at extreme price×amount (unrealistic).

---

## 2. USDG (Paxos) — exact brick/loss enumeration (M-07)

**⚠ Verify first:** is USDG on Robinhood Chain a **native Paxos deployment** (`pause`/`freeze`/`wipeFrozenAddress`) or a **bridged ERC-20** (no freeze; the bridge is the risk)? Assuming Paxos-family:

| Event | deposit | withdraw | deploy/harvest | Permanent loss? |
|---|---|---|---|---|
| Gateway PM frozen | revert | revert (`unstage` → frozen PM) | revert | **No** — PM holds 0 at rest |
| Staging frozen | revert | revert | revert | **No** — staging holds 0 at rest |
| Global pause | revert | revert | revert | **No** |
| `wipeFrozenAddress` | — | — | — | Only if it hits a holder-at-rest (Morpho vault / v4 PoolManager) — systemic, not gateway-specific |

**Fee-on-transfer:** would **revert** deposits (`stage(quoteAmount)` pulls more than received), not mis-mint — *safer* than the prior review stated. `deploy` re-stage and `withdraw` are FoT-tolerant. `VIRTUAL=1e6` is correct for 6dp.

---

## 3. Direct answers to the audit pack's §7

1. **Can anyone end holding more than owed?** No *unprivileged direct theft* found. But: **A-1** shortchanges a withdrawer (wealth transfer to remaining holders / orphaned); **A-3** lets a compromised owner extract principal economically; **A-4** lets a stale-share depositor collect others' fees (third-party).
2. **H-03 depth threshold?** At 5%/block the follower doubles the LP mark in **~7 blocks** of held pump; the trigger is trivial ($1 deposit/block). **But A-3 (no deploy cap) means the loss is bounded by pool depth, not by a deploy fraction** — until fixed, "capped deploy" is not a backstop.
3. **Third party corrupt the ledger?** **Yes** once linked (A-4 stale shares / lost updates); today it's simply unwritten.
4. **Compromised owner/oracle key?** No principal-sweep function exists (verified — `withdraw` is `msg.sender`-scoped), **but** A-3 gives economic extraction bounded by pool depth, plus 100% of fees, plus deposit-pause griefing. The key is shared with every other money surface.
5. **Rounding drift?** Verified sound — 1e6 virtual offset (donate ~$1M to steal $1), `Σcredits ≤ gross` holds, `SqrtPriceMath` rounds down.
6. **Reentrancy/callbacks?** Verified sound — hookless ⇒ no callbacks reach the gateway; PoolManager unlocks into the PositionManager, not us; `nonReentrant` everywhere.

---

## 4. Verified sound (traced, all three passes)

Virtual-offset inflation defense · directional conservative marks (every pump/deflate × deposit/withdraw case protects the pool) · same-block guard vs the atomic round-trip · H-02 fee-sweep ordering · effects-before-interactions · reentrancy · Permit2 (only the locker's allowance is spent; revoke reached on success, rolled back on revert; residual ERC20 allowance inert) · v4 action encodings match the vendored `CalldataDecoder` exactly, zero-amount settle/take skipped, no stranded value · zero-liquidity collect is fees-only · one-shot deployer-only `setController` · `renounceOwnership` disabled · immutable `harvestRecipient` · 4626 adapter fee-aware (`previewRedeem`, `redeem` in try/catch) · C-01 curator bearer fail-closed · cron auth fail-closed · M-04 replay/action binding · L-03 buffer gating · swap seams fail-closed · RLS deny-all.

## 5. Prior-review verdicts amended

- **M-03 "fixed"** → on-chain hook only; the cron passes `minLiquidity=0`. Not fixed in practice (A-3).
- **"Withdrawals never brick" (M-01)** → true only while the adapter fully serves and the LP is non-empty (A-1, A-2).
- **"Capped deploy fraction"** (the H-03 backstop) → does not exist (A-3).
- **L-07 FoT** → would revert, not mis-mint (lower risk).
- **I-01 deferral** → the production adapter exposes `asset()`; the factory check is implementable.

## 6. Test gaps (real-funds relevant — no test anywhere)

1. `INCREASE_LIQUIDITY` path — `deploy` runs exactly once in the fork `setUp`; never executed against any v4 instance.
2. Full LP drain → subsequent `deploy`/`harvest`/`withdraw` (A-2).
3. Adapter shortfall during a **PM** `withdraw` (would have surfaced A-1 — now covered by the audit PoC).
4. `MintwareERC4626YieldAdapter` composed behind the gateway — every gateway test and the live rig use the mock.
5. Permit2 residual allowance == 0 after `deploy`.
6. Out-of-range deploy; minted liquidity vs `minLiquidity`.
7. 6dp quote × 18dp paired on real v4 (fork rig is 18/18; live 6dp smoke was idle-only).
8. USDG freeze/pause/FoT. 9. Morpho `maxSuppliable==0`. 10. Hooked pool. 11. The "value conserved" claim isn't asserted in the fork test. 12. Deployed RH PositionManager vs vendored periphery for INCREASE.

---

## 7. Fix plan (ordered) — the path to "safe for bounded own funds"

**Contract (few-line each; re-run 32 Forge + add fork tests):**
1. `_sweepFees`: early-return when position liquidity == 0 → **A-2**.
2. `withdraw`: revert on material under-delivery (or re-scale burned shares) + read `maxUnstageable()` → **A-1**.
3. `deploy`: spot-vs-follower band check (reuse `_refOrSpot`) + on-chain `maxDeployBps` of NAV → **A-3**.
4. Constructor: reject hooked pools; validate ticks + `pairedAsset != 0` → **A-6 / A-8**.

**Off-chain / ops:**
5. Deploy cron: `deployable = max(0, ratio·totalNav − deployedValue)`; compute real `minLiquidity` from spot × (1−tol) → **A-3**.
6. **Dedicated Privy-enclaved gateway owner key** (not the shared root); assert `ORACLE_SIGNER_PROVIDER=privy` in prod → **A-3**.
7. Registry: verify against `factory.instanceForPool` + block active-upsert → **A-7**.
8. Real deployment with `MintwareERC4626YieldAdapter` (never the mock); wire `setVault`; verify the RH-chain USDG implementation → **A-5 / A-8 / M-07**.
9. Buffer ledger rebuild (event-indexed, on-chain-weighted, atomic) → **A-4** — required before any third-party depositor.

**Tests before funds:** fork tests for adapter-shortfall withdraw, full-drain→redeploy, the INCREASE path, Permit2 revoke, and the real 4626 adapter composed; convert the A-1 audit PoC into a regression test asserting the *fix*.

**Then the bounded rollout:** hard exposure cap · deep pools only · tiny first amount · monitor harvest / out-of-range / breaker trips · scale on clean operation.

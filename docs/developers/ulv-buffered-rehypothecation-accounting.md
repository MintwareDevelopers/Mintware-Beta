# Buffered Rehypothecation — Accounting Spec (ULV Phase 1a, increment 2)

**Precise implementation spec** for wiring buffered rehypothecation into `MintwareDeFiPairVault`
without breaking its Bunni-safe, **price-free** share model. Built on the `AaveV3YieldAdapter`
(increment 1, PR #144). Implement from this — the design is the load-bearing part; don't improvise
the accounting.

## The invariant we must preserve

`MintwareDeFiPairVault` mints shares as **V4 liquidity units** — `totalLiquidity == total shares`,
decoupled from `positionLiquidity` (the raw V4 liquidity in the pool) after a rebalance. **There is
no price in the share math**, which is exactly why it has no oracle manipulation surface. Idle capital
must keep this property: **never introduce a price/NAV number into share minting or redemption.**

## Model: price-free pro-rata idle

- Keep `shares` / `totalLiquidity` unchanged (price-free liquidity units).
- Add **vault-tracked settled counters** `idle0`, `idle1` = principal supplied to Aave via
  `adapter0`/`adapter1` (one adapter per token, from increment 1). **Do NOT compute NAV from
  `adapter.totalAssets()` live in the share math** — that live aToken read is donation-inflatable and
  is the Bunni bug shape. Track principal in `idle0/idle1`; harvest yield separately (below).
- **NAV per share is never materialized as one number.** A share is a pro-rata claim on
  *both tokens across both locations*: `(positionLiquidity tokens + idle tokens) × s / totalLiquidity`.
  Per-token, pro-rata → no price.

## Deposit
1. Deploy the full `(a0, a1)` as V4 liquidity and mint shares — **unchanged** (`minted = totalLiquidity
   * liquidity / positionLiquidity`; first-deposit seeds).
2. Then `_rebalanceBuffer()` (below) moves capital out to Aave toward the target buffer ratio.
   Minting stays pure-liquidity-unit; idling is a post-mint vault-level move affecting all shares
   pro-rata. (Alternatively idle lazily in `afterSwap`; do both for responsiveness.)

## Redeem (`executeRedeem`)
Extend the existing pro-rata removal with an idle pro-rata withdraw, computed on the **pre-burn**
`totalLiquidity`:
```
liqToRemove = positionLiquidity * s / totalLiquidity        // existing
idleOut0    = idle0 * s / totalLiquidity                    // NEW — round DOWN
idleOut1    = idle1 * s / totalLiquidity                    // NEW — round DOWN
// effects: shares/totalLiquidity/positionLiquidity/idle0/idle1 decremented BEFORE external calls
got0 = adapter0.withdraw(idleOut0); got1 = adapter1.withdraw(idleOut1)   // best-effort
// pool removal via unlock (existing); combine pool proceeds + got0/got1, apply penalties, pay out
```
Round DOWN everywhere so the vault never over-pays (last redeemer always exits; dust favors
remaining holders — the existing solvency-preserving rule).
**Best-effort withdraw caveat:** if Aave can't return the full `idleOut` (paused/illiquid), the LP
gets `got < idleOut` now and the shortfall stays as their claim — either (a) revert with a clear
`AaveTemporarilyIlliquid` so they retry (simplest, honest), or (b) mint a residual IOU. Pick (a) for
v1; a redeem is not a swap hot path, so reverting-to-retry is acceptable (unlike the swap path, which
must never brick).

## Rebalance (`_rebalanceBuffer`) — the buffer engine
Target: keep `bufferRatioBps` of each token as hot/in-pool, idle the rest in Aave.
- If a token is over-buffered (too much liquid) → `adapter.deposit(excess)`, `idleN += excess`.
- If under-buffered (buffer drawn down by a swap) → `got = adapter.withdraw(deficit)`, `idleN -= got`.
- Call on deposit and in the hook's `afterSwap` **only when drift crosses a band** (not every swap —
  gas). Use `adapter.maxWithdrawable()` / `maxSuppliable()` so it degrades gracefully.

## Yield harvest (separate from share math)
Periodically (keeper / on rebalance): `surplus = adapter.totalAssets() - idleN`; realize `surplus`
into the existing fee accumulators (`accFeeNPerShare` + `feeReserveN`) exactly like swap fees. This
keeps the live aToken balance **out of** the share/redeem math (Bunni-safe) while still distributing
yield to LPs. `idleN` only ever moves on explicit supply/withdraw.

## Bunni-hardening checklist (must-do)
1. **Single reentrancy guard** already on deposit/redeem/fundRent; extend to the rebalance entrypoint.
   No externally-callable "unlock the guard."
2. **Adapters hard-wired** (owner-set once, address-checked); never caller/hookData-supplied.
3. **Share/idle math reads settled counters** (`idle0/1`), never live balances mid-operation.
4. **Round against the user** on every `mulDiv` (deposit mint, redeem pool + idle). Prove directions.
5. **Inflation defense**: the pair vault's first-deposit path (`minted = liquidity`) is exposed —
   add a virtual-shares offset or seed dead shares at `initializePool` so a 1-wei-share + donation
   can't grief share price. (This is a pre-existing gap the idle layer amplifies.)
6. **CEI**: decrement `idle0/1` and shares BEFORE the adapter `withdraw` external call.

## Invariants to fuzz (extends the existing 128k-call solvency handler)
- **Solvency+**: `Σ redeemable ≤ positionLiquidity-tokens + idle0 + idle1 + feeReserve` (add the Aave leg).
- **Idle conservation**: `idle0/1` change by exactly the supplied/withdrawn amount across any
  deposit/redeem/rebalance sequence; `idle_before == idle_after` for a pure rebalance round-trip.
- **No value creation**: deposit→redeem (same block, no yield) returns ≤ contributed, per token.
- **Buffer-drift never bricks a swap** (adapter best-effort already proven in increment 1).
- **Share-price monotonicity** including the idle leg.

## Deploy impact
The wired vault is a new deployment (the live testnet vault `0x983c11b4…` is empty — abandon +
redeploy). Extend `deploy-pair-full-testnet` to deploy the two adapters + `setAdapters` + set
`bufferRatioBps` + per-block caps. Frontend NAV reads gain the idle leg (pro-rata, unchanged UX).

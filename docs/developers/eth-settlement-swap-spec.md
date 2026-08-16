# Batch ETH→USDC Settlement Swap — SPEC (on-chain)

> **Status: Phase 1 BUILT + Forge-proven (2026-08-16); Phases 2–4 deploy-gated.** The on-chain half of
> the multi-collateral card system. The off-chain engine (VaR haircut → Chainlink reader → Σ portfolio
> aggregation → store/`/authorize` → multi-vault refresher) is built + tested in `services/edge-auth`.
> This spec is the on-chain piece that makes an ETH-collateral vault's shares actually *card-spendable*:
> when card charges settle, convert enough ETH→USDC to pay the rail.
>
> **Phase 1 landed as `contracts-v4/src/payments/MintwareEthSettlement.sol`** (7,260 B « EIP-170) — the
> `batchSettleEth` swap itself, mirroring the JIT hook's oracle-bounded sweep. Proven against a REAL V4
> pool in `contracts-v4/test/payments/MintwareEthSettlement.t.sol` (8 tests incl a 256-run fuzz, full
> payments suite 126/126): fresh price → full fill no junior draw; manipulated spot (stale oracle → band
> binds) → junior first-loss backstop pays the rail in full; shortfall beyond the per-call cap or below the
> `minUsdcOut` floor → revert + state rollback; rail paid EXACTLY `totalUsdc` or reverts (fuzzed); WETH
> backing conserved. **Remaining (Phases 2–4): relayer batch path, edge idle-buffer wire, external audit —
> all deploy-gated.** Written 2026-08-16 alongside the multi-collateral work.

## Where it fits
```
card swipe ─auth→ edge-auth (VaR-haircut spendable NAV, off-chain)  ── reserves a HOLD
card settles ─────→ RELAYER batches settling holds for an ETH vault
                    └─→ vault.batchSettleEth(totalUsdc, minOut) ── THIS SPEC
                          v4 unlock: swap ETH→USDC (oracle-bounded) → take USDC → pay the rail
```
Today the Gateway `settleSpend` pulls USDC straight from a USDC-senior vault. An ETH-collateral vault
holds ETH, not USDC — so settlement needs a conversion step. Until this exists, an ETH vault's
`idle_buffer` (the edge-auth settlement-liquidity gate) is effectively 0; **this swap is what lets the
edge count ETH as settleable.**

## The coherence that makes it safe (do NOT lose this)
The off-chain VaR haircut `γ = 1 − (z·σ·√T + slippage)` (`services/edge-auth/src/haircut.rs`) already
reserved the buffer this swap consumes: the `settlement_slippage_bps` term is *exactly* the slippage of
this ETH→USDC conversion, and the `z·σ·√T` term covers the price drift between auth and settlement. So:
> **The settlement swap's realized shortfall (drawdown + slippage) is bounded by γ by construction.**
> If the buffer holds, the swap produces ≥ the owed USDC. If a swap would come up short (a move beyond
> γ), that is the junior first-loss event the tranche is designed to absorb — never a senior/rail loss.
This is the on-chain ↔ off-chain contract. Keep γ's inputs and the swap's `minOut` reconciled.

## Reuse, don't reinvent: the treasury stack already has this pattern
`MintwareTreasuryJitHook` already swaps a volatile leg → USDC safely under the V4 afterSwap constraints
in its keeper sweep — `_swapTeamToUsdc` + `_swapLimit` + `_sqrtAtClamped` + `SWEEP_BAND_TICKS = 500`:
an **oracle-bounded** swap (limit = truncated-oracle price ± band, clamped to the executable side of
spot, so a sandwich that moved spot can't force execution at the bad price; if spot is already past the
band it converts ~nothing rather than dumping). `MWTreasuryPositionLib` similarly sells the team leg on
recover. The ETH→USDC settlement swap is the SAME shape:
- Reuse the `_swapLimit`/`_sqrtAtClamped` oracle-bounded price cap (the vault reads its truncated-oracle
  tick — the `MWOracleGuard` seam already in the hook).
- Reuse the take-or-mint-6909 + keeper-sweep discipline for the afterSwap-owed-token gotcha
  (`v4_afterswap_settlement_timing` memory) if the swap routes through a hook-mid-swap path.
- **The P3 `jitSkipSender` exemption applies for free:** the vault's OWN settlement swap runs as
  `jitSkipSender`, so it is exempt from the am-AMM/JIT auction path (the exact HIGH fix from `fb8e7633`
  /`4e269ee6`) — no self-skim, no reentrant `fundRent` deadlock. Settlement swaps and trading flow don't
  collide.

## Architecture
- **Entry point: the ETH-collateral vault.** It owns the ETH → it must initiate the swap. Add
  `batchSettleEth(bytes32[] holdIds, uint256 totalUsdc, uint256 minUsdcOut, address gateway)`.
- **Orchestration: the relayer** (`services/relayer`). At batch time it groups the settling holds for one
  ETH vault, computes `totalUsdc` (Σ hold amounts) + a `minUsdcOut` (from the edge's conservative price ×
  γ), signs/sends the tx. (Extends the existing `settleSpend` calldata core.)
- **Payout: reuse the Gateway.** The swap produces USDC into the vault; then the existing
  `MintwarePaymentGateway.settleSpend` path pays the rail per hold — the swap is a pre-step, not a new
  settle path. (Or `batchSettleEth` calls `settleSpend` per hold inside the same tx.)

### batchSettleEth flow (inside one v4 `unlock`)
1. `require` the caller holds the settlement role (relayer) and `holdIds` are valid/active.
2. `poolManager.unlock` → callback:
   a. swap ETH→USDC, `amountSpecified` = exact-output `totalUsdc` (or exact-input a computed ETH slice),
      `sqrtPriceLimit` = the oracle-bounded `_swapLimit` — **never past the band**.
   b. `take` the USDC; if `usdcOut < totalUsdc` → **revert `SettlementSlippageExceeded`** (fail safe: do
      not pay the rail with short USDC; the junior-buffer backstop is a separate, explicit branch).
   c. settle each hold via the Gateway (pay the rail), mark settled.
3. Account: reduce the vault's ETH backing by the ETH spent; the USDC leaves to the rail. Net vault value
   drops by exactly `totalUsdc` (the user spent it). Update tranche state (senior par / junior first-loss)
   the same way the treasury vault does — **the senior stays price-free**; the ETH-price exposure and any
   swap shortfall land on the junior.

## Design decisions + risks (resolve before building)
1. **Batch vs per-hold.** Batch (one swap for Σ holds) cuts gas + slippage vs many small swaps, but adds
   a batch entrypoint + a settlement window. RECOMMEND batch, windowed by the relayer.
2. **Which pool.** The vault's OWN ETH/USDC position (captures its own fee, but self-impact) vs an
   external canonical deep ETH/USDC pool (less slippage, no self-impact). RECOMMEND the deepest available
   pool, oracle-bounded either way. If the vault LPs its own ETH/USDC, `jitSkipSender` exempts the swap.
3. **Exact-output vs exact-input.** Exact-output (`totalUsdc`) is cleanest (produce exactly what's owed,
   residual ETH stays) but can revert on thin liquidity; exact-input a γ-sized ETH slice + refund the USDC
   surplus to the vault is more robust. RECOMMEND exact-output with the oracle-bounded limit; fall back to
   the junior-buffer branch on `SettlementSlippageExceeded`.
4. **Shortfall backstop.** When the oracle-bounded swap can't produce `totalUsdc` (move beyond γ), DO NOT
   under-pay. Either (a) draw the junior USDC buffer to top up (first-loss absorbs it — matches the vault's
   `juniorUsdcBuffer` model), or (b) revert + retry next window. RECOMMEND (a) up to the buffer, else (b).
5. **MEV / sandwich.** The oracle-bounded `_swapLimit` is the primary guard (execution can't be forced
   past the truncated-oracle band). Batching + windowing reduces predictability. Consider settling via a
   private/mev-protected route.
6. **Reentrancy.** Settlement runs inside the vault's `nonReentrant` unlock; if it swaps on the vault's
   own am-AMM pool, the `jitSkipSender` exemption already prevents the poke→fundRent deadlock (P3 fix).
7. **LST collateral (stETH/rETH).** Not 1:1 with ETH — needs the LST/USD (or LST/ETH × ETH/USD) feed and
   an LST→USDC route (or LST→ETH→USDC). The edge already carries `feed_decimals` per vault; mirror the
   route here.

## Build phases
1. ✅ **DONE (2026-08-16).** `batchSettleEth` — shipped as the standalone `MintwareEthSettlement.sol`
   (not folded into the simple `MintwareYieldVault`, which has no V4 seam; a standalone settlement module
   funded with WETH backing + a junior USDC buffer keeps the swap independently auditable and lets the ETH
   vault stay the price-free single-asset vault it is). Reuses `_swapLimit`/`_sqrtAtClamped`/`_settleDelta`
   verbatim from the JIT hook, reading the truncated tick from an injected `IOracleTickSource` (the hook's
   `oracleTick()` view in prod). Exact-output `totalUsdc`, oracle-bounded → partial-fills at the band.
   Forge tests all green as described in the status banner. **Design choices locked here:** batch (decision
   1), exact-output with junior-buffer fallback (decision 3+4a), `minUsdcOut` catastrophe floor before any
   junior draw (decision 4/5), per-call junior cap (open-question 3 → answered: yes, `juniorTopUpCapPerCall`).
2. Relayer batch-settle path (`services/relayer`): group holds per ETH vault, compute `totalUsdc` +
   γ-derived `minUsdcOut`, build/sign/send. Extends the existing `settleSpend` calldata core.
3. Wire the edge: an ETH vault's `idle_buffer` becomes "ETH convertible to USDC at the conservative
   price" once this exists (so the edge's Σ-settleable gate counts it) — reconcile with `haircut.rs` γ.
4. External audit (same gate as the vault stack) before any real value.

## Open questions
- [ ] Single canonical ETH/USDC settlement pool per chain, or per-vault configurable?
- [ ] Batch window length (relayer) vs card-network settlement SLAs?
- [ ] Does the junior-buffer top-up (decision 4a) need a per-window cap to avoid draining first-loss on a
      bad day, forcing (4b) revert-and-retry past a threshold?
- [ ] Keeper vs relayer ownership of the settlement trigger (who pays gas, who holds the role)?

## Related
`services/edge-auth/src/haircut.rs` (γ = the buffer this swap consumes) · `MintwareTreasuryVault`
`_swapTeamToUsdc`/`_swapLimit` (the pattern to reuse) · `MintwarePaymentGateway.settleSpend` (the payout)
· `services/relayer` (orchestration) · `v3-to-v4-migration-spec.md` (the other parked on-chain piece).

# LP Gateway V1 — Blockchain Self-Audit

Scope: the on-chain V1 LP-gateway surface only —
[`MintwareLpGatewayPositionManager`](../../contracts-v4/src/gateway/MintwareLpGatewayPositionManager.sol),
[`MintwareLpGatewayStaging`](../../contracts-v4/src/gateway/MintwareLpGatewayStaging.sol),
[`MintwareLpGatewayFactory`](../../contracts-v4/src/gateway/MintwareLpGatewayFactory.sol). Testnet-first,
audit-gated for mainnet; this is our own review before external audit, not a substitute for it.

## Why the attack surface is small (by design)

V1 deliberately **routes value into two well-known, external, audited systems** and holds almost no novel
money logic itself:

- **Idle capital → Morpho** (a standard ERC-4626 vault, via `MintwareERC4626YieldAdapter`). The gateway
  never re-implements lending; it deposits/redeems shares. Morpho is the trust anchor there.
- **Deployed capital → an existing third-party Uniswap V4 pool**, through the **official V4
  PositionManager periphery** (MINT/INCREASE/DECREASE/SETTLE/TAKE). All position + liquidity math is
  Uniswap's audited `LiquidityAmounts` / `SqrtPriceMath` / `StateLibrary`; we encode calls, we don't do
  our own AMM accounting.

So the gateway's *own* code is thin: share accounting (one shared, audited `SeniorSharesMath` offset),
NAV valuation, and access control. The self-audit therefore concentrates on the seams **we** own — the
places where our thin layer meets those external systems — and makes each one bulletproof.

## Findings & fixes (all fixed on-chain in this PR)

### C1 — CRITICAL: spot-price NAV is flash-manipulable
**Where:** `totalNav()` values the deployed LP leg at the pool's live spot (`getSlot0`). A hookless meme
pool has **no on-chain TWAP**, so a single-tx flash loan could pump the pool, inflating the LP leg's
quote value, and a withdrawer would redeem `toAssets(shares, totalNav())` at the inflated mark —
draining other depositors' idle reserve — then unwind. (`toAssets` is *required* for donation-safety on
the idle leg, so the fix can't just drop the offset; the spot **read** had to be made flash-resistant.)

**Fix — layered, in `MintwareLpGatewayPositionManager`:**
1. **Deviation breaker (`_checkAndAnchor`).** deposit/withdraw record a reference `sqrtPrice` once per
   block; a later action whose live spot deviates from that (prior-block) anchor by more than
   `maxDeviationBps` (default **2000** = 20% of sqrtPrice ≈ 44% price) **reverts (`PriceDeviation`)**. A
   flash pump moves spot far from the un-pumped prior-block anchor → caught. The anchor re-freshens on
   every deposit/withdraw and on the owner's deploy/harvest (`_anchorPrice`), so it tracks legit drift.
2. **Same-block guard (`SameBlockAction`).** One address cannot deposit **and** withdraw in the same
   block — kills the atomic round-trip form.
3. **Capped deploy ratio.** Only `LP_GATEWAY_DEPLOY_RATIO_BPS` (default 50%) of capital ever enters the
   spot-priced LP; the rest earns in Morpho, whose NAV is **not** pool-spot-manipulable.
4. **Owner escape hatch (`pokePrice`).** If sharp *legitimate* volatility locks the breaker against a
   stale anchor, the owner re-anchors. It moves no funds; only resets the reference.

**Residual (disclosed):** a patient **cross-block** manipulator on a **thin** pool — holding a price
move across blocks, real capital at risk — is not fully stopped on-chain (no TWAP exists to lean on).
The economic backstop is **deep-pool curation** (we only serve pools where that move costs more than it
could steal) and a low deploy fraction; mainnet stays **audit-gated**. The breaker's live revert-on-pump
is exercised in the operator's fork run (`MintwareLpGatewayFork.t.sol` + the runbook's swap→withdraw
step); its guards (band validation, same-block, `pokePrice` access) are unit-tested.

### M1 — MEDIUM: staging controller could be front-run
`MintwareLpGatewayStaging.setController` was callable by anyone before it was wired, so a front-runner
could seize the controller seat (which moves staged capital) between deploy and `setController`.
**Fix:** the staging records its `deployer` (the factory) at construction; `setController` is
**deployer-only** (`NotDeployer`). The factory sets it atomically in `createGateway`, so there is no
window.

### M2 — MEDIUM: adapter reuse cross-contaminates NAV
A curator could pass one `IYieldAdapter` instance to two gateways; both stagings would deposit into the
same Morpho position, so each gateway's `stagedAssets()` (its idle NAV) would include the other's
capital. **Fix:** the factory tracks `adapterUsed[adapter]` and **reverts reuse (`AdapterReused`)** —
every gateway must get its own freshly deployed adapter.

### Owner fee-redirect
`setHarvestRecipient` let the owner repoint the harvested-fee stream to a fresh address at any time.
**Fix:** `harvestRecipient` is now **immutable**, set once by the factory; the setter is removed.

## What was checked and found sound (no change needed)

- **Withdraw donation-safety.** `withdraw` uses `SeniorSharesMath.toAssets` (offset-consistent), not raw
  pro-rata — a donation-inflated idle leg can't be drained by the next depositor. (Locked by
  `test_inflationDefense_secondDepositorWhole`.)
- **Principal is never spent on harvest.** `harvest` is a zero-liquidity-delta collect
  (`DECREASE_LIQUIDITY(0)` + `TAKE_PAIR`) — only fees leave the position.
- **Reentrancy.** All state-changing externals are `nonReentrant`; effects precede interactions in
  `withdraw`.
- **Owner surface.** `deploy` / `harvest` / `pokePrice` are `onlyOwner` (the oracle-signer cron seat),
  and `Ownable2Step` guards ownership transfer. The owner can direct capital into the curated pool and
  collect fees to the fixed recipient — it cannot mint shares, change the fee recipient, or withdraw
  depositors' principal to itself.
- **NAV never overstates.** `_amountsForLiquidity` rounds down; the paired→quote conversion rounds down.

## Test coverage
`forge test --match-contract LpGateway` → **30 passing** (staging 9, positionManager 14, factory 7)
+ the self-skipping fork harness. Off-chain: the gateway Vitest suites (`lib/gateway/*`) are unchanged.

## Deploy posture
Every money path is flag-gated OFF and fail-closed; V1 runs on Robinhood **testnet** first (mock USDG +
mock adapter + a fresh pool). Real USDG + the Morpho Steakhouse vault + a real curated pool + the router
executor + an **external audit** gate real value on mainnet.

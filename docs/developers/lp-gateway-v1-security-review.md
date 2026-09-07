# LP Gateway V1 — Firm-Grade Security Review

**Engagement:** independent multi-auditor review (4 parallel domain auditors + lead re-derivation of the
C1 control), adversarial, read-only. **Target:** `feat/lp-gateway` (contracts + money-path off-chain +
deploy). **Date:** 2026-09-06. **Status:** testnet, unaudited by an external firm — this is our own
firm-style pass before that gate, and it is not a substitute for it.

## Scope
- Contracts: `MintwareLpGatewayPositionManager.sol`, `MintwareLpGatewayStaging.sol`,
  `MintwareLpGatewayFactory.sol`, `SeniorSharesMath.sol`, `MintwareERC4626YieldAdapter.sol`, the deploy
  scripts (`DeployLpGateway.s.sol`, `SetupLpGatewayTestnet.s.sol`, `scripts/deploy-lp-gateway-robinhood.mjs`).
- Off-chain money-path: `lib/gateway/*`, `app/api/gateway/*`, `cron/gateway-{harvest,deploy,discover}`,
  the two SQL migrations, `lib/web3/artifacts/lpGateway.ts`.
- **Out of scope:** the V1 app UI (Discover/Portfolio/Swap) — under active rebuild, not security-critical.

## Result summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 1 (**fixed**) | C-01 |
| High | 3 | H-01, H-02, H-03 |
| Medium | 7 | M-01 … M-07 |
| Low | 9 | L-01 … L-09 |
| Informational | 2 | I-01, I-02 |

The stack's **mechanics are careful** — reentrancy is contained, the balance-delta pattern is
fee-on-transfer-robust, the ERC-4626 adapter's NAV is fee-aware and donation-safe, the swap seam is inert
until wired, RLS is deny-all, crons are flag-gated and fail-closed. The material risk is concentrated in
**(a) the off-chain trust root** (curator auth → registry → deposit routing) and **(b) the spot-priced
NAV / fee accounting** on a hookless pool. One live auth bypass (C-01) was found and fixed during the
review. Nothing here changes the standing posture: **external audit gates real value**, and on-chain the
C1 breaker is a bar-raiser, not the control — deep-pool curation + a capped deploy fraction are.

## Trust model (as-built)
- The gateway **owner + `harvestRecipient`** is one Privy server-wallet (`getOracleSigner('root')`, key in
  Privy's enclave). It runs deploy/harvest and can `pokePrice`. **Depositor safety against a compromised
  owner key is ~nil** (see H-03/M-02) — this is inherent to a hookless, no-TWAP design and must be stated.
- **Curation** (which pools go live) is human-gated by a bearer secret; the **registry row** it writes is
  the deposit-routing trust root (H-01).
- Depositor principal is **never transferable to the owner** by any function; extraction paths are
  economic (AMM manipulation) or the fee stream, not a direct principal sweep.

---

## Findings

### C-01 — CRITICAL (fixed) · Curator auth used a committed static bearer as its "fail-closed" fallback
`app/api/gateway/curate/route.ts:91`. `bearerSecret: process.env.LP_GATEWAY_CURATOR_SECRET ?? 'unset-curator-secret-fail-closed'`.
The routeHandler computes `secret = opts.bearerSecret ?? CRON_SECRET ?? ''` and only fails closed (500)
when `secret` is empty. A **non-empty** fallback skips that guard and becomes a working credential, so
with `LP_GATEWAY_CURATOR_SECRET` unset (the current expected state) **anyone** sending
`Authorization: Bearer unset-curator-secret-fail-closed` is authorized as curator — the entry to H-01.
**Fix (applied):** `?? ''` → the handler returns 500 when unset (and does not silently accept
`CRON_SECRET`). **Verified fixed.**

### H-01 — HIGH · Registry instance-address-substitution: one row sets the app's deposit target
`lib/gateway/registry.ts` (`registerInstance`/`resolveGatewayByPool`) → `app/api/gateway/{meta,deposit}/route.ts`.
The sole writer to `gateway_instances` is the curate route; the app then advertises the row's
`position_manager` as the deposit target, and `deposit` "verifies" the user tx as `receipt.to === inst.positionManager`
— i.e. against the address the registry supplied. A malicious (via C-01), compromised, or mistaken curator
substitutes an arbitrary contract and user funds route to it. **Recommendation:** before trusting a
registered address, read it on-chain and assert `positionManager.quoteAsset() == quote_asset` and
`positionManager.poolKey()` matches the approved pool; prefer requiring it to be factory-deployed;
log/alert on every registration.

### H-02 — HIGH · Withdraw (and deploy) leak the whole position's accrued fees to the caller
`MintwareLpGatewayPositionManager.sol` `_decreaseAndTake` (withdraw path) / `_increaseCalls` (deploy).
In Uniswap v4 **any** `modifyLiquidity` settles the position's **full** accrued fees — which is exactly
why `harvest()` uses a zero-liquidity decrease. So when `withdraw` removes a real slice of liquidity,
`_decreaseAndTake` collects the principal for that slice **plus 100% of the aggregate position's
uncollected fees** and forwards all of it to `msg.sender`. NAV excludes fees, so the withdrawer receives
their fair principal **and** the entire fee pot — bypassing the spend buffer, non-pro-rata, and
**farmable** (deposit → wait for fees → withdraw enough to exhaust idle so the LP leg is touched → pocket
all fees). `deploy` has the mirror leak (paired fees returned to owner, quote fees re-staged).
**Recommendation:** sweep fees to `harvestRecipient` with a 0-delta collect at the top of `withdraw`/`deploy`,
or separate the fee delta from principal in `_decreaseAndTake`. **Confirmed on standard v4 fee-on-modify
semantics; verify with a fork test that accrues fees then withdraws and asserts the buffer received them
before relying on the fix.**

### H-03 — HIGH · Cross-block spot-NAV manipulation drains the real idle reserve (C1 is single-block only)
`_checkAndAnchor` re-anchors the reference **every block**, so the deviation test only bounds the move
*within the current block*. On a hookless pool an attacker walks spot just under the band each block,
re-anchoring as they go, to any target; `totalNav()` marks the LP leg at spot and `withdraw` pays
**idle-first from the real Morpho reserve**, so the inflated claim is paid in **real USDG**, socialized to
remaining depositors (worked example: 25% holder extracts ~1.5× their fair claim). The single-block flash
is genuinely blocked (same-block guard + non-transferable shares + the band, all verified); the cross-block
walk is not. **Mitigation in place:** breaker + capped deploy fraction (idle majority is not spot-priced) +
deep-pool curation. **Recommendation:** tighten `maxDeviationBps` materially (2000 bps ≈ **44% price/block**
is very loose), mark the LP leg at a conservative floor, and/or cap per-address/epoch idle-reserve
redemption. **The on-chain breaker rate-limits; it does not prevent — curation + depth are the real control.**

### M-01 — MEDIUM · A legit >band move bricks deposits *and* withdrawals; owner-only recovery
`_checkAndAnchor` only re-anchors on a *successful* (in-band) action, so once spot jumps past the band
(routine for a meme token) every deposit/withdraw reverts `PriceDeviation` and the ref never updates —
the gateway wedges until the owner calls `pokePrice()`. Users can't exit during the volatility that
matters; if the key is lost or `renounceOwnership()` is called, funds lock permanently. Violates "never
locked, always yours." **Recommendation:** don't revert user *withdrawals* on deviation (a user exiting at
a bad mark only hurts themselves); add a permissionless, rate-limited "re-anchor when stale by N blocks";
override `renounceOwnership()` to revert.

### M-02 — MEDIUM · `pokePrice()` / `_anchorPrice` re-anchor with no deviation cap → owner can disable the breaker
`pokePrice` (onlyOwner) sets the reference to any current spot with no bound; `deploy`/`harvest` do the same
via `_anchorPrice`. A compromised/malicious owner can pump → poke → let a manipulated deposit/withdraw
through. It widens owner power beyond deploy/harvest into disabling a depositor protection.
**Recommendation:** bound or timelock `pokePrice` (reject a re-anchor beyond X% of the prior ref); consider
a guardian / 2-of-N for the deploy/poke seat before mainnet.

### M-03 — MEDIUM · `deploy()` mints liquidity with no price bound and is not breaker-guarded
`deploy` reads spot and mints at that price with `amountXMax` = the full amounts and no `minLiquidity`; it
runs `_anchorPrice` (no deviation check), not `_checkAndAnchor`. As a public-mempool cron tx on a thin pool
it is sandwichable. *Auditor severity was split (High vs Medium): the tight `amountXMax` reverts most
adverse fills, bounding the residual to the non-binding-leg headroom — Medium in the general case, High on
a thin pool with large headroom.* **Recommendation:** add a caller-supplied `minLiquidity` / per-leg
min-amounts, or apply `_checkAndAnchor` to deploy, or submit via a private mempool.

### M-04 — MEDIUM · `deposit`/`withdraw` API routes are unauthenticated and cost-basis is replayable
`app/api/gateway/{deposit,withdraw}/route.ts` default to `auth:'none'` with a caller-supplied `address`,
and update `gateway_positions.entry_nav` additively with **no txHash idempotency**. Anyone can replay a
victim's real deposit tx to inflate their `entry_nav` without bound, corrupting the dashboard PnL/IL figure.
Not direct theft (harvest credits track on-chain **shares**, not `entry_nav`), but a data-integrity/griefing
break. **Recommendation:** a `gateway_deposit_events` table with a unique `(tx_hash)` index + idempotent
basis updates, and/or `auth:'signed-message'` (action-bound) so only the owner records their own tx.

### M-05 — MEDIUM · Harvest is an off-chain IOU; 100% of fees leave to the owner seat; paired fees can go silently unconverted
On-chain, `harvest()` sends all fees to `harvestRecipient` (= the owner seat); the perf-fee skim + pro-rata
depositor split are **pure DB accounting** with nothing on-chain tying a buffer credit to segregated funds.
When the paired→quote swap is unwired, `pairedFees` sit unconverted in the wallet and are never credited —
depositors under-receive with no ledger of the owed leg. Solvency rests on the operator honoring DB
balances. **Recommendation:** before real value, settle net harvest to a segregated/contract-held balance
or emit on-chain per-user credits; track unconverted paired fees as an explicit liability. Also disclose
plainly that on-chain, LP fees do **not** accrue to depositor NAV (interacts with H-02).

### M-06 — MEDIUM · Idle-first redemption ordering is a first-mover / bank-run advantage
`withdraw` pays idle (clean USDG) before the IL-exposed LP legs. `claimValue` is fair in *value* but not
composition: early exiters get clean quote, later ones are forced increasingly into LP at a spot mark. In a
falling market this is a run, and it amplifies H-03 (it's what lets a manipulator take real quote).
**Recommendation:** redeem pro-rata across idle and LP, or gate idle-first redemption behind a queue/epoch.

### M-07 — MEDIUM (availability) · USDG (Paxos) freeze/pause bricks deposits & withdrawals
If the gateway or staging address is frozen, `deposit`/`withdraw` revert and even the "best-effort" `unstage`
reverts on its final transfer to the (frozen) gateway — funds stuck until unfrozen. Inherent to USDG.
**Recommendation:** document as accepted operational risk; consider an owner escape/redirect hatch (weighed
against the trust it adds).

### Low
- **L-01** — `withdraw`'s `DECREASE_LIQUIDITY` passes `amount0Min=amount1Min=0` (no slippage floor on user
  principal removal; couples with H-03 on basket composition). Pass a tolerance-based min.
- **L-02** — `deploy` cron has no idempotency/lock → retries can compound-deploy (latent; masked while the
  zap seam is unwired). Add a `deploy_events` key / per-pool lock before enabling.
- **L-03** — `GET /api/gateway/position?address=` is unauthenticated and returns any wallet's off-chain
  `bufferBalanceAtomic`. Gate behind signed-message or omit it from the public read.
- **L-04** — Dangling Permit2/ERC20 allowances after `deploy` (rounding leftovers; bounded to the official
  PM spender, 30-min expiry). Zero them after each `_modify`.
- **L-05** — Entry-at-par vs fee-net NAV: for a fee-charging 4626 source, a depositor is credited on par
  `quoteAmount` but only adds `quoteAmount·(1−fee)` of NAV → small one-directional dilution of earlier
  holders. Price the mint on the NAV delta, or restrict to fee-free sources.
- **L-06** — Factory + adapter are one-step `Ownable` (PM is `Ownable2Step`); no `renounceOwnership`
  override anywhere. Use `Ownable2Step` everywhere; block renounce on the PM.
- **L-07** — Shares minted on the *requested* quote amount, not the received delta — assumes a standard
  (non-FoT/non-rebasing) quote. True for USDG; keep the invariant explicit.
- **L-08** — Anchor poisoning within an owner tx's block: a *same-block* deposit/withdraw after a sandwiched
  owner `deploy`/`harvest` validates against the poisoned reference (owner-only reachability). Have
  `_anchorPrice` sanity-check the price too.
- **L-09** — GeckoTerminal fields (`address`, `name`, metrics) are ingested unvalidated (no `isAddress`,
  no NaN rejection, no label cap). Confined to the human-gated pending queue (React auto-escapes), but
  validate before ingest to avoid a spoofed `pair_label` misleading a curator.

### Informational
- **I-01** — M2 caveat: the factory's `adapterUsed` guard prevents reuse *within one factory* but doesn't
  bind or verify the adapter (`asset()==quote`, `vault()==staging`); real isolation leans on the production
  adapter's one-time `onlyVault`. Mock adapters (scripts) lack it. Have the factory verify the binding.
- **I-02** — Deploy paths don't assert pool-initialized/depth, adapter wiring, or `getChainId()==configured`;
  infra addresses are hardcoded and trusted by comment. Add pre-flight asserts (esp. the real
  `DeployLpGateway.s.sol` and a `getChainId` check in the `.mjs`).

---

## Verified sound (no change needed)
- **Reentrancy** contained: `nonReentrant` + `onlyController`/`onlyVault` block any paired-token re-entry
  during `modifyLiquidities`.
- **Balance-delta measurement** is the correct FoT/weird-token-robust pattern; a malicious paired token
  cannot subvert gateway solvency (at worst donates to itself → forwarded to the attacker).
- **ERC-4626 adapter**: fee-aware NAV via `previewRedeem`, exit via `redeem`, best-effort withdraw; a plain
  token donation to the adapter **cannot** inflate idle NAV (closes that vector independent of the offset).
- **SeniorSharesMath** offset (VIRTUAL=1e6) + withdraw `toAssets` are donation-safe at the math layer;
  sum of claims ≤ NAV; adequate for 6-dp USDG.
- **`v4SwapExec.ts`** is truly inert until configured; min-out is double-enforced when enabled.
- **Off-chain**: deny-all RLS on all four new tables; constant-time bearer compare; crons move value only
  via the owner signer and only when `LP_GATEWAY_{HARVEST,DEPLOY}_ENABLED==='true'` (default off) with
  range-validated ratios; harvest idempotent on `collect_tx`; `riskScore` never certifies (`verdict:'review'`
  always) and discovery only writes human-gated `pending` rows — untrusted GeckoTerminal data never reaches
  an on-chain action.
- **Deploy `.mjs`**: no secret leak (Privy-signed, no raw key; secret never printed), correct owner/recipient
  wiring, canonical Permit2.

## Verdict on the prior self-audit fixes
- **M1** (deployer-only `setController`): **SOUND** — verified across factory / script / `.mjs` paths; no
  re-init window a front-runner can pass.
- **M2** (factory adapter-reuse guard): **SOUND but INCOMPLETE** — prevents reuse within a factory; broader
  NAV-isolation leans on the adapter's one-time `onlyVault` (I-01).
- **Owner-fee immutability**: **SOUND** — redirection removed; but the *fee-flow economics* remain an issue
  (H-02, M-05).
- **C1** (deviation breaker): **INCOMPLETE** — blocks the single-block flash (verified), not the cross-block
  walk (H-03), and introduces a withdrawal-DoS (M-01).

## Remediation priority (pre-mainnet)
1. **[Done] C-01** — fixed in this review.
2. **Must-fix before any real value:** H-01 (registry on-chain sanity checks), H-02 (fee accounting +
   fork test), H-03 (tighten band / conservative LP mark / redemption caps), M-01 (non-reverting
   withdrawals + stale re-anchor), M-02 (bound `pokePrice`), M-03 (`deploy` min-out), M-04 (auth +
   idempotency), M-05 (on-chain fee treatment).
3. **External audit remains the gate.** This pass substantially raised the bar and confirmed the core
   mechanics are sound, but on a hookless pool the on-chain breaker is not the control — deep-pool
   curation, a capped deploy fraction, honest disclosure, and Privy key custody are.

---

## Remediation status (2026-09-07 — same branch)

Every finding above was addressed. The 29 gateway Forge tests + 49 gateway Vitest tests are green, and the
hardened contracts were redeployed to Robinhood testnet (2026-09-07). **LP-path proven on-chain
(2026-09-07)**: a live `deploy() → withdraw()` round-trip against the real Uniswap V4 pool minted a real
position, `totalNav` picked up the LP leg, and withdraw did **pro-rata idle+LP sourcing**, ran the
**fee-sweep** (H-02), and **conserved value** (out + locked offset-dust = pre-withdraw NAV — donation-safety
intact). Still requiring the swap seam wired (a documented fork-test step): **fee-generation** and
**spot-price-manipulation** assertions (i.e. observing the conservative min/max mark diverge under a pump).

| ID | Fix shipped |
|---|---|
| **C-01** | curate `bearerSecret: … ?? ''` — fails closed (500) when unset, no `CRON_SECRET` fallback. |
| **H-01** | `registry.verifyInstanceOnChain` reads the candidate PM's `quoteAsset()`/`poolKey()` and rejects `quote_asset_mismatch` / `quote_not_in_pool` / `pool_mismatch` before writing a `gateway_instances` row. |
| **H-02** | `_sweepFees` (0-liquidity collect → `harvestRecipient`) is now called at the top of the withdraw LP branch and of `deploy`, so a user's decrease/increase returns **principal only** — the position's fees always route to the buffer. |
| **H-03** | **Clamped-follower reference** (tracks spot ≤ `maxDeviationBps`/block) + **directional conservative NAV** (withdraw marks the LP leg at `min(spot,ref)`, deposit at `max`); default band **tightened 2000→500 bps**. A single-block pump can neither inflate a claim nor cheapen entry. |
| **M-01** | Withdrawals no longer revert on price (conservative mark replaces the deviation-revert) → they never brick. `renounceOwnership()` disabled. |
| **M-02** | `pokePrice()` **removed** — no unbounded owner re-anchor; the follower + `_anchorFollow` (bounded step) keep the reference honest, so a compromised key can't neutralise the mark. |
| **M-03** | `deploy()` takes a `minLiquidity` floor and reverts `MinLiquidityNotMet` below it (cron threads `LP_GATEWAY_DEPLOY_MIN_LIQUIDITY`; the runbook `cast` path passes one). |
| **M-04** | `deposit`/`withdraw` routes now require **signed-message auth** (owner records own tx via `ctx.user`) + **`gateway_deposit_events` UNIQUE(tx_hash)** idempotency → no replay basis corruption. |
| **M-06** | Withdraw sources the idle reserve **pro-rata** (`claimValue·idle/nav`), not idle-first → no first-mover / bank-run advantage. |
| **L-02** | `deploy` cron reserves a `gateway_deploy_events` (position, window) row before submitting; a UNIQUE conflict no-ops a retry. |
| **L-03** | `position` route no longer discloses `bufferBalanceAtomic` to arbitrary callers (owner-authenticated). |
| **L-04** | `deploy` revokes the residual Permit2 allowance after the mint (`_revokePermit`). |
| **L-06** | Factory is `Ownable2Step`; PM `renounceOwnership` disabled. |
| **L-09** | `discovery` validates GeckoTerminal input (`isAddress`, finite-metric guards, label cap). |
| **I-02** | `.mjs` asserts `getChainId()` == configured and that PoolManager/PositionManager/Permit2 have on-chain code before deploying. |
| **M-05** | Partial: fees now provably reach the buffer on every path (H-02); the *full* on-chain segregated-settlement re-architecture is a documented pre-mainnet item. |
| **M-07** | Documented accepted risk (USDG freeze is inherent to Paxos USDG; no owner rescue hatch added, to preserve the trust model). |
| **I-01** | Deferred: a factory-level `adapter.asset()==quote` check needs a common adapter getter (`IYieldAdapter` lacks one, mocks use `underlying()`) — isolation leans on the production adapter's one-time `onlyVault`; documented as curation-gated. |
| **L-01/L-05/L-07/L-08** | Low residuals: withdraw decrease keeps `min=0` deliberately (non-bricking priority — value is protected by the conservative mark); L-05/L-07 hold for standard fee-free USDG; L-08 mooted by the bounded follower. Documented. |

**Still gating mainnet:** the full M-05 fee-settlement architecture, an external audit, and the standing
curation + deep-pool + capped-deploy posture.

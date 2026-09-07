# LP Gateway (V1) — the first live product surface

> **Status (2026-09-07):** **LIVE on Robinhood Chain testnet (46630)**, hardened + self-audited + firm-grade
> reviewed, merged to `main`. **Testnet + mock tokens + UNAUDITED** — external audit gates real mainnet value.
> Deploy truth: [`config/deployments.json`](../../config/deployments.json) (`robinhood-testnet`) + `STATE.md`.
> Explainer: [`docs/developers/lp-gateway.md`](../../docs/developers/lp-gateway.md).

## What V1 is (one loop)
A **separate product surface** — touches none of the vault / JIT / YPN-treasury contracts. A user deposits
**USDG** (not USDC — parameterized everywhere; Robinhood Chain, Paxos USDG, 6dp) → it **stages into a
Morpho-shaped ERC-4626 adapter and earns immediately** → the owner deploys a **capped fraction** as liquidity
into an **existing, curated third-party Uniswap V4 pool** → **harvest collects trading fees (never principal)**
into a **yield-first spendable buffer**. Idle-buffer framing: *"put idle cash to work, spend from the buffer,
not your position."* The smallest concrete slice of "never idle, never locked, always yours."

## Contracts ([`contracts-v4/src/gateway/`](../../contracts-v4/src/gateway/))
- **`MintwareLpGatewayPositionManager`** — the core. `Ownable2Step`. One aggregate V4 position per pool,
  wrapping the OFFICIAL v4 PositionManager periphery. Entry-NAV shares via **`SeniorSharesMath`** (VIRTUAL=1e6
  offset, donation-safe). Owner-only `deploy(quote,paired,minLiquidity,deadline)` / `harvest(deadline)`.
- **`MintwareLpGatewayStaging`** — the Morpho earn reserve. `deployer`-gated `setController` (finding M1).
- **`MintwareLpGatewayFactory`** — curated (onlyOwner) multi-pool factory; per-pool isolated instances;
  adapter-reuse guard (M2); `Ownable2Step`; `DEFAULT_MAX_DEVIATION_BPS = 500`.

**Hardening (firm-grade review — see [`../../docs/developers/lp-gateway-v1-security-review.md`](../../docs/developers/lp-gateway-v1-security-review.md)):**
hookless meme pools have **no on-chain TWAP**, so manipulation resistance is a **clamped-follower reference**
(tracks spot ≤ `maxDeviationBps`/block) + **directional conservative NAV** (withdraw marks the LP leg at
`min(spot,ref)`, deposit at `max`) — a single-block pump can't inflate a claim or cheapen entry, and nothing
reverts on price so **withdrawals never brick** (H-03/M-01). `_sweepFees` runs before every principal
decrease/increase so the position's fees always route to the buffer, never a withdrawer (**H-02**). Withdraw
sources idle **pro-rata** (M-06). `deploy` takes a `minLiquidity` floor (M-03). `harvestRecipient` immutable
(no owner fee-redirect); `renounceOwnership` disabled; **no `pokePrice`** (M-02). ⚠ The other chat added an
owner **`paused` circuit-breaker** (blocks deposits, never withdraw) + **`compoundQuote`** — on their branch,
verify before relying. **Residual:** a patient CROSS-block manipulator on a THIN pool — deep-pool curation +
capped deploy are the economic backstop; mainnet is audit-gated.

## Off-chain ([`lib/gateway/*`](../../lib/gateway/), [`app/api/gateway/*`](../../app/api/gateway/))
- **`registry.ts`** — the deposit-routing trust root. `registerInstance` **verifies the candidate PM on-chain**
  (`quoteAsset()`/`poolKey()` must match the approved pool) before writing a `gateway_instances` row (**H-01**).
- **`discovery.ts`** — `fetchHotPools` (live GeckoTerminal read, network slug **`robinhood` = MAINNET**, powers
  the browse feed) + `discoverAndIngest` (persisted curator queue; **prunes** to the current top-30; validates
  input, L-09). A pool identifier is a **20-byte address OR a 32-byte v4 poolId** (`normalizePoolId` — v4
  pools have no address; **never `isAddress()`-gate them or the whole feed empties**, PR #470). `riskScore.ts`
  **ranks, never certifies** (verdict always `'review'`). `fetchHotPools` also sideloads token logos +
  symbols (`?include=base_token,quote_token`, https-guarded via `safeImg`) and parses the fee tier from the
  pair name → a list-level **est. fee APR** (feeRate × 24h vol ÷ TVL, annualized). These feed the Meteora/
  Krystal-parity Discover UI (`TokenPair` real icons, APR column, every row → `/earn/[pool]`). Est. APR is
  labeled an estimate, never a projection/guarantee (hard copy line).
- **Crons** (`app/api/(rewards)/cron/gateway-{discover,harvest,deploy}`) — flag-gated OFF + fail-closed;
  discover scheduled every 3h; deploy has idempotency (L-02). Money-moving crons sign via `getOracleSigner('root')`.
- **Routes** (`app/api/gateway/{discover,instances,position,deposit,withdraw,curate,request,meta}`) — all
  `createHandler`. `deposit`/`withdraw` require **signed-message auth + tx-hash idempotency** (M-04). `curate`
  bearer **fails closed** when `LP_GATEWAY_CURATOR_SECRET` unset (`?? ''`, not a literal — C-01). Swap seams
  (`routerSwap.ts`, `v4SwapExec.ts`) fail-closed no-ops until a router is wired.
- Migrations: `20260906000001` (positions/harvest) · `_002` (registry) · `20260907000001` (idempotency).
  All **deny-all RLS**.

## Surfaces & the V1/V2 model
- **`/v1`** ([`app/v1/page.tsx`](../../app/v1/page.tsx)) = the live product (`V1Shell` + `V1Discover` — the
  rolling curated-pool feed). **Flag-independent** — reachable any time. `/earn/[pool]` = deposit; `/curate` =
  curator queue.
- **V1 is a PRODUCT the site links to, NOT a site-wide mode.** V2 (the marketing/landing) is the front door,
  unchanged. The bridge is `LiveTodayStrip` (a slim "Live now → /v1" band) + the `LaunchModal` "V1 · Live" track.
- ⚠ **`NEXT_PUBLIC_V1_MODE_ENABLED` is a legacy dark-launch flag — leave it OFF.** Flipping it ON swaps the
  ENTIRE public site to V1 faces (it replaced the landing once → an incident, 2026-09-07). Do not flip it.

## Deploy, tests, framing
- **Deploy:** pure-Privy, no raw key — `scripts/deploy-lp-gateway-robinhood.mjs` (`pnpm deploy:lp-gateway:robinhood`).
  Runbook: [`../../docs/developers/lp-gateway-testnet-runbook.md`](../../docs/developers/lp-gateway-testnet-runbook.md).
- **Tests:** 32 gateway Forge (staging/PM/factory) + `MintwareLpGatewayHardeningFork.t.sol` (real
  `PoolSwapTest` swaps prove H-02/H-03, self-skips without `LP_FORK_RPC_URL`) + gateway Vitest (`lib/gateway/*`).
- **Hard copy lines** (same as the rest of the stack): idle-buffer, **never** "spend the fees" undersell or
  "100% spendable" overclaim; no **deposit / savings / guaranteed / fixed-APY**; testnet-honest; a liquidity
  position carries impermanent loss; external audit gates real value. `riskScore` never certifies safety.

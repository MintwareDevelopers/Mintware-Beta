# The LP Gateway (V1) — how it works

The **LP Gateway** is Mintware's first live product surface: put idle **USDG** to work in a curated
Robinhood Chain pool, earning while a spendable buffer stays liquid. It is the smallest concrete slice of
the "never idle, never locked, always yours" thesis — the vision made shippable.

> **Status:** live on **Robinhood Chain testnet (46630)**, hardened and reviewed (self-audit + a firm-grade
> multi-auditor pass). **Testnet, mock tokens, unaudited.** An external audit gates real value on mainnet.
> This is a separate product surface — it touches none of the vault / JIT / YPN-treasury contracts.

## The loop
1. **Deposit** — a user deposits USDG into the pool's gateway. They receive **entry-NAV shares** (marked at the
   live NAV on deposit — no par claim, no guaranteed return).
2. **Stage & earn** — the USDG **stages into a Morpho-style ERC-4626 yield adapter and earns immediately.**
   Idle capital is never idle.
3. **Deploy** — the operator deploys a **capped fraction** (default 50%) of staged capital as liquidity into
   an **existing, curated third-party Uniswap V4 pool.** The rest stays idle in Morpho, earning, IL-free.
4. **Harvest** — trading fees are collected via a **zero-liquidity-delta call that never touches principal**
   and credited to a **yield-first spendable buffer.**
5. **Spend** — you spend from the buffer — the yield the position earns — **not your position.** The principal
   stays put, working.

**The honest framing:** a liquidity position is **not** a deposit, a savings account, or a guaranteed/fixed
return — its value moves with the pool price and is subject to **impermanent loss.** You spend from a buffer
funded by yield, never a promised balance. The thesis is that high meme-pool fee flow out-earns the residual
IL; IL can be *diminished* (wide range + capped deploy fraction) but never *eliminated* for a fee-earning LP.

## Why it's safe on a hookless pool (the hard part)
The deployed LP leg is priced at the pool's **spot** price, and hookless meme pools have **no on-chain TWAP**.
So a naive spot-NAV is flash-manipulable. The gateway defends this without an oracle:

- **Clamped-follower reference** — a reference sqrt-price that tracks spot by at most a bounded step per block.
  A single-block flash pump can only nudge it one step, never onto the manipulated price.
- **Directional conservative NAV** — a *withdrawal* values the LP leg at `min(spot, reference)` and a *deposit*
  at `max(spot, reference)`. A pump can't inflate a withdrawal claim or cheapen a deposit — and nothing reverts
  on price, so **withdrawals never brick.**
- **Fees always route to the buffer** — every principal decrease/increase sweeps the position's accrued fees to
  the buffer *first*, so a withdrawer can never pocket the pool's fees.
- **Pro-rata redemption** — a withdrawal takes its proportional slice of idle **and** LP, not idle-first (no
  bank-run advantage).
- **Curation is the backstop** — the residual (a patient cross-block manipulator on a *thin* pool) is bounded
  by only serving deep pools and capping the deployed fraction. Mainnet is audit-gated.

Full findings + remediation: [`lp-gateway-v1-security-review.md`](./lp-gateway-v1-security-review.md). The
LP-path (deploy → real swaps → harvest → withdraw) is proven on-chain in
`contracts-v4/test/fork/MintwareLpGatewayHardeningFork.t.sol`.

## Many pools, curated (not one)
The gateway is a **factory** of isolated per-pool instances. The public **Discover feed** (`/api/gateway/discover`)
shows the hottest real Robinhood Chain pools **live from GeckoTerminal**, risk-scored, refreshed on a cron —
this is a *browse* surface and needs no deploys. A pool becomes **depositable** only once a curator approves it
and a gateway is deployed for it (each pool = its own on-chain instance). The **risk score ranks the queue; it
never certifies safety** — every pool is a human decision. So: **browse everything live, deposit into the
curated subset.**

## Where it lives
- **Product:** `/v1` (the Discover feed) · `/earn/[pool]` (deposit) · `/curate` (curator queue).
- **Contracts:** `contracts-v4/src/gateway/` (PositionManager, Staging, Factory).
- **Off-chain:** `lib/gateway/*` + `app/api/gateway/*` (all `createHandler`, deny-all RLS).
- **Deploy:** pure-Privy `scripts/deploy-lp-gateway-robinhood.mjs` — see the
  [testnet runbook](./lp-gateway-testnet-runbook.md).
- **Agent/context rule:** `.claude/rules/lp-gateway.md`.

## The V1 / V2 relationship
V1 is **a product the site links to, not a site-wide mode.** The V2 vision (treasury OS, YPN, cards, agents)
stays the marketing front door; the LP Gateway is one honest click away at `/v1` (via a slim "Live now" band
and the Launch chooser's "V1 · Live" track). There is a legacy `NEXT_PUBLIC_V1_MODE_ENABLED` flag that swaps
the whole site to V1 faces — it stays **off**; V1 is additive by construction.

## What's next (gated on external audit)
Real USDG + the Morpho Steakhouse vault instead of the mock rig, a real meme pool, the paired↔quote router
executor, mainnet gateways per curated pool, and an on-chain segregated fee-settlement path (the M-05
architectural item) — all behind the external audit that gates real value.

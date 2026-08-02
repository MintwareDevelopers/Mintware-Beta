# Phase 3 — MW Router Design (Best-Execution Order Flow)

**Status:** Design / proposal (not yet built)
**Track:** Foundation-adjacent — depends on Track 0 (factory + 4626 vaults) having real liquidity; ships alongside Track A (DeFi) and is a prerequisite for Track B (RWA) tradability.
**Branch (when built):** `feature/phase-3`
**Created:** 2026-08-01
**Owner:** _TBD_

> **▶ Status: BUILT ✅ (2026-08-01) — shipped behind a feature flag for staged rollout.**
> The full stack is implemented and tested: the off-chain decision engine (`lib/web2/router/` — fee math,
> best-execution comparator, listing registry, V4 quoter reader, orchestrator), the on-chain `MWRouter.sol`
> (+ `DeployMWRouter.s.sol`), and the live wiring — server meta-router `app/api/(web2)/swap/best-route`,
> client provider `lib/web2/providers/mwInternal.ts`, `useQuote` augmentation, the `useSwap` `'mw-internal'`
> execution branch, and `verifySwapTx` `MW_ROUTER_ADDRESSES` allowlisting so internal swaps credit rewards.
> **Verified:** Vitest 273/273, Forge 195/195 (14 for `MWRouter`, incl. the two-stream proof), changed files
> typecheck clean.
>
> It ships **inert by default** — with `NEXT_PUBLIC_MW_ROUTER_ENABLED` unset the swap flow is pure LI.FI, so
> the existing path is untouched. Turning it on for a chain is a normal rollout step: deploy a V4Quoter +
> `MWRouter`, seed a `router_pools` row, and set the flag + addresses. Turnkey checklist:
> `lib/web2/router/README.md`.
>
> **Implementation note:** the meta-router runs as a standalone engine invoked from the client quote path
> (`useQuote` → server `best-route`), not from the older `app/api/(web2)/swap/quote/route.ts` proxy, which is
> unused (the live LI.FI quote runs client-side in `lib/web2/providers/lifi.ts`). §3–§4 below describe the
> data flow; read "client `useQuote` → `best-route` → `resolveSwapRoute`" wherever a server proxy is mentioned.

This spec turns the **"Router"** primitive — named in the Phase-3 North Star and target diagram
([`phase3-two-surface-architecture.md`](phase3-two-surface-architecture.md) §1, §4, flagged 🔴 net-new in §3)
— from a placeholder into an actual design. It defines what the Router is, where it plugs into the
existing swap stack, how it preserves best execution, and how it differs across the DeFi and RWA surfaces.

---

## 1. Why (the gap it closes)

Today Mintware runs **two disconnected systems**:

| System | What it does | File(s) |
|---|---|---|
| **Swap widget** | Routes ~100% through LI.FI aggregation; monetizes via a 0.5% LI.FI *referrer* fee to treasury | `hooks/useQuote.ts`, `hooks/useSwap.ts`, `app/api/(web2)/swap/quote/route.ts` |
| **V4 vaults** | Hold real LP; `MWSocialHook.afterSwap` captures MEV/positive-slippage → `FeeVault` epoch distribution | `contracts-v4/src/{MWSocialHook,SocialVault,FeeVault}.sol` |

A user swaps a **listed asset** (one Mintware has a vault/pool for) inside our own app, and the order
flow leaves for 0x/1inch via LI.FI — **past our own liquidity**. We collect a thin referrer fee and hand
the spread + MEV to a third party. The vaults' fee-capture machinery (`captureRateBps`, `FeeVault`
buckets) only ever earns from *incidental* third-party flow that happens to hit those pools.

**The Router is the missing bridge.** It lets swaps on **listed assets** route against **Mintware's own
V4 pools** when we're price-competitive, and falls back to **LI.FI for everything else**. That converts
the vaults' capture mechanism from "hope flow arrives" into "we direct our own flow into it."

### Two things this is NOT
- **Not a better aggregator.** We don't out-breadth LI.FI. External/unlisted pairs stay on LI.FI, always.
- **Not forced internalization.** We never give the user a worse price to capture fees (see §6, best execution).

---

## 2. Locked principles

| # | Principle | Consequence |
|---|---|---|
| P1 | **Best execution is non-negotiable** | Route internally *only* when our quote ≥ the LI.FI quote (net of gas & fees). Always compare. Never a hidden markup. |
| P2 | **Internal-if-competitive, LI.FI otherwise** | The Router is a *meta-router*: get both quotes, return the winner. Unlisted pairs skip the internal quote entirely. |
| P3 | **RWA tradability is structural, not an optimization** | `vRWA` exists only in Mintware pools — there is no LI.FI route. For RWA, the Router is the *only* venue. |
| P4 | **Rewards + attribution must survive the new path** | `verifySwapTx` currently allowlists LI.FI routers and checks treasury-in-calldata. Internal-route txs go to `MWRouter`, so both checks must learn the new path (§7) or rewards silently break. |
| P5 | **KYC is never on the swap path** | Per Phase-3 locked decision, KYC is checked only at RWA redeem/dividend/governance — **never** at deposit/trade. RWA swaps through the Router stay permissionless; the OracleHook price-band is the only on-chain gate. |
| P6 | **Fail safe, fail to LI.FI** | Any internal-quote error, stale quote, or sim revert → transparently fall back to the LI.FI path. The Router never blocks a swap that LI.FI could serve. |

---

## 3. Architecture — two layers

The Router is **not one contract**. It's a quote-selection layer (off-chain) plus a thin execution
contract (on-chain) for the internal path only.

```
                         ┌─────────────────────────────────────────┐
   user picks pair  ──▶  │  Quote Router  (server: /api/swap/quote) │
                         │  ── is this pair "listed"? ──────────────│
                         │      yes → fetch BOTH in parallel:       │
                         │            • MW internal quote (V4 Quoter)│
                         │            • LI.FI quote (as today)       │
                         │      no  → LI.FI only                     │
                         │  ── return best (or both + winner flag)  │
                         └───────────────┬─────────────────────────┘
                                         │ Quote { provider: 'mw-internal' | 'lifi' | 'molten', ... }
                                         ▼
                         ┌─────────────────────────────────────────┐
   user clicks swap ──▶  │  Execution  (hooks/useSwap.ts branch)    │
                         │   'lifi'        → sign LI.FI _txReq       │  ← unchanged
                         │   'mw-internal' → call MWRouter on-chain  │  ← NEW
                         │   'molten'      → Algebra router          │  ← unchanged
                         └───────────────┬─────────────────────────┘
                                         ▼
                              MWRouter.sol (V4 PoolManager.unlock → swap → settle)
                                         │  routes through MW V4 pool + MWSocialHook
                                         ▼  LP fee + MEV capture → FeeVault (existing buckets)
```

**Layer A — Quote Router (off-chain, server-side).** Extends the existing `/api/swap/quote` proxy into a
meta-router. It already hides the LI.FI key and injects the referrer fee; we add: *if the pair is listed*,
fetch a MW-internal quote in parallel and return whichever is better for the user.

**Layer B — Execution.** Mirrors the existing `swapProvider` branch. `useSwap`/`useQuote` already fork
`'lifi'` vs `'molten'` on `chainConfig.swapProvider` — we add a **third provider `'mw-internal'`** selected
*per-quote* (not per-chain), plus a new `lib/web2/providers/mwRouter.ts` and an on-chain `MWRouter.sol`.

> **Design note — why per-quote, not per-chain.** `swapProvider` is a chain-level field today
> (`config/chains.ts`: `SwapProvider = 'lifi' | 'molten'`). Internal routing is *pair-level* (only listed
> assets), so the winning provider is decided by the Quote Router at quote time and carried on the
> `Quote` object, not read from chain config. `config/chains.ts` gains an optional
> `internalRouterAddress?` per chain; the *decision* lives in the quote response.

---

## 4. Layer A — Quote Router (server)

**File:** extend `app/api/(web2)/swap/quote/route.ts`.

### 4.1 Listing check
A pair is "listed" if Mintware has a live V4 pool for it. Source of truth: the factory registry
(Track 0 `MintwareVaultFactory`) mirrored into Supabase (`social_vaults` / vault index). The route does a
cheap lookup: `isListed(chainId, tokenIn, tokenOut)` → pool key + hook address, or `null`.

### 4.2 Parallel quote + selection
```ts
// pseudo — inside POST handler
const listed = await getListedPool(chainId, fromToken, toToken)  // → { poolKey, hook } | null

const [lifi, internal] = await Promise.all([
  fetchLifiQuote(lifiReq),                          // exactly as today
  listed ? quoteInternal(listed, fromAmount) : null // V4 Quoter — see 4.3
])

// Best execution: compare net-of-fee-and-gas buyAmount. LI.FI wins ties (proven path).
const best = pickBest({ lifi, internal })           // never returns a worse-for-user quote
return ctx.json({ ...best, alternatives: { lifi, internal } })  // client may show "also available via…"
```

`pickBest` compares **net output to the user**: `buyAmount − gasCostUSD − feeUSD`, where `feeUSD` on the
internal path includes the **Mintware router fee** (§7.4). The internal quote carries *no* LI.FI referrer
fee (that leaks to LI.FI) and no aggregator spread; its cost is the MW router fee + the pool's LP fee (the
`MWSocialHook.dynamicFee` override or pool default) + gas. At **fee parity** (router fee = the current 0.5%
the user already pays LI.FI), internal still frequently wins because it replaces the aggregator's own
spread/take with our own deep-pool price — so we capture the same 0.5% *and* the LP fee + MEV, while the
user is no worse off. Undercutting the 0.5% is a lever to *guarantee* internal wins and pass savings to the
user (§7.4).

### 4.3 Internal quote source
Price against the MW V4 pool without a live swap using the **V4 Quoter / StateView** read path
(`quoteExactInputSingle` on the periphery Quoter, or off-chain math from `StateView.getSlot0` + liquidity).
Must account for the hook's `beforeSwap` dynamic-fee override (`cfg.dynamicFee`) so the quoted price matches
what execution will actually charge. For RWA pools, the quote must also respect the OracleHook price band
(§5) — an internal quote that would land outside the band is returned as *unavailable*, not as a bad price.

### 4.4 Backward compatibility
When no internal pool exists (every pair today), the route behaves exactly as it does now — LI.FI only.
This makes Layer A shippable **before** any pools have real liquidity: it's a no-op until `getListedPool`
starts returning hits.

---

## 5. Surface differences — DeFi vs RWA

The Router is one mechanism, but the two surfaces route differently:

| | **DeFi surface** | **RWA surface** |
|---|---|---|
| Venue choice | Internal *if competitive*, else LI.FI (P2) | **Internal only** — `vRWA` has no external market (P3) |
| Price gate | Pool price / slippage cap | **OracleHook price band** (±15% core / ±45% spec) — swaps that would exit the band revert on-chain; the Quoter must pre-check so the UI shows "outside price band" not a failed tx |
| KYC | None | **None on the swap path** (P5) — KYC is redeem/dividend/governance only |
| Fee capture | LP fee + `afterSwap` MEV capture → `FeeVault` | Same FeeVault path; band-fee model per Track B is a separate decision |
| Fallback | LI.FI (P6) | **No LI.FI fallback exists** — if the internal quote is unavailable (outside band / paused), the swap is genuinely unavailable; surface that honestly |

The RWA column is why the Router is a **Track B prerequisite**, not a nice-to-have: without it, `vRWA`
positions can be *minted* (deposit) and *redeemed* (async, 30-day) but never *traded* on a secondary market.
The Router is the secondary market.

---

## 6. Best execution & safety (the part we cannot get wrong)

Internalizing order flow is exactly the move that, done carelessly, becomes hidden markup. Guardrails:

1. **Always compare, user-net.** `pickBest` uses output *after* gas and fees — **including the Mintware
   router fee** (§7.4), so our own cut can never make the internal route look better than it really is to
   the user. No internal route is ever returned when LI.FI is better. LI.FI wins ties.
2. **Slippage & price-impact caps on the internal path.** Reuse `estimatePriceImpact` (`useQuote.ts`);
   above the existing `highImpactWarning` threshold (2%) the internal quote is suppressed in favor of LI.FI
   (which may split across venues).
3. **Quote staleness.** Internal quotes carry a short TTL; the on-chain `MWRouter` swap sets
   `amountOutMinimum` from the quoted output minus slippage — a moved pool reverts rather than fills badly.
4. **Sim before send.** Keep the existing `publicClient.call` dry-run pattern (`useSwap.ts:72`) for the
   internal path too; a failing sim → fall back to LI.FI, don't error.
5. **Transparency.** The quote response includes `alternatives`, so the UI can show "Best route: Mintware
   pool — also available via LI.FI (−0.12%)". The user always sees they got the better of the two.
6. **Kill switch.** A server flag (`NEXT_PUBLIC_MW_ROUTER_ENABLED`) and a per-chain
   `internalRouterAddress` gate — unset → pure LI.FI behavior, instant rollback with no redeploy.

---

## 7. Rewards & attribution integration (do not skip)

The internal path changes `tx.to`, which silently breaks reward crediting unless we update the verifier.
Today `verifySwapTx` (`lib/rewards/swapHook.ts`):
- allowlists `tx.to` against `LIFI_ROUTERS` → else `skip_reason: 'router_mismatch'` (line 152);
- requires the treasury address in calldata → else `skip_reason: 'fee_not_paid'` (line 162–169).

Changes required:
1. **Allowlist `MWRouter`.** Add the deployed per-chain `MWRouter` address(es) to the router set (or a
   parallel `MW_ROUTERS` set) so internal swaps pass the `router_mismatch` gate.
2. **Re-interpret "fee paid" for internal routes → RESOLVED via the router fee.** Because we take an
   explicit router fee (§7.4), `MWRouter` transfers that fee to `MINTWARE_TREASURY_ADDRESS` **inside the
   swap tx** — so the treasury address provably appears in the transaction, and the *existing*
   treasury-in-calldata check passes unchanged. The fee cut and the "fee paid" proof are the **same
   mechanism**; no special-casing of `tx.to`, one verification path. `MWRouter` also carries the
   `campaignId` / `referrer` tags the reward + attribution flow already reads.
3. **Attribution / campaign tagging.** `MWRouter` should accept and log `campaignId` and `referrer`
   (mirroring the Molten provider's calldata-tail approach, `molten.ts:148`) so `/api/campaigns/swap-event`
   credits points on internal swaps exactly as it does for LI.FI swaps (`useSwap.ts:106`).

**Ship-blocker:** items 1–2 must land in the *same* change as the internal execution path, or the first
internal swap credits zero rewards.

### 7.4 Fee model — Mintware takes a cut on internal swaps (DECIDED)

**Decision:** internal swaps carry an explicit **Mintware router fee**, taken by `MWRouter` and sent to
`MINTWARE_TREASURY_ADDRESS`. This is *protocol revenue* — the internal-path equivalent of today's 0.5% LI.FI
referrer fee — and it is **separate** from the `FeeVault` buckets (which distribute LP/referrer/protocol/
attribution shares out of MEV capture + LP fees to *participants*). Two distinct value streams, both earned
on an internal swap:

| Stream | Taken by | Goes to | Analogue today |
|---|---|---|---|
| **Router fee** (`routerFeeBps`) | `MWRouter` | Treasury (protocol revenue) | The 0.5% LI.FI referrer fee |
| LP fee + MEV capture | `MWSocialHook` → `FeeVault` | LPs / referrers / protocol / attribution (epoch Merkle) | Already exists (`captureRateBps`) |

- **Default rate: 0.5% (`routerFeeBps = 50`), at parity with the current LI.FI referrer fee** (`LIFI_FEE
  = 0.005`, `chainConfig.feeBps = 50`). The user pays the same headline rate they already pay — we simply
  capture it instead of LI.FI, *and* additionally earn the LP fee + MEV that used to leak to the aggregator.
- **Governance-set, per surface.** `routerFeeBps` is an owner-settable param on `MWRouter` (bounded by a
  hard cap, e.g. ≤ 100 bps, so it can never be silently cranked). DeFi and RWA surfaces may carry different
  rates.
- **Taken from the output token** (like LI.FI's integrator fee): the user's `amountOut` is net of the fee,
  and `pickBest` (§4.2, §6) compares that net number — so taking a cut can never make internal *look*
  better than it is.
- **The "undercut" lever:** setting `routerFeeBps` *below* 0.5% makes internal reliably beat LI.FI on
  user-net price (we still profit on removed aggregator spread + LP/MEV), a deliberate tool to pull flow
  into our pools. Parity is the default; undercutting is a growth lever, not a giveaway.
- **Ties off §7.2:** because the fee lands at the treasury address on-chain, it doubles as the fee-paid
  proof for `verifySwapTx` — no separate tagging needed for that check.

---

## 8. On-chain `MWRouter.sol` (sketch)

Thin V4 entrypoint for the internal path only. Not an aggregator — it swaps against one MW pool.

```solidity
interface IMWRouter {
    struct ExactInputInternal {
        PoolKey  poolKey;          // MW V4 pool (with MWSocialHook)
        bool     zeroForOne;
        uint256  amountIn;
        uint256  amountOutMinimum; // best-execution floor from the quote
        address  recipient;
        uint256  deadline;
        bytes    tag;              // abi.encode(campaignId, referrer, treasuryTag) — see §7
    }

    /// @notice Swap exact input against a single Mintware V4 pool via PoolManager.unlock.
    ///         Skims `routerFeeBps` of the output to the treasury (§7.4), then delivers the
    ///         remainder to `recipient`. Reverts if the net output < amountOutMinimum
    ///         (stale/moved price) or, for RWA pools, if the OracleHook rejects the price (outside band).
    function swapExactInputInternal(ExactInputInternal calldata p)
        external payable returns (uint256 amountOut);   // net of routerFeeBps

    /// @notice Owner-settable protocol fee on internal swaps, bps of output. Default 50 (0.5%).
    ///         Hard-capped (e.g. ≤ 100 bps) so it can never be silently cranked. May differ per surface.
    function setRouterFeeBps(uint16 bps) external; // onlyOwner
}
```
- Implements the V4 `unlockCallback` (PoolManager.unlock → `swap` → settle/take), same pattern as the
  test helper `contracts-v4/test/helpers/TestSwapRouter.sol` (promote to production-grade).
- **Two fee streams, both on one swap (§7.4):** (1) the **router fee** — `MWRouter` skims `routerFeeBps` of
  the output to `MINTWARE_TREASURY_ADDRESS` (protocol revenue, *and* the fee-paid proof for `verifySwapTx`);
  (2) **passive capture** — the swap runs through `MWSocialHook`, whose `afterSwap` routes MEV/LP surplus to
  `FeeVault` (`captureRateBps`, `MEVCaptured` event) for epoch distribution to participants. The router fee
  is the only *new* fee logic; capture is unchanged.
- `amountOutMinimum` is checked against the output **net of the router fee**, so best-execution floors hold
  after our cut.
- `tag` carries the `campaignId` / `referrer` markers so `verifySwapTx` (§7) sees a campaign-tagged tx.
  Deployed per chain; address goes in `config/chains.ts.internalRouterAddress` + the reward allowlist.

---

## 9. Client changes (mirror the existing provider pattern)

The codebase already branches three ways cleanly; we extend the same seams:

| File | Change |
|---|---|
| `config/chains.ts` | `SwapProvider` gains `'mw-internal'`; add optional `internalRouterAddress?: string` per chain |
| `lib/web2/providers/mwRouter.ts` | **New** — `getQuote()` (calls V4 Quoter path) + `executeSwap()` (calls `MWRouter.swapExactInputInternal`), same shape as `molten.ts` |
| `hooks/useQuote.ts` | Quote comes from the server meta-router; carry `quote.provider`. Internal quotes get real price impact (unlike LI.FI's `price:'0'`) |
| `hooks/useSwap.ts` | Add a `'mw-internal'` branch alongside `'lifi'`/`'molten'` (line 69–95); keep the sim dry-run; keep the fire-and-forget `swap-event` credit (line 106) — now works because §7 |
| `components/…/SwapWidget.tsx` | Route label reads the winning provider ("Best route: Mintware pool"); show `alternatives` delta for transparency (§6.5) |

No change to the reward hot path *shape* — only the allowlist/verification content (§7).

---

## 10. Rollout (both layers are built — this is enablement, not a build plan)

The engine (Layer A) and the on-chain execution + wiring (Layer B) are both implemented and tested and
ship together behind the feature flag. Enablement is per chain:

```
Router (built, flag-gated inert)
   │  enable per chain, once that chain has an MW pool with real depth:
   ├─ deploy V4Quoter + MWRouter (DeployMWRouter.s.sol)
   ├─ seed a router_pools row for the pool
   └─ set NEXT_PUBLIC_MW_ROUTER_ENABLED=true + router/quoter addresses
         │
         ├─ DeFi routing → live for that pool
         └─ RWA routing  → live once MintwareRWAVault4626 + OracleHook back the pool
```

- **Engine + wiring:** server meta-router (`app/api/(web2)/swap/best-route`) invoked from `useQuote`,
  `MWRouter.sol` execution via the `'mw-internal'` branch in `useSwap`, reward crediting via the
  `verifySwapTx` allowlist (§7). All gated by `NEXT_PUBLIC_MW_ROUTER_ENABLED` + per-chain addresses.
- **RWA routing:** activates when `MintwareRWAVault4626` + `MintwareOracleHook` back a listed pool — the
  path that makes `vRWA` tradable.

**Enable a chain only once its MW pool has real depth** — until then the router correctly falls through to
LI.FI, so there is nothing to gain (and nothing lost) by leaving the flag off.

---

## 11. Open questions

1. **V4 Quoter vs off-chain math** for the internal quote — periphery Quoter (accurate, an extra RPC) vs
   `StateView.getSlot0` + local math (faster, must replicate hook fee override exactly)?
2. ~~**Fee-paid verification (§7.2)**~~ **RESOLVED** — the router fee (§7.4) lands at the treasury address
   on-chain, so the existing treasury-in-calldata check passes unchanged. Single verification path.
3. **Multi-pool internal splitting** — v1 is single-pool. Do we ever split a large order across an MW pool
   *and* LI.FI? (Defer — genuine SOR complexity; not needed until pool depth justifies it.)
4. ~~**Monetization on internal swaps**~~ **RESOLVED** — explicit `routerFeeBps` to treasury, default 0.5%
   at parity with the current LI.FI referrer fee, governance-set + hard-capped, separate from the `FeeVault`
   participant buckets (§7.4). We take a cut *and* keep the LP/MEV capture.
5. **RWA "outside band" UX** — when the OracleHook would reject, is the swap disabled, or do we offer the
   async redeem path as the alternative exit?

---

## 12. TL;DR

The Router closes the gap between our swap widget (all LI.FI) and our V4 pools (idle fee-capture machinery).
It's a **meta-router**: compare an internal quote against LI.FI on listed pairs, take the better one for the
user, fall back to LI.FI otherwise. On internal swaps **Mintware takes an explicit router fee** (default
0.5%, at parity with today's LI.FI referrer cut — §7.4) that goes to treasury, *and* keeps the LP fee + MEV
capture that used to leak to the aggregator; the fee transfer doubles as the on-chain "fee paid" proof for
rewards. For DeFi it's fee-capture + a liquidity flywheel; for RWA it's the *only* secondary market and
therefore the secondary market that makes `vRWA` tradable. The hard parts — **best execution** (never a
worse price, our cut included in the comparison — §6) and **reward integrity** (`verifySwapTx` recognizes
the `MWRouter` path — §7) — are built and tested. It's shipped behind a flag; enable it per chain once a
pool has real depth.

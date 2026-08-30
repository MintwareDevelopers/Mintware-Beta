# Treasury Mesh v1 — Stress-Tested Execution (v0.1)

> **Supersedes the *build order* (not the vision) of** [`treasury-mesh-shared-liquidity-spec.md`](./treasury-mesh-shared-liquidity-spec.md)
> **+** [`treasury-mesh-build-spec.md`](./treasury-mesh-build-spec.md). Those two design the mesh **JIT-allocator-first** —
> the highest-revenue *endgame*, but built on the exact custom-hook surface aggregators under-route, and the
> biggest new audit surface. A 9-agent adversarial stress-test (routability · safety · reuse · economics ·
> red-team · + a 4-agent solution search) found that ordering backwards for *revenue*. This doc records the
> corrected, revenue-bearing v1 and the honest scope. Design only; testnet + audit + securities-counsel gate real value.

## 0. The dilemma the stress-test surfaced

Revenue = volume × fee × take, and **volume is decided by routing.** But:
- **Custom v4 hooks are under-routed.** Uniswap's allowlist is *allowlist-by-default* — but it gates/rejects
  **delta-return / custom-accounting / upgradable / custom-data** hooks, which is exactly Mintware's JIT +
  am-AMM class (the deployed coordinator advertises the `beforeSwapReturnDelta` bit `0xAC8` — the routability tax).
  The Uniswap Foundation *pays* routers to route hooked pools, structural proof they're under-routed.
- **Plain standing LP loses to LVR** on volatile pairs. LVR ≈ σ²/8; ~50% of Uniswap-v3 LPs lose after IL.
  The fee tier that *wins the route* (tight) can't cover LVR; the tier that *covers* LVR loses the route.
  JIT was never about "efficiency" — its value was **selective exposure** (dodging the toxic ~25% of flow).

So: **routable-but-bleeds vs. efficient-but-unrouted.** The escape must get *flow* without eating LVR.

## 1. The resolution (three converging unlocks)

1. **Own the flow — it's a flow business, not a liquidity business.** LP losses concentrate in the **top 25%**
   of swaps (arbitrageurs); the **bottom 75% (benign/retail) is net-profitable for LPs** — measured PnL of
   Uniswap itself. Solana's proprietary AMMs (SolFi/ZeroFi) capture 60%+ of a $1.5B/day pair by *renting
   Jupiter's clean flow* while owning ~none of it. **Mintware owns *both* halves** — treasury capital (the
   funding rail) *and* the flow originator (the app + meta-router). Owned benign flow → standing LP is
   net-positive where open-market (toxic-heavy) flow would bleed. **Flow is the gating input, not capital.**
2. **Be the route (later phases) — solver / RFQ, not a pool.** An RFQ signed quote *is* the route (UniswapX,
   CoW, 1inch Fusion, Hashflow route to fillers first-class — no hook, no allowlist). Selective filling = JIT's
   "skip the toxic flow" by construction. **`edge-auth` is already a signed-quote engine** ("decide → reserve a
   hold off live NAV → sign, ~10ms, fail-closed" ≡ "receive RFQ → decide → sign quote") — the single biggest
   reuse. This *transmutes* passive-LP LVR into active-MM adverse selection + winner's curse, a win only for
   **hedgeable** pairs (cold long-tail is warehousing risk → junior-only, small).
3. **Recapture LVR as a routable *fee*, not a gated *delta*.** `MWDynamicFee` (dynamic/surge + directional
   Diamond-LVR `lvrSurchargePips`) is expressed as a **fee override** — the routable half — separable from the
   JIT/am-AMM delta branches. >80% LVR reduction on deep pairs; the directional surcharge taxes only the arb
   swap, not benign flow. (Honest limit: fees *reduce*, never *eliminate* LVR, and only suffice on deep/low-vol
   pairs.)

## 2. The non-negotiable safety invariant (from red-team + safety tracks)

**The LP position counts for yield/liquidity — NEVER for spendable senior principal.** The LP's marked value
is soft on three axes at once (manipulable spot mark hook-free, continuous LVR bleed, exit slippage), so:

> **Spendable senior = idle-in-Aave/Morpho + stable-USDC junior buffer, only.**

This needs **no new accounting** — it's a parameter+gate choice over shipping seams:
- Set **`minCoverageBps = 10_000`** → `_coverageOkAfter` requires `juniorUsdcBuffer ≥ deployedFromSenior` (every
  deployed senior dollar fully backed by the stable USDC buffer; the LP leg is entirely junior-collateralized).
- **Gate every spend on `idleBuffer()`** (`MintwareTreasuryVault.sol:638` — idle + Aave-returnable, "without
  touching the LP"), never on `totalSeniorAssets()`. This is what edge-auth's LIQUIDITY gate already reduces to.
- `deployToLP`'s existing idle-first + never-touch-junior + never-unwind-LP guards (`:788-803`) enforce the rest.

Also carried from the stress-test: the hook's *one* load-bearing safety role hook-free is the **redeem-tail
mark** (`recoverableUSDC()` falls back to manipulable spot without the truncated in-pool oracle). v1 sidesteps it
by (a) curating to pairs with a real independent feed and (b) never letting the LP back spendable senior anyway.

## 3. v1 architecture — "own-flow + curated low-vol LP + routable fee hook"

**Routable, LVR-safe, senior-safe, ~90% existing code, one small new contract (by *subtraction*).**

1. **Curated pool set = low-vol / pegged only** (USDC/USDT, USDC/DAI, ETH/wstETH, cbBTC/wBTC). LVR is
   structurally small → standing LP doesn't bleed; excludes the adverse-selection + oracle-manipulation surfaces
   by construction. (`.claude/rules/pool_tiering` Tier A; spec §5 curation.)
2. **Standing LP supplied by the treasury vault** via the existing `deployToLP` (`MintwareTreasuryVault.sol:782`)
   with `minCoverageBps = 10_000` (senior idle+junior-backed only). No JIT, no allocator.
3. **`MWFeeHook` (`0xC0`) — a routable fee-only hook, built by SUBTRACTION** from `MWHookCoordinator`: keep the
   pure libraries `MWDynamicFee` + `MWOracleGuard`, drop the JIT + am-AMM branches, declare only
   `{beforeSwap(7), afterSwap(6)}` (address `0xC0`, **no `beforeSwapReturnDelta`**), fee-override in `beforeSwap`
   + oracle fold in `afterSwap`. Deterministic-output-given-fee ⇒ routable + far smaller audit surface. Re-mine a
   `0xC0` CREATE2 salt (`lib/HookMiner.sol`). **Optionally list some pools hookless (static fee) for max
   aggregator reach; the hook is an optional recapture upgrade, never the flow dependency.**
4. **Flow via the meta-router** (`lib/web2/router/*`, already built inert behind `NEXT_PUBLIC_MW_ROUTER_ENABLED`):
   `resolveSwapRoute` internalizes owned MW-app swaps into these pools when they beat LI.FI net of gas;
   `internalize.ts` already filters toxic/oversized flow (`toxic-flow`/`size-over-cap`) *before* a pool is touched.
   External flow arrives opportunistically for the hookless/simple-fee pools aggregators *will* route.
5. **Two un-gated revenue lines from day one:** the **router fee skim** (`routerFeeBps`) on internalized swaps
   **+ LP trading fees (+ LVR recapture)** on treasury-supplied depth. Neither depends on a hostile aggregator
   routing a custom hook.

## 4. Phasing (inverted from the original build spec — this is the correction)

- **Phase 0 — Owned-flow + curated low-vol LP (ships first; routable + profitable + honest).** List 3–5
  pegged/low-vol pairs in the router registry; deploy the router addresses; fund standing LP via `deployToLP`
  with `minCoverageBps=10_000`; spend gated on `idleBuffer()`; `NEXT_PUBLIC_MW_ROUTER_ENABLED=true` for owned app
  swaps. Revenue = router skim + LP fees. **No new contract** (hookless static-fee pools). Senior invariant holds
  by construction. Testnet → mainnet after audit of the small surface.
- **Phase 1 — `MWFeeHook` (`0xC0`).** The routable fee-only hook by subtraction. Forge invariants: fee-override
  determinism, oracle non-manipulability (reuse the MEV-engine 7/7 suite scoped to the fee path), routability
  (static-sim a swap ⇒ no delta). A/B hook vs hookless per pool; keep the hook only where recapture > routability cost.
- **Phase 2 — Vault-as-counterparty fill / in-house solver.** Build the on-chain fill behind `internalize.ts`'s
  existing decision layer (flash-source the out asset, `amountOutMinimum` floor, record inventory delta) and/or
  register the treasury as an **RFQ signed-quote source** reusing `edge-auth` as the quote-signer. Unlocks spread
  capture + being-the-route without a hook. Scope to **hedgeable** pairs; warehouse risk on junior only. Build the
  pricing/hedging brain **or delegate to a real market maker as the vault's strategy operator** (Arrakis-Pro model).
- **Phase 3 — Treasury Mesh proper (the original spec).** `MintwareLiquidityAllocator` + cross-team JIT-funded
  liquidity + the Rust Allocation Service. Now genuinely gated on (a) owning enough benign flow that a JIT hook's
  under-routing is tolerable / mostly-internal, (b) external audit of the cross-vault credit window (spec §8.6), and
  (c) securities counsel on the tranche (spec §7). The existing build-spec's Phases 0–3 become *this* project's Phase 3+.

## 5. Honest scope

**v1 CAN:** earn a real fee take today from two un-gated lines (router skim + treasury LP fees) on curated
low-vol pairs; keep spendable senior backed by idle+stable only (stricter than shipping YPN, using existing
seams); ship a routable fee hook by *deleting* branches from an already-tested coordinator; mitigate LVR by pair
selection + directional surcharge; flag/env-gated off with zero change to existing flows.

**v1 CANNOT / does NOT:** route custom JIT-hook pools through external aggregators (deferred — the gated surface);
do cross-team shared liquidity / the allocator mesh (Phase 3, audit+scale-gated); run the vault-as-counterparty
filler (Phase 2, contract unbuilt); support volatile/meme/thin standing LP (excluded by curation; needs the
solver-with-hedge in Phase 2 for *liquid* tokens or the JIT allocator in Phase 3); or present anything as live with
real value — testnet + unaudited until external smart-contract audit + securities-counsel sign-off.

**The one honest caveat to carry in copy:** even the stripped `0xC0` fee hook is *still a custom hook* — some
aggregators default-skip any hooked pool. So v1 leans on **owned flow first** (router-internalized, needs no
aggregator) and offers a **hookless static-fee variant** of each pool for external reach.

## 6. The strategic truth this produced

> **Mintware isn't a pool that needs routing. It's a flow-owner that deploys tranched, spendable treasury
> capital into the liquidity its own flow makes profitable — and grows into being *the route* (a solver) as it
> owns more flow.** The scarce, gating input is *benign orderflow* (the app), not capital or cleverness — and
> Mintware is one of the few positioned to own both the capital rail *and* the flow originator.

## 7. Immediate first step (if/when greenlit)

The foundation for all of it is the **universal spend rule** (`spendableForParty` — route every spend through
edge-auth per-payer; the treasury-spend track's `#2a`), because v1's senior invariant *is* "spend gated on
`idleBuffer()`." Land that + the `minCoverageBps=10_000` posture, list the first curated pegged pair, and turn on
the meta-router for owned flow — that's a revenue-bearing, honest, mostly-built Phase 0 on Base Sepolia.

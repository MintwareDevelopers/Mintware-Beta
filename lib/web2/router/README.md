# MW Meta-Router (`lib/web2/router`)

Best-execution swap routing: compare an **internal** quote (a Mintware V4 pool) against
**LI.FI** on listed pairs, take whichever is better for the user, fall back to LI.FI otherwise.

Full design: [`docs/developers/phase3-router-design.md`](../../../docs/developers/phase3-router-design.md).

## What this module is

The **off-chain decision brain**. Pure, dependency-injected, fully tested (62 tests). It decides
*which venue wins*; it does not execute swaps.

```
resolveSwapRoute()                 ← orchestrator (index.ts)
  ├─ isRouterEnabled()             ← kill switch (config.ts)
  ├─ getListedPool()               ← is the pair on a MW pool? (listing.ts)
  ├─ quoteInternalPool()           ← price the pool, skim router fee (internalQuote.ts + fee.ts)
  └─ pickBest()                    ← SAFETY-CRITICAL comparator (pickBest.ts)
```

## Status — Slice 1 (this module): COMPLETE ✅

Built + tested: fee math, best-execution comparator, listing seam, internal-quote normalization,
orchestrator, LI.FI adapter. **Inert by default** — the live LI.FI swap path is untouched:

- `NEXT_PUBLIC_MW_ROUTER_ENABLED` is unset → `resolveSwapRoute` returns LI.FI immediately.
- The pool registry is empty (`EMPTY_REGISTRY`) and there is no on-chain reader → even if the flag
  were on today, every pair resolves to LI.FI.

## Status — Slice 2 (make it live): CODE-COMPLETE ✅ (pending deploy)

All four pieces are built, tested where testable, and **flag-gated inert** until deployed:

1. **`MWRouter.sol`** — ✅ `contracts-v4/src/MWRouter.sol` + `MWRouter.t.sol` (14 forge tests, suite 195/195).
   V4 exact-input swap + router-fee skim to treasury; `amountOutMinimum` net of hook capture AND router fee;
   deadline, distinct recipient, attribution `tag`; owner-settable fee capped 100 bps. Proven to coexist
   with the hook's MEV capture on one swap. Deploy: `contracts-v4/script/DeployMWRouter.s.sol`.
2. **`QuoterReader`** — ✅ `quoterReader.ts` — reads the vendored V4Quoter via viem `simulateContract`
   (injectable call → unit-tested). `createQuoterReader` + `viemQuoteSimulate` + `deriveBuyTokenPriceUsd`.
3. **`PoolRegistry`** — ✅ `listing.ts` `registryFromFetcher` over a `router_pools` Supabase table
   (migration `20260801000001_router_pools.sql`). Empty today → LI.FI.
4. **Wiring** — ✅ server route `app/api/(web2)/swap/best-route/route.ts` (registry + quoter + `resolveSwapRoute`),
   client provider `lib/web2/providers/mwInternal.ts` (`fetchBestRoute` + `executeSwap`), `useQuote` augments
   the LI.FI quote (flag-gated, best-effort), `useSwap` gained a `'mw-internal'` branch, and `verifySwapTx`
   allowlists `MW_ROUTER_ADDRESSES` (the router-fee transfer to treasury is the fee-paid proof).

### Activation (deploy — the operational step, needs keys)

1. Deploy a **V4Quoter** on the chain (canonical Uniswap deploy, or `v4-periphery` lens) → note the address.
2. `forge script contracts-v4/script/DeployMWRouter.s.sol --rpc-url base_sepolia --broadcast --verify`
   (env: `POOL_MANAGER`, `MW_ROUTER_TREASURY`, optional `MW_ROUTER_FEE_BPS`/`MW_ROUTER_OWNER`).
3. Apply the `router_pools` migration; insert a row for a live MW pool (chain, router, hooks, currencies,
   fee, tickSpacing).
4. Set app env: `NEXT_PUBLIC_MW_ROUTER_ENABLED=true`, `MW_ROUTER_ADDRESS_BASE[_SEPOLIA]`,
   `MW_V4_QUOTER_BASE[_SEPOLIA]`, `MW_ROUTER_ADDRESSES=<router>` (reward verification), and the chain RPC.
5. Verify: a listed-pair quote now returns `winner: 'mw-internal'` when the pool beats LI.FI; the swap
   executes via `MWRouter`; the reward credits (tx.to = MWRouter passes `verifySwapTx`).

## The one invariant that must never break

`pickBest` (see its header comment): **never** return `mw-internal` unless it is *strictly* better
for the user, measured gas-inclusive in USD. LI.FI wins every tie and wins whenever we cannot prove
internal is better. Our own router fee is already inside the internal quote's `buyAmount`, so taking
a cut can never make internal look better than it truly is. If you touch that file, keep the tests
green — they are the contract.

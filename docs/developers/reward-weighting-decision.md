# Decision record — reward weighting & referrals for the pair vaults

**Status: design APPROVED; canonical migration DEFERRED to its own scoped session.**
**Date: 2026-08-06.**

## The problem

Both new pair vaults (`MintwareDeFiPairVault`, `MintwareMatchedLiquidityVault`) distribute swap
fees **pro-rata to deposit size** via an on-chain per-share accumulator. They are **not
reputation-weighted and not referral-weighted** — a cold whale out-earns a small, high-Attribution,
long-locked LP on the identical pool. That is the opposite of the Mintware thesis. The single-sided
`DeFiVault4626` *is* reputation-weighted, because it routes fees to `FeeVault` (Attribution + lock
weighted, 70/15/10/5, off-chain merkle). The pair vaults bypass that because `FeeVault` is USDC-only
and pairs earn fees in two arbitrary tokens.

## Design — APPROVED (not the timing)

Referral is **a weight dimension, not a separate carve-out**. One formula:

```
LP fee weight = liquidity-time × attribution_mult × lock_mult × referral_mult
```

- **Funded from Mintware's margin, never the LP pool.** Being referred must not tax the LP — the
  protocol pays for growth out of its own cut. (Improves on the old FeeVault model, which took the
  referrer share from the depositor pool.)
- **Double-sided**: referred LP gets a `referee_boost`; referrer earns from their referred LPs.
- **Lifetime**: the referrer earns while the referred LP stays an LP, quality-weighted by the
  referred LP's Attribution (bring one real high-score LP > 100 sybils; anti-farm by construction).

## DEFERRED — its own scoped session (do NOT do inline)

The **full design requires attribution weighting, which is off-chain data**, which forces a
**two-token oracle-signed epoch → merkle distributor** (generalizing `FeeVault`/`MintwareDistributor`
off USDC-only) and **replacing the pair vaults' on-chain accumulators**. This is a deliberate
resolution of the *"two fee-distribution models"* architecture fork — not a referral feature.
Prerequisites before it is canonical:

1. **Fresh fuzzing budgeted.** The matched vault's 256×128k invariant suite tests the *current*
   on-chain fee-redirection logic (team 0% during lock, community 100%). Swapping the mechanism
   invalidates that coverage — a second invariant pass must be part of the deliverable.
2. **Oracle failure-mode + emergency lever.** A signed weight snapshot is a new privileged
   dependency: what happens the epoch the oracle misses / is compromised / censors an LP's weight?
   Needs a Stage-1-style answer (guardian/fallback/claim-without-snapshot) BEFORE it ships.
3. **Scoped & separately reviewed**, like parking the DeFiVault→pair-vault generalization — not
   merged as a side-effect of a feature ask.

## INTERIM — optional, on-chain-only (delivers the wins without the oracle)

Ships the referral wins using **only on-chain-knowable inputs**, keeping the accumulator model:

- **Referral relationship on-chain**: `referrerOf[lp]` set at deposit.
- **Double-sided, from margin**: referred LPs get a `referee_boost`; referrers accrue a lifetime
  reward proportional to their referred LPs' liquidity — both funded from the Mintware cut, so no LP
  is diluted.
- **Lock-tier weighting** (on-chain): longer locks earn more.
- **Attribution weighting: NOT included** — that is precisely the piece that forces the oracle
  dependency, and is deferred to the migration above.
- ⚠ Still modifies the fee accumulator (money-path) → **requires its own fresh invariant fuzz pass**;
  it is smaller than the migration and adds no new trust dependency, but it is not free.

## Operating note

Every feature request from here gets the up-front question: **"is this actually scoped, or is this
the next architecture fork?"** — because tonight, twice, "add one feature" surfaced "this touches the
foundation" underneath it.

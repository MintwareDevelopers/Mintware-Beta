# am-AMM for the Mintware V4 Hook + Pair Vault — Design & Staged Build

**Status:** Stages 1, 2, 3, and the custody-level of Stage 4 shipped. The auction now functions
on swaps (manager sets + receives the fee; LP fee zeroed on managed swaps). Remaining: the
swap-path invariants (fuzz the skim) + external audit.

## Stage 3 skim — verified V4 delta accounting (implemented)

`MWHookCoordinator` is now `HOOK_FLAGS 0xAC8` (`beforeSwapReturnDelta`). For an enrolled+managed pool,
`beforeSwap`: `auction.poke(id)` → override LP fee to 0 → take the manager fee on the SPECIFIED
(exact-input) currency straight to the auction via `POOL_MANAGER.take(spec, auction, fee)` →
`recordManagerFee` → return `toBeforeSwapDelta(+fee, 0)`. The `+fee` (booked in afterSwap) and the
`-fee` (from `take`) cancel, so the hook nets ZERO across the unlock → the swap settles; the trader
covers the fee. **v1 is exact-input only** — managed exact-output reverts `ExactOutputNotSupported`
(per-pool `allowExactOutput`, default false) to close a fee-avoidance hole. Wiring: `coord.setAuction`
+ `auction.setCoordinator` + `coord.setAmAmmEnabled(id,true)` + `auction.configurePool(id,...)` — and
per F-D, enroll a pool ONLY once the auction is configured. Proof: `MWHookCoordinatorAmAmm.t.sol`
(fee reaches the auction both directions, swap settles, unmanaged = no skim, manager claims).
**Goal:** Spec item **2.2** — the auction-managed AMM that makes the hook *competitively*
"better than Bunni", not just securely so. Money-critical: **not for real value until externally audited.**

## Mechanism (am-AMM)

Sources: [paper arXiv:2403.03367](https://arxiv.org/abs/2403.03367), [Bunniapp/biddog reference](https://github.com/Bunniapp/biddog).

The right to **manage** a pool (set its swap fee, receive its swap fees) is sold via a continuous
Harberger-lease auction. The manager pays **rent per block**; **rent compensates LPs** (LPs get rent,
not fees). Because the manager captures the fees, they internalize the LVR / uninformed-flow tradeoff
and price the fee optimally; the auction competes that surplus back to LPs as rent.

- Two slots per pool: `topBid` (active manager) + `nextBid` (challenger).
- A new bid must beat the standing bid by `MIN_BID_MULTIPLIER` (1.1×).
- **K-block notice:** a challenger can't become manager for `K` blocks, so LPs can react to a new
  rent/manager before it takes effect.
- A bid's deposit must prepay `K` blocks of rent (`deposit >= rent*K`) and be an exact multiple of
  rent; a manager whose deposit depletes is evicted.
- Fee is capped at `f_max` (per asset class); manager reads zero-fee for their own swaps.

## Repo grounding (what constrains us)

- Canonical hook `MWHookCoordinator` (`HOOK_FLAGS 0xAC0`) already returns a delta-shaped
  `beforeSwap`/`afterSwap` and sets a fee override from `MWDynamicFee` — that's the seam.
- The pool's **sole LP is `MintwareDeFiPairVault`** → exactly one LP position to compensate with rent
  (huge simplification vs. generic am-AMM). Rent folds into the vault's existing
  `accFee0/1PerShare` accumulator via a new `fundRent()` entrypoint — LPs claim rent the same way
  they claim fees. **Not** through `FeeVault` (USDC-only, legacy path).
- Restricted to **BLUE_CHIP** pools; gated by an explicit owner-set `amParams.enabled`.

## Key decisions (locked)

1. **Faithful fidelity over zero-friction.** True am-AMM needs the manager to *receive* the swap fee
   and the LP to not. On V4 that means skimming a `beforeSwap` delta → requires
   `BEFORE_SWAP_RETURNS_DELTA` → **`HOOK_FLAGS 0xAC0 → 0xAC8` → new hook address → CREATE2 re-mine +
   redeploy + rewire factory/registry + re-init the pool.** This is a hard fork of the hook, accepted
   for a canonical, money-critical build. (A reduced-fidelity "settle at `_realizeFees` time" variant
   keeps `0xAC0` if the re-mine is ever operationally blocked.)
2. **am-AMM *replaces* `MWDynamicFee` for enrolled pools** (they don't compose — stacking would
   double-charge and fight the auction's price discovery). `MWOracleGuard` circuit breaker stays
   **on** (manipulation defense is orthogonal).
3. **Bid/rent token = a pool token** (so rent folds into the per-share accumulator directly).
4. **Composed stateful module, not a second hook** — `MWAmAuction.sol` holds auction state + custody;
   the coordinator holds an immutable reference and drives it from the swap path. Keeps the
   money-custody surface isolated and independently auditable.

## Staged build

- **Stage 1 — pure core (SHIPPED).** `MWAmAuctionLib.sol` — rent accrual + depletion, the 1.1×
  out-bid rule, K-block reserve + notice, bid validity, safe withdrawal, effective-fee clamp — all
  pure, zero custody. `MWAmAuctionLib.t.sol` — 36 boundary tests. This is the correctness heart.
- **Stage 2 — stateful contract (SHIPPED).** `MWAmAuction.sol`: per-pool `topBid`/`nextBid`, bid-token
  custody, `bid`/`depositIntoBid`/`withdrawFromBid`/`claim` (all `nonReentrant`, pull-payment ledger
  for third-party refunds + manager fees), and coordinator-only `poke()` (charge rent → push to the
  LP rent-sink → evict/promote) + `recordManagerFee()`. 18 integration tests. Rent is PUSHED to an
  `IAmAmmRentSink` (the pair vault's future `fundRent`).
- **Stage 3 — hook fork + wire (PENDING).** New `HOOK_FLAGS 0xAC8`; `beforeSwap` branch for enrolled
  pools (override LP fee to 0, skim the manager fee as a delta, credit the manager); `configurePool`
  gains `AmParams`; `MintwareDeFiPairVault.fundRent()`; re-mine + redeploy + rewire.
- **Stage 4 — invariant fuzzing.** Custody-level SHIPPED (`MWAmAuctionInvariant.t.sol`, ~128k calls):
  **solvency** (balance == escrows + unclaimed ledger), **continuity reserve** (manager deposit always
  an exact multiple of rent), **fee ≤ cap**. Fuzzing already caught + fixed two real bugs (challenger
  non-multiple withdrawal → dust after promotion; `recordManagerFee` stranding funds with no manager).
  **Pending (needs Stage 3):** swap-path invariants — no free swaps, end-to-end LP-rent conservation,
  handover attribution. **Then external audit before any real value.**

## Self-audit (2026-08-08) — findings + disposition

Three adversarial reviews (custody, economics, vault-integration). The fuzzed core held
(solvency, overflow, evict/promote), but real defects surfaced beyond the fuzzer's mocks.

**FIXED (with regression tests):**
- **Reentrancy/CEI on `poke`** — `poke` was missing `nonReentrant`, and `lastCharged` was
  written *after* the external rent push. Added the guard + moved the effect before the call;
  a hostile reentering sink now trips the guard (`test_poke_reentrant_sink_is_blocked`).
- **Under-reserved challenger** — the challenger withdraw branch checked only the multiple, not
  the K reserve, so a challenger could be promoted with ~1 block of runway. Both branches now use
  `canWithdraw` (full exit OR meetsReserve).
- **`bidToken` swap footgun** — `configurePool` now locks `bidToken` once set.
- **Manager squatting own challenger** — `bid` reverts `AlreadyManaging` if the caller holds the top slot.
- **`fundRent` fee-on-transfer over-credit** — now balance-diff intake (credit what arrived), plus
  a carried dust remainder so sub-threshold rent is never stranded, `whenNotPaused`, and
  caller-restricted to an owner-set `rentFunder` (the auction).
- Config: reject `minBidMultBps <= 10_000` (1.0x churn) and `defaultFeePips > feeMaxPips`; reset the
  rent approval to 0 after the sink call.

**FLAGGED — now RESEARCHED + RESOLVED (see `am-amm-flagged-decisions.md`):** F-B squatting fixed
(BidDog parity: no free cancel + promotable-only occupancy); rebalance-absorbs-reserves fixed
(segregated `feeReserve`); F-D is an operational gate (don't `setEnabled` pre-Stage-3); lower items
are conscious keeps. Original flag text below for reference:
- **`nextBid` squatting (F-B)** — the single challenger slot pays no rent and can be cheaply
  re-placed (epoch reset), letting an adversary gate entry / inflate the real-challenger bar to
  mult². Mitigation is a *mechanism* choice (griefing bond, min bid lifetime, or multiple
  challengers) — deferred to a considered design pass, not a rushed patch.
- **Rent-only until the hook lands (F-D)** — `recordManagerFee` exists but the coordinator doesn't
  yet call `poke`/`recordManagerFee` (Stage 3). Until then managing is value-negative → **do NOT
  `setEnabled(true)` on a pool before the Stage-3 hook wiring lands atomically.**
- **`rebalanceToProfile` absorbs unclaimed fee/rent reserves (pre-existing)** — the accumulator
  backs claims from raw balance, which `_rebalance` sweeps into the position. Affects swap fees too;
  proper fix is a segregated `feeReserve0/1`. Larger change, recommended before mainnet.
- `withdrawFeeBps` is reserved (anti-exit-race, Stage 3); manager fee is immutable per bid
  (LP-protective simplification); `weightedDistributor` holds a max approval (owner-set trust).

## Security invariants (the fuzz targets)

rent monotonic-drain & no free management block · `deposit/rent >= K` always (withdraw can't break it)
· applied fee always `<= feeMaxPips` · every enrolled swap charges LP-fee-or-manager-skim (no free
swaps) · manager can't grief (fee in `[0,cap]`, can't block swaps, can't re-enter) · every active
block funds rent to the vault (`Σ rent funded == Σ deposit drained`) · displaced bids refunded exactly
once · manager fees attributed to who was active at skim time · only owner enables, blue-chip only.

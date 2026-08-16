# YPN MEV Capture Engine — Build Plan

_Concrete build plan for capturing the MEV/slippage that leaks to bots on YPN's pools. Synthesizes a
2026-08-15 research pass (build-vs-reuse code audit + am-AMM/MEV-tax + dynamic-fee/LVR deep-dives) with the
existing design docs. **Builds on — does not replace** [`ypn-mev-strategy-spec.md`](ypn-mev-strategy-spec.md)
(the mechanism ranking + the "Level 2–3 levers" framing), [`am-amm-design.md`](am-amm-design.md) /
[`am-amm-flagged-decisions.md`](am-amm-flagged-decisions.md) (the auction engine), and
[`ulv-jit-lever-b-spec.md`](ulv-jit-lever-b-spec.md) (**Lever B** = size-gated true JIT — the existing
lever spec, its hook↔vault mid-swap bridge, and the invariants bar every money-path change must clear).
Plan only — nothing built yet._

## Lever framing + the non-negotiable bar (from `ulv-jit-lever-b-spec.md`)
The engine is a set of **levers** on the one hook, not a new hook family (`#254`). The already-specced
**Lever B (size-gated true JIT)** sets the standard the new levers below inherit — this is "the exact Bunni
v2 ($8.4M) surface", so every money-path change is held to it:
- **Invariants written FIRST, fuzzed at 256×128k with 0 reverts**, exercising REAL swaps through the harness
  (`jit_zero_at_rest`, `solvency_incl_open_jit`, `jit_roundtrip_conserves`, `delta_settled`,
  `swap_never_bricks`, `rounding_favors_vault`).
- **No oracle/price in any money-path math** — the swap itself is the only price; round every division against
  the vault.
- **A swap must NEVER revert for a capture-mechanism reason** — every lever is a `try`-safe, silent fallback
  (fee override / JIT / skim failing → the swap fills on resting liquidity).
- Dedicated position salts (never co-mingle with the main `salt=0`), per-swap AND per-block capital caps, and
  a `jitActive`-style guard blocking reentrant unlock-based entrypoints.

(NB: `ulv-jit-lever-b-spec.md` targets the **pair vault** + `MWHookCoordinator`; YPN's JIT is the sibling
`borrowIdleForJit`/`settleJitReturn` model in `MintwareTreasuryJitHook` — same bar, different bridge.)

## The decision (tiered by pool, matching YPN's actual market)
YPN's market is **thin community/meme token pools** (teams launch a vault with their own token). The research
is decisive that the capture mechanism must be **tiered by pool depth** — one size does not fit all:

| Pool tier | Primary capture | Why |
|---|---|---|
| **Thin community / meme** (YPN's core) | **Dynamic/surge fee + MEV-tax** — two cheap `beforeSwap` levers | am-AMM's rent engine **stalls** without a professional-manager market (rent→0, no LP capture); Diamond LVR needs a reference price single-venue tokens lack. Both fee levers are oracle-free and capture the leak at any depth. |
| **Blue-chip / deep / multi-venue** | **am-AMM** (the built, fuzzed engine) | A real manager market forms → rent competes the arb back to LPs. This is what `am-amm-design.md` already targets ("BLUE_CHIP only"). |
| — (any) | ~~Diamond-style LVR recapture~~ | **Deferred** — structurally needs a credible external `p_c`; wrong tool for thin/single-venue meme pools. |

This is the `pool_tiering.md` principle ("blue-chip vs community are different products"), now with the exact
mechanisms attached.

## What we already own (a lot)
| Block | State | Reuse |
|---|---|---|
| `MWAmAuction` + `MWAmAuctionLib` | **Crown jewel** — Harberger auction, Stages 1–3 + custody + swap-path invariant-fuzzed (256×128k), self-audited (F-B squat, segregated fee-reserve). Blue-chip. | Reuse the pure math verbatim (Phase 3). |
| `MWDynamicFee` | Volatility/deviation surge fee, unit-tested. Pure pip math. | Reuse directly (Phase 1). |
| `MWOracleGuard` | Truncated-tick oracle + breaker. **Already imported by the YPN JIT hook** (`_oracle`). | Already shared. |
| `MWHookCoordinator` | Drives the **pair vault** (`jitOpen/jitClose`, flags `0xAC8`). | **Do NOT wire wholesale** — its JIT bridge is disjoint from YPN's (`borrowIdleForJit/settleJitReturn` + keeper sweep + loss breaker), and permission bits differ. |

**Build-vs-reuse verdict (from the code audit):** *extend the YPN JIT hook with the shared libraries; keep
YPN's own JIT; do not adopt the coordinator.* ~90% of the hard, fuzzed logic is reusable as libraries; what's
YPN-specific is the hook wiring + the senior/junior tranche fee/rent accounting.

## Phased build

### Phase 1 — Dynamic/surge fee (the pragmatic first lever) · oracle-free · no hook re-mine
The single highest value-per-risk win. Extend `MintwareTreasuryJitHook.beforeSwap` to return a real LP-fee
override (it already returns the fee slot as `0`). **No new permission bit** — returning `fee | OVERRIDE_FEE_FLAG`
needs only the pool initialized with `DYNAMIC_FEE_FLAG` (a pool-init change, not a hook-flag change).

> **Status — increments 1 & 2 SHIPPED** (branch `feat/ypn-vault-convergence`, PR #261):
> - **inc1 (base/deviation fee)** — `_dynamicFee` returns a deviation-scaled `volatilityFee` override
>   (linear, oracle-free), pool-init flipped to `DYNAMIC_FEE_FLAG` across factory/scripts, old `poolFee`
>   repurposed as the hook base via `setBaseFeePips`. Commit `64363f4f`.
> - **inc2 (surge floor)** — `MWDynamicFee.surgeFee` (halving + linear interp, revert-free, fuzzed) taken as
>   `max(base, surge)`; armed on JIT reposition + owner/vault `armSurge()`; **OFF by default**
>   (`surgeHalfLifeSecs = 0`), ops-enabled via `setSurgeParams` (bounded `maxPips ≤ MAX_LP_FEE`,
>   `halfLife ≤ 365d`). Invariants re-proven 7/7 at 256×128k/0 **with the surge live + decaying**.
> - **inc3 (quadratic base)** — `MWDynamicFee.volatilityFeeQuad` adds a `quadMult·dev²` term (convex blend
>   `base + slope·dev + quad·dev²`); `quadMult` OFF by default (0 ⇒ exactly inc1 linear), ops-enabled +
>   bounded (`≤ MAX_LP_FEE`). Invariants re-proven 7/7 at 256×128k/0 with the FULL convex fee + surge live.
> - **Phase 1 COMPLETE.**
> - **Phase 2 — MEV-tax SHIPPED** — `MWDynamicFee.mevTaxPips` adds `min(k·priorityFeeGwei, cap)` on top of
>   `max(base,surge)`, clamped to MAX_LP_FEE. Fee-override form (no re-mine); saturating + revert-free for any
>   input (fuzzed); OFF by default (`mevTaxK=0`), per-chain opt-in via `setMevTax`. ⚠ Base-only / soft
>   sequencer-trust → bonus, not solvency. Invariants re-proven 7/7 at 256×128k/0 with the FULL lever stack
>   (base+quad+surge+MEV-tax) live on a standing priority gap.
> - **Next: Phase 3 — am-AMM for blue-chip/deep pools** (reuse the fuzzed `MWAmAuction` + a tranche-aware
>   `fundRent`; needs a CREATE2 re-mine to `0xAC8`). Diamond LVR still deferred. External audit is the gate.
- **Formula (Bunni v2 two-component, verified from source — oracle-free):**
  - Surge (floor): `surge = 1e6 · 2^(−Δt/halfLife)` — starts 100%, halves every `halfLife`; **triggered** on our
    LP rebalance / JIT reposition / backing-NAV move / idle-gap autostart. The anti-sandwich / anti-stale clamp.
  - Base (quadratic): `base = clamp(feeMin + feeQuadraticMultiplier·delta², feeMin, feeMax)`, `delta` = deviation
    of the post-swap price from a short **in-pool TWAP** (the hook's own oracle observations — no external feed).
    Quadratic → toxic/arb-sized prints pay a lot; mean-reverting retail pays `feeMin`.
  - `fee = max(surge, base)`.
- **V4 plumbing:** `LPFeeLibrary` — `DYNAMIC_FEE_FLAG = 0x800000` at pool init; return `fee | OVERRIDE_FEE_FLAG
  (0x400000)`, `fee ≤ MAX_LP_FEE (1e6 pips)`.
- **Tier the params by junior tier** (`feeMin/feeMax/multiplier/halfLife`): meme vs blue-chip get different
  curves (`pool_tiering.md`). Captured fee accrues to the vault → senior/junior per the existing fee split.
- **Reuse `MWDynamicFee` + `MWOracleGuard`.** Directly fixes `pool_tiering.md`'s "naive JIT bleeds on thin
  pools": the surge floor protects the repositioned range; the quadratic term prices toxic size.

### Phase 2 — MEV-tax (the fitting LVR moat for thin pools) · tiny · Base-gated
Net-new but ~one `beforeSwap` read. Adds `fee += min(k · priorityFeePerGas, feeCap)` where
`priorityFeePerGas = tx.gasprice − block.basefee`. Under Base's competitive priority ordering, a bot arbing us
must reveal its edge through priority → we tax it back to the vault. Captures the leak **at any pool depth**,
oracle-free (uses the searcher's own bid as the value signal). Implement as an LP-fee inflation (not a skim
delta) → **no `beforeSwapReturnDelta` bit, no re-mine.**
- **`k`:** start ~50 (not the canonical 99) to limit drag on organic users paying high priority during
  congestion; add a floor/cap. Per-pool tunable, owner-gated.
- **Caveat (must document for the auditor + ops):** relies on the Base sequencer honoring priority ordering — a
  **soft guarantee** (centralized sequencer), not a proof. Treat as bonus revenue, not core solvency. Fails on
  Ethereum L1 (builder auctions) — Base-only.

> Phases 1+2 are both **pure `beforeSwap` fee-override** changes to the *existing* hook + a pool-init flag
> flip. **No permission-bit change, no CREATE2 re-mine** — much cheaper than the am-AMM path.

### Phase 3 — am-AMM for blue-chip / deep community pools · reuse the fuzzed engine · re-mine
For pools liquid enough to attract a manager market. Reuse `MWAmAuction` + `MWAmAuctionLib` (already fuzzed +
self-audited) with a **thin YPN driver**, NOT the coordinator:
- A `beforeSwap` skim branch in the YPN hook (respecting `canonicalPoolId` + the borrow model) →
  `beforeSwapReturnDelta` → **flags change → CREATE2 re-mine + factory/registry rewire** (exactly the
  `0xAC0→0xAC8` fork `am-amm-design.md` describes).
- A **tranche-aware `fundRent`** on `MintwareTreasuryVault` — the pair vault routes rent 100% to LPs; YPN must
  split rent across **senior (par) / junior (first-loss)** without disturbing the price-free senior NAV
  invariant. **This accounting is the real new design work** (not the auction math).
- Carry forward the locked decisions from `am-amm-design.md`: am-AMM *replaces* the dynamic fee on enrolled
  pools (don't stack), `MWOracleGuard` breaker stays on, owner-gated, K≈43_200 (24h on Base's 2s blocks).

### Deferred — Diamond-style LVR recapture
Needs a credible external reference price (multi-venue/CEX) + a futures-auction subsystem. Thin community token
= no anchor → don't build it here. Revisit only for a blue-chip vault surface.

## Integration notes (the concrete seams)
- **Home = the existing `MintwareTreasuryJitHook`** — extend it, no new hook family (the `#254` decision). It
  already has the oracle instance + both swap callbacks + the canonical-pool guard.
- **Pool-init flag:** Phases 1–2 require pools created with `DYNAMIC_FEE_FLAG` instead of a static `3000`. The
  hook's `canonicalPoolId` recomputes from the key, so the factory/scripts just pass the dynamic-fee sentinel —
  verify the `HookMiner` args + `canonicalPoolId` stay consistent.
- **Value routing:** captured fee → the vault's existing fee accrual → senior/junior per the 60/30/10 (or
  lock-phase 100%-senior) split. No new custody surface for Phases 1–2.

## Economics (what to quantify next)
The earlier `sims/lvr_capture_sim.py` put **capturable LVR at ~15–40% of trader slippage** on thin pools. The
dynamic fee captures much of that **implicitly** (the quadratic term makes the arb pay to move price); MEV-tax
captures the priority-revealed residual. **Open follow-up:** extend the sim to model expected fee revenue from
the two-component fee + MEV-tax under realistic volume/priority-fee distributions → an actual "$X/day per pool"
figure to size the build against. (Requires volume + priority-fee assumptions; flagged as a modeling task.)

## Risks / open decisions (for the auditor + before build)
1. **MEV-tax sequencer trust** — Base priority ordering is a soft guarantee; size `k` conservatively, treat as
   bonus not core.
2. **Congestion drag** — MEV-tax taxes organic high-priority users too; needs a cap/floor + monitoring.
3. **Surge trigger design** — deciding exactly which events (JIT reposition, NAV move, idle-gap) fire the surge,
   and their thresholds, is the main Phase-1 design judgment.
4. **Phase-3 tranche rent split** — how am-AMM rent divides senior/junior without breaking price-free senior NAV.
5. **Param tiering** — per-pool `feeMin/feeMax/multiplier/halfLife/k` presets by junior tier.
6. External audit — Phases 1–2 extend the audit-candidate hook; Phase 3 reuses the already-fuzzed auction but
   adds the tranche `fundRent`. All gated on the same external audit as the converged vault.

## One-line summary
**Thin pools (YPN's market) → extend the existing JIT hook with a two-component dynamic fee (reuse `MWDynamicFee`,
oracle-free) + a Base-gated MEV-tax — both cheap `beforeSwap` fee overrides, no re-mine. Reserve the built,
fuzzed am-AMM for blue-chip/deep pools (reuse `MWAmAuction` + a tranche-aware driver). Defer Diamond LVR.**

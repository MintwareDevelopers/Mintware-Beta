# am-AMM — Flagged-Item Decisions (self-audit follow-up, 2026-08-09)

The self-audit (see `am-amm-design.md`) fixed the clear fund-safety bugs immediately and
**flagged** the items that were design decisions rather than mechanical fixes. This doc records
the research, the decision, and the implementation for each flagged item.

---

## 1. F-B — challenger-slot squatting  ·  DECISION: BidDog parity + promotable-only  ·  ✅ IMPLEMENTED

### The problem
Our single `nextBid` slot could be squatted for free: a challenger paid no rent, could cancel
(fully-refundable) and re-bid to reset the K-block clock forever, and — because displacing a
standing challenger required beating *it* by the 1.1× multiplier — a squatter pinned just below the
promotion threshold forced honest entrants to bid `> manager_rent · mult²`.

### Research (am-AMM paper arXiv:2403.03367 + Bunniapp/biddog `AmAmm.sol`)
The key finding: **our bug is a *deviation* from the canonical BidDog reference, not a gap in it.**
BidDog structurally forbids squatting and we had reintroduced it:
- **No cancel function.** The only exit from a bid is being out-bid (refund) or promoted. Escrow is
  committed, not freely refundable.
- **Withdrawal locked to the `rent·K` floor** — `withdrawFromBid` reverts if `(deposit-amount)/rent < K`.
- **Forced promotion** — a challenger aged ≥ K blocks and still out-bidding the manager is
  auto-promoted into the *rent-paying* seat; squatting == winning the auction.
- The challenger is **never charged rent** (charging a powerless non-manager is incoherent); the
  anti-squat work is done by committed escrow + forced promotion, not by rent.
Neither the paper nor any production hook (BidDog is the shared base for Bunni v2 and the Uniswap
Foundation cohort forks) charges the challenger rent or uses a multi-challenger queue.

### Candidates weighed
Charge-the-challenger (reject: incoherent) · griefing bond (reject: burns honest capital) ·
multi-challenger queue (reject: O(n) gas, not used by paper/BidDog) · **no-cancel + locked escrow +
forced promotion** (adopt — BidDog parity) · **promotable-only occupancy** (adopt — the refinement
that also kills the mult² barrier).

### Decision & implementation
Adopt BidDog's invariants **plus** promotable-only occupancy:
- `MWAmAuctionLib.canWithdraw` — **removed the free-exit path.** A withdrawal must leave the
  `rent·K` reserve (exact multiple); escrow can only leave via out-bid or promotion.
- `MWAmAuctionLib.validBid` — now takes the current `top` bid and requires a challenger to be
  **promotable against the MANAGER** (`rent > top.rent · mult`), not merely beat a standing
  challenger. This eliminates the sub-promotion squat position and the mult² premium.
- Forced promotion + beat-standing-to-displace already existed (`shouldPromote` / `outbids`).
- Tests: `test_challenger_cannot_cancel_fully`, `test_validBid_must_beat_manager`,
  `test_canWithdraw_full_exit_now_blocked`.

### New attack-cost
The zero-cost perpetual squat is **structurally eliminated.** A slot occupant is now, by
construction, promoted within K blocks and pays `≥ 1.1×` the manager's rent to the LP. Clock-reset
griefing costs ≥1.1× more rent each reset (geometric, bounded at `⌈log₁.₁(R_cap/R_top)⌉`) and
terminates with the griefer paying that rent to the LP. Every terminal state routes surplus to LPs.

### Operator note
Set `K` to the real notice window on Base's ~2s blocks (BidDog's `7200` was a 24h Ethereum figure;
`≈43_200` ≈ 24h here, `≈7_200` ≈ 4h). Keep `minRent > 0` so the seat can't be seized for nominal rent.

---

## 2. `rebalanceToProfile` absorbs unclaimed fee/rent reserves  ·  DECISION: segregated reserve  ·  ✅ IMPLEMENTED

**Problem (pre-existing, affects swap fees too):** the accumulator backs claims from the vault's raw
balance, and `_rebalance` re-added the *entire* balance as liquidity — sweeping LPs' unclaimed fees
and rent into the position, where `_claimFees` could then underpay/revert.

**Decision:** segregate a `feeReserve0/1` — the vault-held tokens backing accumulator liabilities —
and never deploy it. Implemented: reserve incremented on fee accrual (`_realizeFees` accumulator
path) and rent (`fundRent`), decremented on `_claimFees`, and `_rebalance` deploys
`balanceOf − feeReserve`. Test: `test_rebalance_preserves_unclaimed_rent`. This also fixes the
equivalent swap-fee leak, not just rent.

---

## 3. Rent-only until the hook lands (F-D)  ·  DECISION: operational gate, not a code fix

Until Stage 3 wires the coordinator to drive `poke`/`recordManagerFee` on the swap path, a manager
pays rent and captures no fees → managing is value-negative and no one rationally bids. This is a
**sequencing rule, not a bug**: **do NOT `setEnabled(true)` on any pool until the Stage-3 hook
wiring lands in the same change.** Enforced by process + the go-live runbook; a premature enable is
LP-safe (pool just runs on `defaultFeePips`), it simply advertises an inert auction.

---

## 4. Lower-severity items  ·  DECISIONS

- **`withdrawFeeBps` (dead param)** — KEEP, reserved for the Stage-3 anti-exit-race fee (paper
  Appendix B). Documented as reserved rather than dropped, since Stage 3 wires it vault-side.
- **Manager fee immutable per bid (no `setFee`)** — KEEP as-is. A per-block fee change requires a
  fresh bid + K-notice; this is LP-protective and an intentional simplification. Revisit only if
  Stage-3 experience shows managers need intra-tenure fee adjustment.
- **`weightedDistributor` max approval** — ACCEPT as a trust assumption. It is owner-set and
  one-time (`WeightedDistributorAlreadySet`); a compromised distributor is a governance failure, not
  a contract bug. Noted for the external audit.

---

**Status after this doc:** F-B and the reserve flaw are fixed + tested (forge 246/246). F-D is an
operational gate. The lower items are conscious keeps. The external audit remains the gate before
real value — with a clean, decided hand-off list.

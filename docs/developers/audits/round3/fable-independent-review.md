# Round 3 — independent line-by-line (Fable 5.1), alongside the six replay/fuzz passes

Scope: the code paths written by agents in the close-out that I had not personally read — the C-10 tolerant-source
path (`_idle` / `_syncIdle` / `lastKnownIdle`), the timelocked recipient rotation, and the current `_withdraw`.
PoCs live in `contracts-v4/test/audit3/Round3*.t.sol`.

## R3-1 · MEDIUM · CONFIRMED (fork PoC) — `lastKnownIdle` is only conservative for YIELD; a LOSS during a source outage lets the outage-time exiter offload part of the loss onto remaining holders

**Scope invariant 11** says: "During a source outage the idle entitlement is sized off the last successful read;
yield accrued since is invisible, so a withdrawer burns *more* shares per unit delivered, never fewer." That is true
for yield. It is false for a **loss** realised in the source while it is unreadable (a market bad-debt event that
coincides with — or causes — the preview outage). Then `lastKnownIdle` is stale-**high**, and the exit re-credits
shares for the undeliverable idle leg against the inflated figure:

`_withdraw` (`MintwareLpGatewayPositionManager.sol:405-407, 418, 465-474`):
```
(bool idleOk, uint256 idle) = _idle();  if (!idleOk) idle = lastKnownIdle;      // stale-HIGH after a loss
fromIdle = toAssets(shares, idle, …)                                            // over-sized entitlement
claim = fromIdle + lpEntitled;  delivered = lpDelivered;                        // idle leg delivered 0
reCredit = shares · (claim − delivered) / claim                                 // = shares · fromIdle/claim — too many
```
The exiter keeps too many shares; when the source returns with less, the loss is socialised pro-rata over a share
base in which the exiter is over-weighted relative to what they actually left in the reserve.

**PoC** `test_R3_staleIdle_lossDuringOutage_outageExiterOffloadsLoss` (real v4 fork, `RTFlaky4626` source):
Alice + Bob 100k each; owner deploys 100k/100k; idle 100k, NAV ≈ 300k. Source loses 20k of the idle and goes dark
(`setRevertPreview(true)`). Alice exits during the outage (LP leg pays; idle leg re-credited off the stale 100k).
Source recovers; both exit fully.

| | Alice (exited during outage) | Bob (stayed) | Fair (share the 20k loss) |
|---|---|---|---|
| total out | **145,000** | **135,000** | 140,000 each |
| vs fair | **+5,000** | **−5,000** | — |

Alice bore 5k of her 10k share of the loss; Bob bore 15k of his 10k. Transfer = 5k on a 20k loss. Generally the
exiter's shortfall of loss borne scales with `f_exiter · loss · (stale idle weight)`; the remaining holders absorb it.
Value is still conserved (`assertLe(aliceTotal + bobOut, NAV − loss)` holds) — this is a **redistribution**, not a
mint, which is why the existing "never mints value" invariants did not catch it.

**Preconditions:** a 4626 source that (i) realises a loss and (ii) is unreadable at the same time — a curator
misallocation / bad-debt event is the realistic shape; and a holder who chooses to exit blind rather than wait.
**Not exploitable at will** — the attacker cannot cause the source loss — but a holder who *observes* the loss
(off-chain, e.g. via the Morpho market) while previews are down can front-run the recovery and dump their share of
it on everyone else. Severity **Medium** (bounded, double failure, but a genuine unfairness for third-party
depositors; for own funds with one holder it is moot).

**Fix options (recommend the first):**
1. **Outage haircut** — when `!idleOk`, size the idle entitlement off `lastKnownIdle · (10_000 − OUTAGE_HAIRCUT_BPS) / 10_000`
   with a constant (e.g. 2 000 = 20 %). The blind exiter then keeps *fewer* shares than a live read would give them
   (they bear ≥ their share of any loss up to 20 %), remaining holders are protected against losses up to the haircut,
   and the exiter always has the free alternative of waiting for the source to recover and exiting exactly. One
   line + one constant; keeps "never brick".
2. Refuse the idle leg entirely during an outage (exit = LP slice only, burn only `shares · lpEntitled/(lpEntitled + idle_stale)`)
   — this is what already happens; the estimate is the problem, not the mechanism.
3. Refuse all exits during an outage — violates M-01 "never brick"; rejected.

Also worth restating invariant 11 in the scope doc as: "*a stale `lastKnownIdle` never over-states idle by more than
the outage haircut relative to the live reserve after the source returns*" — i.e. make the bound explicit rather than
directional.

## R3-2 · LOW (hypothesis — handed to the integration-replay pass to confirm) — `deploy` re-stages leftover quote unconditionally; a capped source (Morpho `maxDeposit == 0`, the live mainnet state) makes that revert, and `LiquidityAmounts` rounding almost always leaves dust → `deploy` is DoS'd for as long as the source is at cap

`deploy` (`:569-578`): `quoteLeft = balanceOf(this)` after the mint; `if (quoteLeft > 0) { forceApprove; staging.stage(quoteLeft); }`.
`stage` → `adapter.deposit` → `source.deposit` reverts `SUPPLY_CAP` when the source is capped. Because the v4 mint
consumes `≤ amount0Max` and rounds, `quoteLeft` is virtually never exactly 0 — so with a capped source every
`deploy` reverts at the re-stage, even though the LP add itself succeeded a few lines earlier. Availability only
(no loss), owner-side, but it means the gateway can't deploy exactly when a popular Morpho vault is full — the
situation the mainnet preflight found today. Suggested fix: `try staging.stage(quoteLeft) {} catch { emit
RestageDeferred(quoteLeft); }` and let the dust sit in the PM (it is picked up by the next `deploy`'s
`quoteBefore`); optionally count the PM's own quote balance in `totalNav`. Also note `compoundQuote` and
`deposit` revert in the same state — correct (DOA, no loss) and already documented.

## Note (not a finding) — the cap's denominator is the *live* reserve, not principal

`deploy` (`:518`) sizes the 50 % cap against `stagedAssets() + deployedPrincipal`. `stagedAssets` includes accrued
source yield and compounded fees, so over time the base drifts above depositor principal and the cap admits slightly
more than 50 % of *true* principal. Direction is benign (yield is depositor value too) and the scope doc states the
invariant in exactly these terms; flagging only so the auditor doesn't read "principal" too literally.

## Verified sound in this read (no finding)

- **Rotation** (`proposeHarvestRecipient` / `acceptHarvestRecipient` / `cancel`, `:223-250`): owner-only, 48 h ETA,
  re-propose overwrites + restarts the clock, accept clears both fields, sweeps read the live `harvestRecipient`, so
  nothing pays the pending address early. The timelock is a *reaction window* for the same key — correct as designed;
  a second signer for `acceptHarvestRecipient` is the natural upgrade before third-party funds (scope §8 Q6b).
- **Re-credit fungibility** (the A-1 path with a *readable* source): worked the algebra — after Alice's outage-free
  partial delivery, `NAV_after = NAV_before − delivered` and `reCredit = shares · unserved/claim`, so her new
  fraction × `NAV_after` equals exactly her unserved value; Bob's claim is unchanged. No transfer either way.
- **`deployedPrincipal` decrement on a re-credited exit** (`:454-455`): reduced by the *full* share fraction even
  though only `sharesBurned` left — correct, because the LP slice for the full `shares` *was* delivered; the retained
  shares carry only an idle claim plus a fresh pro-rata claim on the *remaining* LP, which is what fungible shares mean.
- **Ordering**: `_lastActionBlock` set before the `SourceUnavailable` refusal → the revert undoes it; `minQuoteOut /
  minPairedOut` checked after all state changes → a floor breach reverts the whole exit; `spot` cached before the
  first external call; `SourceUnavailable` refusal only when `!idleOk && liqToRemove == 0` (nothing deliverable).

## Post-fix status (2026-09-08, this branch)

| ID | Status | Where |
|---|---|---|
| R3-1 | ✅ **Fixed** — `OUTAGE_HAIRCUT_BPS = 2000` on `lastKnownIdle` when the source is unreadable (`_withdraw`). The three C-10 outage expectations in `test/fork/MintwareLpGatewayCloseoutFork.t.sol` now encode the haircut (5/7 burned, 2/7 re-credited; the co-depositor can only ever gain from a blind exit). Scope invariant 11 restated. | PM `_withdraw`, scope §6 inv. 11 |
| R3-2 | ✅ **Fixed** — `deploy` re-stages leftover quote in `try/catch` and emits `RestageDeferred`; dust stays in the PM (outside NAV) until the next deploy. Confirmed by the integration replay (`maxDepositZero` case flipped). | PM `deploy` |
| Cap denominator note | unchanged (documented) | scope §6 inv. 6 |

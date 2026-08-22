# Priority-buffer redesign — internal rationale + research trail

**Status:** design decision + research record, dated 2026-08-22. **Not legal advice** — this
substantiates the reasoning behind the public `/legal` page's bright lines #4 and #6 and the
`Securities / deposit-taking` regime row; it is not a substitute for a securities opinion before
any non-testnet capital is at risk. Audience: team + legal counsel, and — via direct sharing, not
the public page — investors who want the underlying reasoning, not just the conclusion.

## The problem this addresses

Mintware vaults that pair a protected position against a first-loss position (e.g. a
community/senior side backed by a team-token/junior side) are structurally close to the
senior/junior "tranche" design the SEC shut down in *BarnBridge* (Dec 2023, $509M raised, $1.7M
settlement, DAO wound down). That action used the *Reves* "notes" test, not Howey — BarnBridge's
SMART Yield was structured as bonds (principal + promised interest), and both the fixed senior
*and* the variable junior tranche were caught. The features the SEC's order actually leaned on:
pooled capital, a promised/guaranteed return, public retail marketing of an investment product, and
no risk-reducing factor (no insurance, no alternative regulatory scheme covering the instrument).

## Two constraints that are not up for negotiation

Set explicitly by the team and confirmed correct by the research below, not just asserted:

1. **No Reg D / accredited-investor gating of US access as a default strategy.** (Real, working
   precedent exists — Maple, Goldfinch, Centrifuge all run live tranches this way — but it's
   rejected here as a first move, reserved only as a last resort behind an unfavorable formal
   opinion.)
2. **Community keeps full, unrestricted participation in MEV / pool-fee yield.** No research pass
   found any legal theory tying tranche risk to *who receives fee income* — the trigger is the
   promise-and-pool structure, not the recipient of trading/MEV revenue.

## What the research ruled out

- **Mutualized/no-seniority pooling (GMX GLP / Synthetix debt-pool pattern).** Untested legally,
  and it doesn't even deliver the goal — it gives everyone identical symmetric risk, i.e. no
  protected class at all. Wrong tool for "protect the senior side."
- **Building an in-house discretionary insurance/claims mechanism.** Trades SEC exposure for
  50-state unlicensed-insurance exposure — arguably a worse regulator to be untested against
  (per-day civil penalties, no need to prove investment intent). Buying *third-party* cover
  (Nexus Mutual / Sherlock-style, à la the Yearn/Idle precedent) is cleaner if pursued, but that's
  item #4 below (deferred).
- **Fixed → variable return relabeling alone.** *SEC v. Edwards* and BarnBridge itself (which
  caught both the fixed senior and the variable junior bonds) both hold this doesn't change the
  outcome. Cosmetic without a substantive change alongside it.
- **"Performance bond" language on its own.** Mostly cosmetic *unless* the first-loss capital is
  exclusively the operator's own money with zero outside investment in that layer — the moment a
  third party buys into it, substance-over-form collapses the distinction back to a junior tranche.

## What's being adopted now (items 1, 2, 5, 6)

**1 — First-loss capital stays structurally, not just policy-wise, team-only.**
The pair-vault pattern already has this mostly for free: the team seeds junior with its own
pre-existing token (e.g. the community-token side of a SHIB×ETH pair), not a Mintware-minted
instrument sold to the public — that's a materially better starting position than BarnBridge's
purpose-built junior bond. What needs verifying/hardening in code: whether the junior LP
receipt/share (the vault's accounting claim, *not* the underlying team token, which is already
public property) is transferable to arbitrary addresses once any lock/cliff expires. If so, that
gap should close — restrict transfer to team-treasury-controlled addresses permanently, not just
during a lock window. This is the single highest-leverage item: every research pass converged on
"the instant first-loss capital is sold to a third party expecting a return, the structure is
economically a junior tranche again, regardless of what it's called."
*Action:* audit `MintwareMatchedLiquidityVault` / `MintwareDeFiPairVault` junior-share transfer
logic for a post-lock transfer restriction to team-controlled addresses.

**2 — Kill the guarantee; keep the mechanism.**
The par-first payout logic doesn't need to change. What changes is the promise: no "guaranteed,"
"always whole," or "your money is safe" language anywhere, replaced with an accurate claim — the
contract pays the protected side first, mechanically, and the buffer's real-time size is visible
on-chain.
*Verified 2026-08-22 against PR #355 (`MWTimelockedRiskParams`):* payout **order** itself (protected
side first) is not a settable parameter anywhere in that PR's governed-setter list — it's fixed in
contract logic. What *is* owner-settable are risk **parameters** that affect the *size* of
protection (idle buffer target, min coverage, JIT caps, junior top-up caps, settlement bands) — and
as of #355 those are bounded, disclosed via `RiskParamProposed/Confirmed/Cancelled` events, and
asymmetric by design: tightening protection applies instantly, loosening it is delayed 48h. This is
a *better* disclosure story than blanket immutability claims would have been — it's accurate, and
it's what the public page now says. No further code action needed for item #2; keep the public copy
in sync if the governed-setter list changes.

**5 — Active-use framing, made real, not just marketing.**
The one favorable Supreme Court doctrine here (*United Housing Foundation v. Forman*, 1975) turns
on genuine consumptive/active use changing the "profits from others' efforts" analysis — a
depositor using a service they also benefit from reads differently than a passive investor waiting
on someone else's managerial effort. This is directional, not dispositive (*SEC v. Coinbase*'s 2024
staking ruling shows courts aren't automatically persuaded by "the depositor did something too"),
but it's free and it's good product design regardless: tie visible benefit to actual usage
(card-spend activity) rather than pure passive holding, and make the copy/product genuinely reflect
"a position in a service you use," not "a fund you invest in and leave alone."

**6 — Community keeps full, unrestricted MEV / pool-fee yield.**
No change. Confirmed correct by every research pass — this was never the risk driver, and nothing
in the redesign touches it.

## Deferred, not adopted yet (items 3, 4)

- **3 — Fee-funded reserve (protocol revenue, not investor capital).** A second backstop layer
  funded from Mintware's own fee/MEV cut (not a sold instrument) is the single cleanest mechanism
  the research found — zero second-party "investment of money" in that layer at all, since it's
  retained earnings. Worth building later as an additive layer; not required for 1/2/5/6 to hold.
- **4 — Third-party smart-contract coverage** (Nexus Mutual / Sherlock, following the Yearn/Idle
  precedent) for exploit/oracle-failure tail risk. Real budget line, not a legal trick; deferred as
  a cost/ops decision, not a rejected idea.

## The residual risk that no redesign removes

Pooling itself still satisfies Howey's "common enterprise" prong (horizontal commonality) —
removing tranches doesn't remove that, and neither does anything above. This is the same exposure
Aerodrome, Uniswap, Aave, and Compound all carry at vastly larger scale, entirely untouched by
enforcement. The reason enforcement has never reached plain pooled LP products, despite the
technical presence of "common enterprise," is the *absence* of the aggravating facts BarnBridge
had: no guaranteed/promised return, no protected class insulated from another class's losses by a
purchased instrument, no first-loss position sold to outsiders, no "invest and earn X%" promotional
framing. Once items 1 and 2 land, the platform sits on the same ground those untouched protocols
already occupy — the residual risk is background risk shared by the entire pooled-LP category, not
a Mintware-specific exposure.

## Sources (from the 2026-08-22 research pass)

- SEC BarnBridge order (Securities Act Release 33-11262) and press release 2023-258
- *SEC v. Edwards*, 540 U.S. 389 (2004) — fixed return does not exempt from Howey
- *Reves v. Ernst & Young*, 494 U.S. 56 (1990) — four-factor "family resemblance" test for notes
- *Marine Bank v. Weaver*, 455 U.S. 551 (1982) — risk-reducing factor (insurance/regulation) contrast
- *United Housing Foundation v. Forman*, 421 U.S. 837 (1975) — consumptive-use vs. investment intent
- *SEC v. Coinbase* (S.D.N.Y. 2024) — ministerial efforts still satisfy "efforts of others"
- SEC Feb 2023 Kraken settlement (staking-as-a-service) and Aug 2025 SEC staff statement on liquid
  staking (ministerial/non-discretionary conditions; explicitly excludes restaking)
- Maple Finance / Goldfinch / Centrifuge live tranche structures under Reg D 506(c) + KYC (the
  rejected-as-default alternative path)
- Nexus Mutual / Sherlock discretionary-coverage models; Aave Safety Module / Umbrella
- SEC Commissioner Peirce, "Headstands and Summervaults" remarks (July 22, 2026) — warning against
  structural gymnastics to avoid the securities label

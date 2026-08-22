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

## The case law, one at a time — what each one threatens, and how the redesign answers it

The sections above give the conclusions. This is the actual chain of reasoning — each real
precedent, what it puts at risk for a protected/first-loss vault, and exactly which part of the
redesign answers it (or honestly doesn't yet).

### 1. SEC v. BarnBridge DAO (2023) — the direct precedent

**The problem.** SEC used *Reves*, not Howey, against a senior/junior tranche paying a
guaranteed senior yield funded by diverting junior capital when returns fell short, marketed to
the public with no registration or exemption ($509M raised, $1.7M settlement, DAO wound down).
Critically, **both** the fixed senior bonds **and** the variable junior bonds were caught —
variability on the junior side didn't save it.

**How we overcame it.** Remove the specific aggravating facts, not the word "tranche": (2) strip
every "guaranteed"/"always whole" claim and replace it with an accurate priority-not-promise
disclosure; (1) junior capital was never sold to the public in this design in the first place
(team seeds junior with its own token) — harden that into an on-chain restriction so it can never
become a BarnBridge-style publicly-sold "junior bond"; (6) full, unrestricted MEV/fee yield keeps
the product framed as usage-based participation rather than a promised-return investment scheme.

### 2. SEC v. Edwards, 540 U.S. 389 (2004) — fixed return doesn't exempt from Howey

**The problem.** Early in this process we considered "just make the senior return explicitly
variable/probabilistic instead of guaranteed" as the fix. *Edwards* forecloses that as a
standalone move — the Supreme Court held fixed vs. variable return is legally irrelevant to
Howey. BarnBridge's own order proves the same thing for *Reves* (it caught the variable junior
bonds too).

**How we overcame it.** We didn't rely on a fixed→variable wording change as *the* fix. Item #2
removes the *promise* itself — not "make it variable," but "stop promising anything, fixed or
variable, and disclose a mechanical priority claim instead" — paired with the structural fix in
item #1. Wording changes alone were explicitly tested and rejected here before landing on this.

### 3. Reves v. Ernst & Young, 494 U.S. 56 (1990) — the four-factor "notes" test

**The problem.** Applied to a fixed-return senior tranche, the four factors go badly: (1)
motivation — pure profit-seeking on both sides; (2) plan of distribution — broad public retail
marketing; (3) public expectations — a "guaranteed yield" pitch is exactly what triggers investor
expectations of a security; (4) risk-reducing factor — **structurally absent**: no FDIC-equivalent
insurance, no alternative regulator covering the instrument.

**How we overcame it — and where we honestly haven't yet.** Item #2 directly targets factor 3:
replacing "guaranteed" with "the code pays you first, mechanically, with the buffer size visible
on-chain" changes what a reasonable investor is told to expect. **Factor 4 is not fixed by
anything in items 1/2/5/6** — this is the one gap disclosure alone cannot close. It's exactly why
items #3 (fee-funded reserve) and #4 (third-party coverage) exist on the roadmap; until one of
those ships, factor 4 stays a real, acknowledged weak point, not a solved one.

### 4. Marine Bank v. Weaver, 455 U.S. 551 (1982) — what a real factor-4 fix looks like

**The problem/contrast.** This is the case that shows the shape of an actual fix: a bank CD
escaped Howey/Reves specifically *because* it was FDIC-insured and subject to federal banking
regulation — a real, external risk-reducing factor, not a disclosure choice. Mintware has no
equivalent today.

**Status: not addressed by this round.** Flagged directly rather than glossed over — this is the
honest reason items #3 and #4 remain on the roadmap even though they're deferred. Disclosure and
structural fixes (1/2/5/6) reduce exposure; only an actual reserve or actual third-party coverage
would build something in Marine Bank's slot.

### 5. United Housing Foundation v. Forman, 421 U.S. 837 (1975) — the one favorable precedent

**The opportunity.** *Forman* held co-op housing shares weren't securities because buyers
purchased them to *use* (live in the housing), not to passively invest for profit from someone
else's efforts. This is real, on-point Supreme Court doctrine for "buying into something you
actually use" changing the Howey analysis.

**How we leveraged it.** Item #5 is built directly against this precedent — tying the vault
position to genuine card-spend usage, and rewriting the product's own framing ("a position in a
service you use, not a fund you invest in and leave alone") to make the *Forman* argument
substantively true, not just asserted.

**The caveat that keeps this honest.** *SEC v. Coinbase* (S.D.N.Y. 2024) rejected Coinbase's
argument that its staking efforts were merely "ministerial" and therefore didn't satisfy Howey's
"efforts of others" prong — courts have been willing to find even fairly mechanical platform
efforts sufficient despite a user "doing something too." So item #5 is real, favorable support —
not a guaranteed defense on its own.

### 6. SEC v. Kraken (2023) + SEC's Aug 2025 liquid-staking staff statement — the separate ETH-yield question

**The problem.** Kraken's staking-as-a-service was a security because it took custody, pooled
user funds, **decoupled the rate it paid from the rate it actually earned on-chain**, and
promised a return. This is a different question from tranching, but it's the one that governs how
the ETH side of a vault should earn yield at all.

**How we overcame it.** The wstETH-native design decided earlier in this same research thread
(landing via PR #357) avoids every one of Kraken's factors by construction: non-custodial, no
rate-setting discretion, yield is the token's own exchange-rate appreciation, not a rate Mintware
sets or promises. This lines up with the SEC's Aug 2025 staff statement's conditions for liquid
staking to fall outside securities treatment.

**The line we deliberately stayed behind.** That same 2025 statement explicitly **excludes
restaking** (EigenLayer/AVS-style) from its safe treatment, because choosing which AVSs/operators
to route to is real managerial discretion. The design uses plain wstETH, not a restaking layer —
on purpose, to stay inside the covered zone.

### 7. SEC v. VALIC, 359 U.S. 65 (1959) — why "just call it insurance" doesn't work

**The problem we considered and rejected.** One option researched was building an in-house
discretionary claims/coverage mechanism to soften the tranche (Nexus Mutual-style). *VALIC* is the
reason this doesn't cleanly work: the Supreme Court held that calling something "insurance"
doesn't exempt it from federal securities law unless there's *genuine risk transfer/underwriting*
— and building an in-house risk pool from scratch additionally invites **state insurance-law
licensing exposure** (50 regulators, real per-day penalties, arguably less patient with crypto
novelty than the SEC currently is).

**How we overcame it.** Rejected building Mintware's own insurance/claims mechanism for exactly
this reason. If coverage is added later, it's item #4 — *buying* cover from an already-established
third party (Nexus Mutual / Sherlock, following the real Yearn/Idle precedent) — which pushes both
the pooling problem and the insurance-licensing problem onto a structure that already exists,
rather than inventing a new one at Mintware.

### 8. The SEC/CFTC 2026 interpretive framework — substance over form

**The problem.** Regulators (and Commissioner Peirce's July 2026 "Headstands and Summervaults"
remarks specifically) are explicit that they look at how a product actually functions, not what
it's labeled — a "performance bond" that's economically a junior tranche sold to outsiders is
still a junior tranche no matter what it's called.

**How we overcame it.** This is why item #1 is a structural, on-chain transfer restriction on the
junior share — not a renaming exercise. The whole redesign is built to survive a substance-over-form
read: the mechanism actually changed (junior locked to team addresses, payout order fixed in code,
usage genuinely tied to product design), not just the vocabulary around it.

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

## Deferred, not adopted yet (items 3, 4) — and stated intent to add them before real value is at risk

- **3 — Fee-funded reserve (protocol revenue, not investor capital).** A second backstop layer
  funded from Mintware's own fee/MEV cut (not a sold instrument) is the single cleanest mechanism
  the research found — zero second-party "investment of money" in that layer at all, since it's
  retained earnings. This is the one lever that would actually address Reves factor 4 / Marine
  Bank's "risk-reducing factor" gap (see #3 and #4 in the case-law walkthrough above) — it isn't
  built yet because there's no fee revenue to fund it with while everything runs on testnet.
- **4 — Third-party smart-contract coverage** (Nexus Mutual / Sherlock, following the Yearn/Idle
  precedent) for exploit/oracle-failure tail risk. Real budget line, not a legal trick — also a
  factor-4-shaped fix, and also not worth buying cover for testnet contracts holding no real value.

**Why deferred rather than rejected, and when this changes:** items 1/2/5/6 are the correct scope
*right now* because the product is testnet, unaudited, and holds no real value — there is nothing
for a reserve to backstop and nothing for third-party coverage to insure yet. The stated intent is
to add both #3 and #4 **before any vault is opened to real capital**, not as an afterthought once
it already is. This should be treated as a pre-mainnet checklist item, not a someday-maybe: the
public `/legal` page's testnet disclosure now states this intent directly so it's on record for
team, legal, and investors alike, and it should be revisited explicitly as part of whatever gates
the testnet → real-value transition (audit completion, mainnet deploy decision, etc.).

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

## Citation index

Full reasoning for each is in the numbered walkthrough above; this is just the reference list.

| # | Authority | Cited for |
|---|---|---|
| 1 | SEC BarnBridge order (Securities Act Release 33-11262) + press release 2023-258 | The direct precedent — what actually got a tranche shut down |
| 2 | *SEC v. Edwards*, 540 U.S. 389 (2004) | Fixed vs. variable return is not the legal distinguishing factor |
| 3 | *Reves v. Ernst & Young*, 494 U.S. 56 (1990) | The four-factor "notes" test |
| 4 | *Marine Bank v. Weaver*, 455 U.S. 551 (1982) | What a genuine risk-reducing factor (factor 4) looks like |
| 5 | *United Housing Foundation v. Forman*, 421 U.S. 837 (1975) | Consumptive/active use vs. passive investment intent |
| 6 | *SEC v. Coinbase* (S.D.N.Y. 2024) | Ministerial efforts still satisfy "efforts of others" |
| 6 | SEC Feb 2023 Kraken settlement; SEC Aug 2025 liquid-staking staff statement | Custody/pooling/rate-decoupling triggers; the plain-staking safe conditions; restaking excluded |
| 7 | *SEC v. VALIC*, 359 U.S. 65 (1959) | "Insurance" labeling doesn't exempt without genuine risk transfer |
| 8 | SEC/CFTC 2026 interpretive framework; Commissioner Peirce, "Headstands and Summervaults" (July 22, 2026) | Substance-over-form; warning against structural gymnastics |
| — | Maple Finance / Goldfinch / Centrifuge (Reg D 506(c) + KYC tranches) | The rejected-as-default alternative path |
| — | Nexus Mutual / Sherlock; Aave Safety Module / Umbrella | Third-party coverage and reserve-fund comparators (items #3–4) |

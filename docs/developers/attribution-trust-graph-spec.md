# Attribution v3 — Trust Graph Spec

> **Status (2026-08-18):** ⚠ **Phases 1–6 below (the trust graph, contextual projection, org
> tiering, card-limit nesting, pluggable connectors, the ERC-7579 hook) are design-only —
> deliberately NOT started.** They were scoped, then correctly identified as premature: Attribution
> gates nothing live in the app today, so building a much more sophisticated scoring engine for a
> signal nothing consumes yet is solving a problem in the wrong order. **Build these only when a
> real consumer forces the question** (an actual org/team wanting tiered access, a card product
> that actually needs underwriting logic) — not speculatively. This spec stays as the design record
> so the thinking isn't lost, not as a build queue.
>
> **What actually shipped from this spec: Phase 0 only** (see §9) — the real, present-tense EAS
> attestation bug, plus a *flat* (non-computed, non-tiered) org-membership primitive that turned
> out cheap enough to be worth building on its own merits, independent of everything else here.
> Nothing in this document is built or live except where explicitly marked `[EXISTS]` or `[SHIPPED]`.
>
> **Author:** Attribution team · **Target engine version (if Phase 1+ is ever picked back up):** `attribution-v3.0.0`

---

## 1. Why v3 — what v2 gets wrong once campaigns are gone

v2 fixed the legacy score's worst defect (Sharing at 43% of the total) but kept the same shape:
seven weighted signals, summed. That shape was built for one job — sizing campaign reward
multipliers — and that job is gone (`.claude/rules/rewards.md`, campaigns shelved 2026-08-12).

An audit of every live call site (`docs/developers/attribution-trust-graph-audit.md` §3, folded
into this spec's Appendix A) found score/tier/percentile gate **nothing** in the live app today
except badge color. The only place it was ever load-bearing — reward multipliers — lived in the
dead campaign engine or an inconsistent, partially-testnet vault-weighted rail.

The deeper problem isn't that nothing reads the score. It's that **600 of 925 points
(Volume+Trading/Activity+Holding+Liquidity) answer "how much has this wallet transacted,"** which
is a loyalty metric, not a trust one. Nobody needs your lifetime swap volume to decide whether you
should get a treasury vote or a network-state membership credential — they need to know who
vouches for you, and how much *their* standing is worth.

**v3 inverts the shape**: standing is computed as a recursive trust graph (who vouches for whom,
weighted by the voucher's own standing), and today's financial signals stop being the score —
they become the **collateral that backs a vouch's weight**. A referral from a wallet with real
locked liquidity moves the graph; a referral from an empty wallet moves it almost nothing. This is
a structural sybil defense, not a heuristic one — see §3.2.

## 2. What's kept from v2 unchanged

- **All seven `lib/attribution/signals.ts` computations** `[EXISTS]` — Volume, Holding, Activity,
  Longevity, Liquidity, Network (additive form), Governance. These become inputs, not outputs. See
  §3.3 for how.
- **The Risk penalty model** `[EXISTS]` (`signals.ts:136-155`) — sanctions/mixer/scam/wash/sybil
  deduction. Unchanged; a graph doesn't need less risk-awareness than a sum did.
- **The sybil detector** `[EXISTS]` (`lib/attribution/sybil.ts`) — kept as an independent circuit
  breaker layered on top of graph trust, not replaced by it. A wallet can have real collateral
  *and* trip `confirmedRing`; both should matter.
- **The data-provider chain** `[EXISTS]` (Etherscan → Zerion → mock, `provider.ts`) — unchanged.
- **The `TrustSource` pluggable-signal port** `[EXISTS]` (`lib/x402/trustSources.ts`) — this is the
  generalization target for §6. Its shape (`{ percentileOf(address): Promise<number> }`) is
  reused, not redesigned, for org-defined signal sources.

## 3. The trust graph model

### 3.1 Core computation

```
trust(B) = normalize( Σ_A  trust(A) × edgeWeight(A → B) )   for every A vouching for B
```

Computed by power iteration (standard EigenTrust form) to convergence, re-run on a schedule (not
per-request — this is a batch job, not a live query). Two properties this buys, both absent from
v2's additive sum:

- **Recursive, not additive.** A vouch from someone with real standing counts more than ten
  vouches from freshly-created wallets — closes exactly the gap that let $100M+ drain from
  Optimism/Arbitrum grant sybils (additive stamp-style scoring has no defense against this by
  construction; a graph does).
- **Bounded by real trust mass.** A sybil ring bootstrapped only by itself converges toward zero,
  because nothing in the ring has real inbound trust to begin with.

### 3.2 Edge weight — where financial signals go

```
edgeWeight(A → B) = baseWeight(edgeType) × collateralFactor(A)
```

`collateralFactor(A)` is derived from A's existing v2 financial signals — specifically Liquidity,
Holding, and Longevity (the three that are genuinely expensive to fake). It is **not** a new
computation; it's `logCurve` output already produced by `signals.ts`, repurposed as a weight
instead of a summand:

```ts
// lib/attribution/trustGraph.ts (new)
function collateralFactor(signals: SignalScores): number {
  // 0..1, saturating — reuses existing signal outputs, computes nothing new
  return clamp01(
    0.5 * (signals.liquidity / WEIGHTS.liquidity) +
    0.3 * (signals.holding   / WEIGHTS.holding) +
    0.2 * (signals.longevity / WEIGHTS.longevity)
  )
}
```

`baseWeight(edgeType)` is a small fixed table, not a design decision this spec needs to over-fit —
tune during implementation:

| Edge type | Source (today) | Base weight |
|---|---|---|
| Referral | `referral_records` `[EXISTS]` | 1.0 |
| Delegation | Governance signal's raw input `[EXISTS]` | 1.2 (an explicit delegation is a stronger vouch than a referral) |
| Team/community co-lock | Matched-liquidity vault deposit `[NEW — read from vault deposit events]` | 1.5 (real capital locked together is the strongest available signal) |
| Explicit vouch | New `Vouch` EAS schema, §5 | configurable per-issuer |

### 3.3 Bootstrap / seed trust

Every recursive trust system needs a pretrusted seed set to avoid the cold-start "everyone is
zero" trap (EigenTrust's own paper requires this). **v2's existing additive score is that seed —
this is the migration story, not a new component.** Wallets with today's highest v2 scores (real,
tenured LPs) seed `trust₀`; the graph computes forward from there. No backfill, no separate
genesis-list curation.

### 3.4 Independent circuit breakers stay independent

`sybilRiskFlag()` and the sanctions hard-gate (`chainalysis.ts`) are **not folded into the graph
math** — they remain a separate penalty applied after `trust(B)` is computed, same as v2's Risk
deduction today. A wallet with real collateral and a confirmed sybil-ring flag should still be
penalized; the graph doesn't get to override that.

## 4. Contextual projection — "allocate, don't globalize"

One graph, computed once. Different **projections** per consuming context, because what should
count toward a vault deposit ceiling, a governance vote, and a network-state membership credential
is not the same thing:

```ts
function projectTrust(graphTrust: number, collateralFactor: number, edgeMix: EdgeMix, context: Context): number {
  const w = CONTEXT_WEIGHTS[context]
  return w.trust * graphTrust + w.collateral * collateralFactor + w.tenure * edgeMix.tenureShare
}

const CONTEXT_WEIGHTS: Record<Context, { trust: number; collateral: number; tenure: number }> = {
  vault_access:   { trust: 0.4, collateral: 0.5, tenure: 0.1 },  // skin in the game matters most
  governance:     { trust: 0.7, collateral: 0.1, tenure: 0.2 },  // discount capital, don't let whales buy votes
  org_tier:       { trust: 0.5, collateral: 0.2, tenure: 0.3 },  // org's own policy overrides this default, see §7
  network_state:  { trust: 0.6, collateral: 0.1, tenure: 0.3 },  // membership should be earned, not bought
}
```

This is the direct fix for today's documented inconsistency (Appendix A, item 12): four reward
rails each treating Attribution differently with no canonical answer. Under v3 there is one
canonical trust computation and an explicit, per-context weighting function — not four ad hoc
postures.

## 5. New attestation schemas (EAS, chained via `refUID`)

Building on the four existing schemas `[EXISTS]` (`AttributionScore`, `SwapActivity`,
`ReferralLink`, `CampaignReward` — `.claude/rules/web3.md`), which are **not currently chained**
despite EAS supporting it:

- **`Vouch`** — `{ voucher: address, vouchee: address, weight: uint8, context: string }`. An
  explicit peer endorsement, `refUID`-chained to the voucher's own `AttributionScore` attestation
  so a vouch's weight is auditable against the voucher's standing at time of issuance.
- **`OrgMembership`** — `{ org: address, member: address, role: string, tier: string, joinedAt: uint64 }`.
  Issued by an org's own signer (not Mintware's oracle), `refUID`-chained to the member's base
  identity. This is the primitive §7's tiering reads.

Both are additive schema registrations — no change to the four existing ones beyond starting to
chain them (fixes Appendix A item 9 as a side effect: `CampaignReward`-style attestations
referencing the `AttributionScore` that qualified them).

## 6. Pluggable signal sources — generalizing `TrustSource`

`lib/x402/trustSources.ts` `[EXISTS]` already defines the exact interface needed:

```ts
export interface TrustSource {
  percentileOf(address: string): Promise<number>  // 0-100
}
```

Today it has two implementations, both x402-specific (`parkedSizeTrustSource`,
`attributionTrustSource`). §6 generalizes this to org-configurable, non-financial sources — same
interface, new implementations, each a thin adapter over a read-only external API:

| Source | What it reads | Effort |
|---|---|---|
| GitHub | Commits/PRs/issues via OAuth | Low — standard OAuth read |
| Linear/Notion/Jira | Tasks completed via webhook or API | Low-Medium — org already uses one |
| Snapshot | Governance votes via subgraph | Low |
| Coordinape | Peer-allocated GIVE via API | Low |
| Talent Protocol | Composite Builder Score via API | Low — one call replaces several |

An org's `OrgMembership` tier policy (§7) picks which `TrustSource`s it weights and by how much —
this is org-side configuration, not new Mintware infrastructure per source beyond the adapter
itself.

## 7. Org tenancy — tiered access

Reuses real, already-built multi-tenant infrastructure `[EXISTS]`:
`MintwareTreasuryVaultFactory`/`Registry`/`Deployers` (`contracts-v4/src/payments/`, CREATE2,
`onlyFactory`-gated, two-phase ownership) and Privy's email/social-login embedded-wallet
provisioning (zero new wallet infra needed).

Flow: org registers → gets a treasury vault instance via the factory → invites a roster → each
person's first login auto-provisions a Privy embedded wallet → org issues `OrgMembership`
attestations → org defines its own `CONTEXT_WEIGHTS.org_tier`-style policy (which `TrustSource`s
it cares about, how it weights trust vs. collateral vs. tenure) → that policy, not global code,
decides what "Contributor" vs. "Core" vs. "Treasury Signer" unlocks: vault deposit ceiling,
treasury spend authority, card limit (§8), governance weight within that org's instance.

**New work, scoped:** org-onboarding flow (roster invite → provision → attest), a tier-policy
config surface (admin picks `TrustSource`s + weights), and reading org-scoped tier alongside
global trust in the authorization path.

## 8. Team-issued cards with spend limits

Reuses `MintwarePaymentGateway`'s existing hybrid permit scheme `[EXISTS]`
(`< $250` long-lived `DelegatedSpendPermit`, `≥ $250` short-lived signed hold) — same contract
mechanism, issuer changes from self to an org's Treasury Signer role, funding source changes from
a personal LSA position to the org's own treasury vault (§7).

**The one genuinely new piece:** `services/edge-auth`'s authorization bound model `[EXISTS]`
(`portfolio::PortfolioGuard` — per-user equity, daily cap, global liquidity) needs a fourth,
nested bound: the person's `OrgMembership`-tier ceiling, sitting inside the org's total treasury
liquidity, sitting inside the vault's own solvency bound. Everything else — Privy delegation
revocability, Circle CPN/Visa settlement — is unchanged infrastructure.

This stays on the safe side of the regulatory line established in the Attribution 3.0 research
pass: an org spending its own collateral via tiered, delegated permission is an expense-management
product (Brex/Ramp's category), not credit extension. FCRA/ECOA/AI-Act don't engage.

## 9. Phased build plan

**Phase 0 — foundation fixes. `[SHIPPED]`** No new architecture; fixed real, present-tense bugs
(Appendix A) regardless of anything else here:
- ✅ Fixed the EAS attestation schema drift — `mapV2SignalsToLegacyFields()` in `lib/rewards/eas.ts`
  replaces the silent `.find(key === 'trading')` bug with an explicit, tested mapping. A ready-to-
  register v3 schema (`SCHEMA_ATTRIBUTION_SCORE_V3`) covering all 7 real signals + risk sits behind
  `NEXT_PUBLIC_EAS_SCHEMA_ATTRIBUTION_SCORE_V3` — attestScore() switches to it automatically once an
  operator registers it on-chain; falls back to the legacy mapping until then.
- ✅ Added optional `refUID` chaining to all five attest functions (`attestScore`, `attestSwap`,
  `attestReferral`, `attestReward`, `attestOrgMembership`) — infrastructure only; no caller wires a
  real chain yet, by design (see the over-engineering note above — wiring one wasn't a bug fix).
- ✅ Added `OrgMembership` (§5) — but note the scope cut from the original design: **flat**, no
  `Vouch` schema, no tier weighting, no `TrustSource` plugging. Ships as its own thing (§9a) because
  it turned out cheap and immediately useful for "get a team wallets + a real onboarding flow" —
  not because Phase 1's trust graph got built underneath it. It reads nothing from a graph that
  doesn't exist.

**§9a — Org tenancy (flat), shipped alongside Phase 0.** Not part of the original phased plan;
added because the underlying multi-tenant treasury infrastructure `[EXISTS]`
(`MintwareTreasuryVaultFactory`/`Registry`/`Deployers`) was sitting mostly unused past one instance,
and exposing it needed no new architecture:
- `orgs` / `org_members` tables (`supabase/migrations/20260818000001_org_tenancy.sql`)
- `POST /api/orgs` — create an org (signed-message auth)
- `POST /api/orgs/[id]/invite` — email-invite a teammate (owner-only)
- `POST /api/orgs/accept` — wallet claims a pending invite, issues the `OrgMembership` attestation
- **Explicitly NOT built:** deploying a per-org treasury vault from app code. The converged vault
  uses a delegatecall-linked library that only Foundry's linker handles correctly — same reason
  `app/api/(admin)/oracle/deploy-ypn-v2-testnet/route.ts` is deprecated in favor of
  `forge script contracts-v4/script/DeployTreasuryV2.s.sol --broadcast`. `orgs.treasury_vault_address`
  is nullable and set manually by an operator after that real deploy step — no app code assumes or
  triggers it.
- **Also NOT built:** any tier/role weighting, spend-limit nesting, or frontend UI. `role` on
  `org_members` is free text an org sets; nothing reads or weights it. If that's wanted later, it's
  a real forcing-function moment for Phase 1+ — not before.

**Phase 1 — trust graph core** (this spec's central dependency — nothing downstream is real
without it): `lib/attribution/trustGraph.ts` — edge collection (referral/delegation/vouch),
`collateralFactor()`, power-iteration convergence, seeded from today's v2 score.

**Phase 2 — contextual projection** (§4): `projectTrust()` + the `CONTEXT_WEIGHTS` table.

**Phase 3 — org tenancy** (§7): onboarding flow, tier-policy config, `OrgMembership` issuance.

**Phase 4 — card spend nesting** (§8): the fourth bound in edge-auth's `PortfolioGuard`.

**Phase 5 — pluggable connectors** (§6): generalize `TrustSource` consumers beyond x402; ship the
GitHub adapter first (lowest integration cost, most universally applicable).

**Phase 6 — on-chain enforcement**: an ERC-7579 hook module that reads live trust-graph state
before authorizing vault/card actions, via the existing Privy↔ZeroDev partnership. Highest
technical risk of the six phases; sequenced last on purpose.

## Appendix A — known v2 issues carried forward (fix in Phase 0 regardless of v3)

1. EAS attestation schema silently zeros `scoreTrading`/`scoreSharing` (keys that no longer exist
   in v2) and never attests `activity`/`longevity`/`network` (`lib/rewards/eas.ts` vs.
   `lib/attribution/signals.ts` key mismatch).
2. Sybil `confirmedRing` detector can structurally never fire — its three required features are
   always defaulted (`lib/attribution/providers/referrals.ts:61`).
3. Percentile has never been a real population rank — calibration machinery exists
   (`calibration.ts`) but is never wired into `computeScore()`.
4. Leaderboard and OG-image generator still read the old external scoring worker; every other
   surface reads in-repo Engine v2 — scores can silently disagree across surfaces.
5. Reward-weighting posture is inconsistent across four rails (binary gate vs. continuous
   multiplier, fail-open vs. fail-closed, or ignored entirely) — see §4 for the v3 fix.

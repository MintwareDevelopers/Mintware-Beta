# Phase 3 — RWA Create Flow + Threshold Seeding (Design Brief)

**Status:** Proposal → for review
**Branch:** `feature/phase-3`
**Created:** 2026-07-27
**Parent:** [`phase3-two-surface-architecture.md`](phase3-two-surface-architecture.md)

This brief fills a gap the two-surface architecture doc left open: **how vaults are actually
created and seeded**, how the **RWA create flow differs from DeFi**, and how teams attach
**deal details** to an RWA vault. It is grounded in a full audit of the current codebase
(see "Current state" below) — every "EXISTS" is real, every "PROPOSED" is new work.

Two decisions are already locked by the founder (2026-07-27):
- **S-1 · Seed growth = proportional.** When a seeding pool passes its deploy threshold and more
  seed arrives, it is added to keep the pair balanced (no price move) — a fair-launch bootstrap,
  not single-sided imbalance.
- **S-2 · RWA deal page = model on a proven platform.** Anchor on **Centrifuge** (pool + asset
  originator + data-room + NAV), borrow **Ondo's** NAV/price clarity and **Maple's** redemption UX.
  Rationale under §4.

---

## 1. Current state (audited 2026-07-27)

| Capability | Status |
|---|---|
| DeFi create wizard (4-step) + `seedTeamTokens` one-shot full seed | **EXISTS** — `app/(rewards)/vault/create/page.tsx`, `SocialVault.sol` / `MintwareDeFiVault4626.sol` |
| Surface (DeFi/RWA) selector in create flow | **ABSENT** |
| RWA create / onboarding flow (UI, API, DB) | **ABSENT** |
| Threshold / partial-fill / "live at X% full" / public co-seed / funding target | **ABSENT** (not built, not documented) |
| RWA contracts — vRWA, oracle bands, SPV/KYC registries, escrow, 30-day async redeem | **EXISTS** — `contracts-v4/src/rwa/**` (testnet target; mainnet gated on legal) |
| RWA frontend — detail / issuer / redemptions | **EXISTS as mockups** behind `NEXT_PUBLIC_ATX_PREVIEW`, mock data only |
| RWA persistence (issuer / redemption / deal tables) | **ABSENT** — only `social_vaults.surface` + registry columns exist |
| Team-attached deal details / links / documents / price explainer | **ABSENT** — closest is a hardcoded one-line `descriptor` + mock `transparency[]` + opaque on-chain `metadataHash` |

**Takeaway:** the contracts and the pretty pages exist on both surfaces; the *process that connects
them* — create → seed → go-live, and (for RWA) the deal page teams fill in — does not.

---

## 2. Seeding model — proportional threshold raise (PROPOSED)

Today: one `seedTeamTokens` call, team funds the **entire** pool, it goes live instantly. That
excludes the public from bootstrapping and forces the team to hold both sides.

Proposed: a **fair-launch bootstrap** where the team provides the project-token reserve and the
public co-seeds the quote side, gated by a deploy threshold, growing proportionally (decision S-1).

### 2.1 Parameters (team sets at create time)

| Param | Meaning | Example (SHIB/USDC) |
|---|---|---|
| `project_token` | The token side the team supplies | SHIB |
| `quote_token` | The paired quote (public co-seeds this) | USDC |
| `target_price` | Initial price the pool deploys at | team-set |
| `token_reserve` | Full project-token side, escrowed up front by the team | $10K of SHIB |
| `team_quote` | Quote the team pre-funds | $4K USDC |
| `public_quote_target` | Quote left for the public to seed | $6K USDC |
| `deploy_threshold_pct` | % of quote target that unlocks go-live | 50% → $5K total quote |
| `raise_deadline` | If threshold not met by here → refund | e.g. 14 days |

### 2.2 Lifecycle (new statuses on `social_vaults.status`)

```
draft → seeding → threshold_met → live → grown/closed
                       │
             (deadline passes, below threshold) → refunding
```

- **seeding** — team's `token_reserve` is escrowed; team + public quote accumulate in escrow.
  Nothing is tradeable yet. A **fill bar** shows `quote_raised / (team_quote + public_quote_target)`.
- **threshold_met** — quote crosses `deploy_threshold_pct`. The V4 pool deploys at `target_price`
  with the *balanced* amount available (matched token vs. quote), the rest of the reserve held back.
- **live** — pool is trading. **Proportional growth:** each new quote deposit is matched 1:1 in
  value from the held-back `token_reserve` and added to the live range — depth grows, price doesn't.
- **grown / closed** — reserve fully deployed, or team closes.
- **refunding** — deadline hit below threshold → escrowed quote returned to public, reserve to team.

### 2.3 Worked example (the SHIB case)

Team wants a $10K-SHIB / $10K-USDC pool. Team escrows **$10K SHIB** + **$4K USDC**; **$6K USDC**
is the public allocation. `deploy_threshold_pct = 50%`.

1. Public seeds USDC; at **$1K public** ($5K total quote = 50% of $10K), threshold is met.
2. Pool **deploys** with $5K USDC matched by $5K of the SHIB reserve. $5K SHIB stays in reserve.
3. Public keeps seeding; each USDC deposit pulls matching SHIB from reserve into the range — TVL
   climbs from $10K toward $20K, price stable.
4. At $6K public seeded, reserve is fully deployed → **grown**.

### 2.4 What this needs

- **Contract (NEW):** a bootstrap/escrow module — `openSeed(cfg)`, `contributeQuote(amount)`
  (public), `finalizeSeed()` (deploy at threshold), `growLiquidity()` (proportional add),
  `refund()` (deadline miss). Heavier than `seedTeamTokens`; needs its own tests + audit.
- **Schema (NEW):** on `social_vaults` (or a `vault_seeding` child): `token_reserve`,
  `team_quote`, `public_quote_target`, `quote_raised`, `deploy_threshold_pct`, `raise_deadline`,
  and the new statuses. Plus a `seed_contributions` ledger (wallet, amount, tx, refunded).
- **Frontend (NEW):** create-flow fields + a public **"Seed this vault"** panel with the fill bar,
  and the state machine surfaced on the vault card/detail.

> Applies to **both** surfaces — a DeFi meme pool and an RWA deal can both raise this way. The
> difference is what's on the deal page (§3), not the seeding mechanic.

---

## 3. RWA create flow + deal page (PROPOSED)

The DeFi wizard is 4 steps of pool mechanics. RWA needs those **plus** the deal narrative,
documents, issuer identity, and redemption terms — the part that's currently 100% mock.

### 3.1 Surface split in the create flow

Add **Step 0 — Surface** (DeFi / RWA). DeFi → existing wizard (+ optional threshold seeding).
RWA → the augmented wizard below. Persist `surface` (column already exists).

### 3.2 RWA create wizard (augmented)

| Step | Fields | Backed by |
|---|---|---|
| 0 · Surface | DeFi / RWA | `social_vaults.surface` (EXISTS) |
| 1 · Issuer | Select/registered issuer; issuer must be **VERIFIED** to publish | `SPVAssetProviderRegistry` (EXISTS) + new `vault_issuers` table |
| 2 · Instrument | `vRWA` name/symbol, underlying asset class, reserve/yield split (40/60), oracle bands (±15/±45) | `MintwareVRWA`, `MintwareRWAVault4626`, `MintwareOracleHook` (EXIST) |
| 3 · Deal details | Description, **yield-source explainer**, **price/NAV explainer**, target APY, min investment | new `vault_deals` table |
| 4 · Data room | External links + documents (term sheet, legal opinion, SPV structure, audit) — each with a **review status** | new `vault_deal_documents` |
| 5 · Redemption | 30-day window, KYC tier required to redeem, settlement terms | `MintwareRWAVault4626.requestRedeem` + `SPVBeneficiaryRegistry` (EXIST) |
| 6 · Review + submit | Goes to **Mintware review** before public (trust gate) | new `review_status` on `vault_deals` |

### 3.3 Deal page anatomy (Centrifuge-modeled — decision S-2)

Maps 1:1 onto contracts we already have:

| Deal-page block | Source | Model borrowed from |
|---|---|---|
| Header: deal name · issuer (linked) · status · KYC badge | `vault_deals` + issuer registry | Centrifuge pool header |
| Key terms strip: target APY · TVL · min · settle window · price band · reserve ratio | `vault_deals` + `MintwareRWAVault4626` / `MintwareOracleHook` | Ondo fund summary |
| Overview + **yield-source** + **price/NAV explainer** (team-authored) | `vault_deals` (NEW fields) | Ondo NAV clarity |
| Structure: SPV wrapper · tranche/reserve 40/60 · guardian/freeze · who can redeem | rwa contracts (EXIST) | Centrifuge pool structure |
| Data room: links + documents, each with review badge | `vault_deal_documents` (NEW) | Centrifuge investment docs |
| Issuer track record + transparency (VERIFIED badge) | `vault_issuers` (NEW) backing `lib/rwa/issuer.ts` | Maple delegate/originator profile |
| Redemption/claim: request → 30-day window → settle | `MintwareRWAVault4626` + `PVDistributionEscrow` (EXIST) + `vault_redemptions` (NEW) | Maple withdrawal UX |

**Why Centrifuge as the anchor:** our on-chain shape (asset-originator registry, SPV wrapper,
tranche/reserve, oracle NAV, async redemption) is a near-exact match for Centrifuge's
Pool / Issuer / NAV model — so copying its deal-page IA is the lowest-friction, highest-trust path.
Ondo is the reference for a clean single-number NAV/price explainer; Maple for the
borrower/redemption UX. We are not copying tokenomics — only the **information architecture** proven
by billion-dollar RWA platforms.

### 3.4 Trust gate (why "reviewed", not free-for-all)

RWA carries real legal/scam liability. Issuer must be **VERIFIED** in the registry, and deal
content (esp. documents + price claims) passes **Mintware review** (`review_status: draft →
in_review → approved`) before it's public. This mirrors the on-chain guardian/kill-switch already
in the contracts — trust enforced at both the content and code layer.

---

## 4. Proposed build sequencing

1. **This brief → plan of record** (review + adjust).
2. **RWA persistence + surface-split create flow (no new contracts).** New tables
   (`vault_issuers`, `vault_deals`, `vault_deal_documents`, `vault_redemptions`), Step-0 surface
   selector, RWA wizard steps 1–6, and wire the existing RWA mockups to real data. *Shippable to
   testnet without touching contracts — biggest visible progress, lowest risk.*
3. **Threshold seeding contract + escrow** (§2.4). New module, tests, audit. Applies to both surfaces.
4. **Deal page (Centrifuge IA)** on real data + review workflow.
5. **Redemption queue** wired to `requestRedeem` / `PVDistributionEscrow`.

Legal Track E (SPV, KYC vendor, issuer partner) runs in parallel and gates RWA **mainnet** —
not testnet build.

---

## 5. Open questions

- Seed threshold default (%) and whether teams can set it, or it's fixed platform-wide.
- Refund UX on a failed raise — auto-refund vs. claimable.
- Which KYC vendor backs `SPVBeneficiaryRegistry` at redemption (Track E).
- Do DeFi vaults get threshold seeding in v1, or RWA-first?

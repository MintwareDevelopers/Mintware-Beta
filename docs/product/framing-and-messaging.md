# Mintware — Framing & Messaging (Source of Truth)

The canonical description of what Mintware **is now** and how to talk about it. All website
copy, docs, decks, and social should draw from this. If a page contradicts this document,
the page is wrong.

> **Direction (2026-08):** Mintware is the on-chain **reputation layer for DeFi**. The RWA
> surface was **shelved** (preserved on `archive/rwa-surface`, not live). Do **not** market RWA,
> "wrapped real-world assets," "the wrapper," SPVs, accreditation, or "securities dealer" framing
> anywhere public. That is a former direction, not the product.

---

## 1. The one-liner

**Mintware is reputation-weighted DeFi.** Attribution scores on-chain behavior; rewards,
liquidity vaults, and agents route value by the score — so contribution, not wallet size,
decides what you earn.

The problem we fix (say it once): **DeFi incentives attract the capital you least want —
mercenary money that farms an emission and leaves.** The root cause is rewards priced by the
size of your wallet instead of the quality of your contribution. Attribution prices the
contribution; the vaults and rewards pay it.

## 1a. Messaging hierarchy (locked 2026-08-07)

Four layers, each with a home. **Never stack the mission line and the product tagline in the
same hero** — the mission is the *why*, the tagline is the *what*.

| Layer | Line | Where it lives |
|---|---|---|
| **Mission** (the why) | *Liquidity should be a public good.* | About page, deck opener, founder's note — **never** a product hero. |
| **Tagline** (the what) | *Own your share of the market you make.* | Homepage hero, primary product surfaces. "Your share" = your LP position — literally true. |
| **One-liner** (the how) | *Mintware is reputation-weighted DeFi: Attribution scores on-chain behavior, and rewards, vaults, and agents route value by the score.* | Sub-heros, meta descriptions, opening paragraph. |
| **Villain** (the wedge) | *Most launches concentrate liquidity in insider wallets, rent mercenary capital for a week, and leave retail holding a market that can be pulled out from under them.* | "The problem" sections; every page ladders back to this. |

**Ownership-language rule.** Say *"your share"* / *"own your LP position"* / *"a market owned
by its LPs, not one treasury."* Do **NOT** say **"community-owned"** for the matched vault's
*team* liquidity — that liquidity is **locked, matched, and fee-redirected under transparent
on-chain rules**, not transferred to community ownership. The precise claim is the stronger claim.

## 2. The three groupings

Every feature maps to one of three (this is the architecture *and* the audience story):

| Grouping | What it is | Public framing |
|---|---|---|
| **Web2** | UI, fast APIs, indexing, off-chain auth | "The interface + the scoring engine" |
| **Web3** | Wallets, contracts, on-chain reads/writes | "Where reputation is enforced on-chain" |
| **Rewards** | Referrals, points, distribution, claims, vaults, anti-abuse | "The core — value routed to real contribution" |

Rewards is the core pillar. Everything else exists to get value to the user for their on-chain
behavior.

## 3. The surfaces (and their honest status)

| Surface | What it does | Status — say exactly this |
|---|---|---|
| **Attribution** | On-chain reputation score (max **925**), 100+ chains, EAS-attested | **Live.** The scoring API and explorer are real today. |
| **DeFi liquidity vaults** | Reputation-weighted Uniswap V4 LP — single-sided + dual-sided pair vaults | **Built & tested, not yet deployed.** Say "coming" / "in testing" — never "live" or "deposit now." |
| **AI agents** | ERC-8004 identity + AIAttribution scoring, agent leaderboard | **Live** (Base). |
| **Swap** | Best-execution cross-chain routing (LI.FI) | Live UI on real data. |

> **Campaigns were shelved (2026-08-12)** — removed from the platform, preserved on
> `archive/campaigns-surface`. Do not describe reward campaigns / token-reward pools / points
> campaigns as a live product.

**Never** imply the vaults hold real deposits today. They are feature-flagged off, undeployed,
and (when deployed) start on **Base Sepolia testnet**. See `phase3-golive-runbook.md`.

## 4. The vaults — how to describe them (plain-English)

The vault line is now a **coherent family**:

- **A vault is a pair.** Dual-sided liquidity (USDC/ETH, USDC/PEPE, …) — both tokens, real LP.
  (A single-sided USDC vault also exists as the current deploy target; the pair vaults are the
  direction.)
- **Reputation-weighted rewards.** Swap fees + incentives are split so higher-Attribution,
  longer-locked LPs earn a bigger share. This is the anti-mercenary-capital mechanism.
- **Lock tiers** (Flex → Committed → Aligned → Core): longer commitment → higher multiplier;
  early exit pays a penalty that flows to the LPs who stayed.
- **Team-locked launch liquidity** (matched vault): a team locks its token liquidity, the
  community matches it, the team provably can't pull it for ≥3 months, and the community earns
  the team's forgone fees during the lock. Frame precisely: *"team liquidity is locked and
  matched by community capital under transparent on-chain rules"* — **not** "community-owned."

### Security posture (this is a real differentiator — lead with it, honestly)

- **Built security-first** ("don't become the next Bunni"): a Stage-1 hardening gate shipped
  before any scaling — a **guardian kill-switch**, hardened idle-capital handling (destination
  allowlist + withdrawal-buffer invariant), and CEI/reentrancy discipline.
- **MEV-resistant hook**: a truncated-oracle price guard + deviation-priced dynamic fee — **no
  reliance on trader identity**, defends single- and multi-address attackers.
- **Verified, not asserted**: the core invariants are **fuzz-tested** (stateful invariant runs,
  128k calls) and the hook's swap hot path is **gas-benchmarked** well under the routing budget.
- Say **"independent audit pending"** — do **not** say "audited" until a Uniswap-whitelisted
  auditor has signed off (Stage 1.5). Non-custodial is fine to state (users hold keys/assets).

## 5. Claim guardrails — what we CAN and CANNOT say

**CAN say:**
- Attribution is live; max score **925**; 100+ chains; EAS-attested on Base.
- Vault reward split is **70 / 15 / 10 / 5** (LPs / referrers / protocol / bonus), Attribution- +
  lock-tier-weighted, distributed at epoch close.
- Non-custodial (users interact with vault contracts directly; keys via Privy).
- Reputation is portable, earned, and pays a bigger share of every pool you enter.

**CANNOT / MUST NOT say:**
- ❌ Anything RWA: real-world assets, wrappers, SPVs, "securities dealer," accreditation, the
  BlackRock precedent, 30-day RWA redemption. **Shelved — remove entirely from public copy.**
- ❌ "Audited" / "fully audited" (audit pending) · ❌ "risk-free" / "guaranteed" / fixed-APY
  promises · ❌ vaults "live" / "deposit now" (undeployed) · ❌ specific TVL or wallet-count
  stats (we don't publish them) · ❌ "KYC-free" as a selling point.

**Reputation-weighted-yield scope (confirmed against contracts 2026-08-07).** The
Attribution-weighted reward claim applies to the **Growth vault (FeeVault) only** today —
LP share = Attribution percentile × lock tier (real). The **matched liquidity vault pays
community fees pro-rata to deposit size** (per community liquidity unit — confirmed in
`MintwareMatchedLiquidityVault.sol`), **not** by Attribution / lock tier / referrals. Do **not**
claim reputation-weighted rewards for the matched vault; scope its copy to lock + match +
on-chain proof-of-commitment. (Eng task tracked to add weighting there; unblock this copy when it
ships.) Corollary: **do not imply reputation-weighting is universal / "everywhere you trade"** —
it is the Growth vault today. And do not brand **"AWY" / "Attribution-Weighted Yield"** as a
coined acronym yet; ship the mechanism in plain English until the term is earned in the wild.

## 6. Per-page direction (audit map)

| Page | Current | Action |
|---|---|---|
| `app/page.tsx` (landing) | Reputation-first ("One score. Three audiences.") | Keep; verify no vault-"live" overclaim. |
| `app/docs/page.tsx` | **Heavily RWA-issuer thesis** ("the wrapper," SPV, securities dealer) | **Reframe to reputation-first DeFi** — cut the RWA sections; center Attribution + the vault family + security. #1 priority. |
| `app/attribution/page.tsx` | Attribution scoring | Keep; ensure 925 / EAS / chains accurate. |
| `app/defi/page.tsx` | DeFi surface | Keep; align vault language to §4, mark vaults "coming/testnet," add the security framing. |
| `app/agents/page.tsx` | ERC-8004 agents | Keep. |

## 7. The elevator pitch (for decks / social)

> DeFi rewards the wrong capital — mercenary money that farms your emission and leaves.
> Mintware scores on-chain contribution (Attribution, live across 100+ chains) and routes
> rewards, liquidity vaults, and agents by that score. The vaults are dual-sided pairs with
> reputation-weighted fees, lock tiers, and team-locked launch liquidity — built security-first
> (kill-switch, MEV-resistant hook, fuzz-tested invariants) with an independent audit pending.
> Contribution, not wallet size, decides what you earn.

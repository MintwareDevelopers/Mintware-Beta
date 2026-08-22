# Mintware — Narrative Bible (Source of Truth)

The canonical description of what Mintware **is** and how to talk about it. Every hero,
page, doc, deck, and post draws from this. **If a page contradicts this document, the page is
wrong.** (Supersedes the 2026-08 "reputation-weighted DeFi" framing — reputation is now a
*pillar*, not the spine. See §0.)

> **What's shelved / off-limits publicly:** RWA (real-world assets, wrappers, SPVs, accreditation,
> "securities dealer") and reward **campaigns** (token-reward / points pools) are both **shelved** —
> preserved on archive branches, not the product. Never market either.

---

## 0. The golden thread (read this first)

**One thread, two altitudes.** The whole company is one idea seen at two zoom levels:

- **Zoomed out (the mission / movement):** *Liquidity should be a public good* — liquidity that
  isn't hoarded, locked, or extracted; it serves everyone.
- **Zoomed in (the promise to one person):** *Your liquidity, always working* — your capital isn't
  trapped or wasted; it's productive, liquid, spendable, and fairly rewarded. (Never *"made whole"* —
  it reads as a principal guarantee; see §4.)

They are the **same belief**, not two threads. The collective version is the banner; the personal
version is the hero. They must never be swapped (the mission line is not a product hero — see §1).

**The hero line IS the three pillars.** The tagline enumerates the proofs:

> ### Never idle. Never locked. Always yours.

| Clause | Means | Proven by |
|---|---|---|
| **Never idle** | *productive* — capital earns three ways at once | Vaults / ULV engine · Swap |
| **Never locked** | *liquid & spendable* — yield spendable at the point of sale; you spend from yield, not your position | Liquid Sovereign Account (YPN) |
| **Always yours** | *fairly earned + owned + non-custodial* — the best LPs earn the most; you hold your share and your keys | Attribution (fairness layer) · AI Agents · Privy custody |

Every page on the platform is demonstrating **one** of these three. That is the continuity test:
*which clause is this page proving?* If a section proves none of them, cut it.

---

## 1. Message hierarchy (the four altitudes)

**Never stack the mission and the hero in the same block.** The mission is the *why*; the hero is
the *what-you-get*.

| Altitude | Line | Lives on |
|---|---|---|
| **Mission** *(the movement / why)* | **Liquidity should be a public good.** | About page, the ethos band, deck opener, founder's note — the banner. **Never a product hero.** |
| **Hero / tagline** *(your personal promise)* | **Never idle. Never locked. Always yours.** <br/>sub: *Your liquidity, always working — earning around the clock, and its yield instantly yours to spend.* | Homepage hero, primary product surfaces. |
| **One-liner** *(the how)* | Your USDC earns three ways at once — Aave lending, Uniswap v4 market-making, and recaptured MEV — while staying liquid and spendable. And the LPs who bring real, committed liquidity earn the biggest share. | Sub-heros, meta descriptions, opening paragraphs. |
| **Villain** *(the wedge)* | DeFi makes you choose: your money *earns* — locked in a farm, illiquid, sitting next to mercenary capital — or it stays *usable* and earns nothing. **Never both.** Mintware ends the trade-off. | Every "the problem" beat; each page ladders back to this. |

**Ownership language ("always yours").** Say *"your share"* / *"own your LP position"* / *"a market
owned by its LPs, not one treasury."* Do **NOT** say **"community-owned"** for the matched vault's
*team* liquidity — that liquidity is **locked, matched, and fee-redirected under transparent on-chain
rules**, not transferred to community ownership. The precise claim is the stronger claim.

---

## 2. The three proofs (pillar → surface map)

### Never idle — *productive*
Capital never sits still. In the vault, idle USDC earns Aave lending yield, provides **just-in-time**
market-making liquidity on every swap, and **recaptures the MEV/LVR** that normally leaks to
arbitrageurs — three income streams on one balance.
- Surfaces: **Vaults / ULV engine**, **Swap** (best-execution cross-chain routing, LI.FI).
- Honest status: the ULV engine is **in testing on Base Sepolia** — "coming / in testing," never
  "live" or "deposit now." Swap is a live UI on real data.

### Never locked — *liquid & spendable*
The yield is **spendable at the point of sale**; principal is never locked or unwound. USDC in the
vault stays near par in an Aave buffer and settles a card swipe against that buffer — earn while you
spend.
- Surface: the **Liquid Sovereign Account** (Yield Payment Network).
- The blended-liquidity model: a market-maker anchors a **blended** position (e.g. 200 ETH +
  300k USDC), the public makes up the difference; the vault runs it as active v4 liquidity + an Aave
  buffer. **Not** a token launch, **not** a pure one-sided reserve.
- Settlement stack: **Arc** (USDC gas) · **Circle** (sub-350ms) · **Privy** (identity/custody) ·
  **Visa**. All **designed**, not shipped — "coming soon," on testnet, deployed ≠ audited.
- ⚠ AI Attribution is **not** part of the LSA story — keep it out of YPN copy.

### Always yours — *fairly earned + owned + non-custodial*
The LPs who bring real, committed liquidity earn the biggest share — reputation, not wallet size,
decides. You own your LP position and hold your own keys.
- Surfaces: **Attribution** (the fairness layer) · **AI Agents** (even autonomous agents earn by
  contribution) · **Privy** (non-custodial).
- Attribution is **live** (max score **925**, 100+ chains, EAS-attested on Base). Agents are **live**
  (Base, ERC-8004 + AIAttribution).
- ⚠ **Scope reputation-weighting honestly.** The Attribution- + lock-tier-weighted reward split
  (70/15/10/5 = LPs / referrers / protocol / bonus) applies to the **Growth vault only** today. The
  **matched vault pays community fees pro-rata to deposit size**, not by reputation. Do **not** imply
  reputation-weighting is universal / "everywhere you trade." Don't coin **"AWY / Attribution-Weighted
  Yield"** as an acronym until it's earned in the wild — ship the mechanism in plain English.

---

## 3. Primary hero + audiences

**Primary hero: the capital-holder** — the individual whose USDC finally works *and* stays spendable.
Lead voice everywhere unless a page is explicitly for another audience.

Secondary audiences (they appear, they don't lead the homepage):
- **Liquidity providers / market-makers** — "provide liquidity, get the most productive + fairest
  deal in DeFi." (DeFi / Vaults pages, the LSA "for market-makers" door.)
- **Protocols / teams** — deep, sticky, fairly-shared launch liquidity (matched vault). (Teams page.)
- **AI agents** — autonomous participants scored and paid by contribution. (Agents page.)

---

## 4. Vocabulary — always / never

**Always (the liquidity thread):**
- The spine: *never idle · never locked · always yours · your liquidity, always working.*
- *productive · liquid · spendable*; *earns three ways at once*; *stays spendable at the point of sale.*
- *your share · own your LP position · a market owned by its LPs.*
- *the LPs who bring real, committed liquidity earn the most.*
- *the code pays the community first, automatically — no admin override* — the sanctioned way to say the
  waterfall is code-enforced. It describes the payout *ordering* (senior/community before junior/team),
  which is a true, immutable code fact ([`docs/legal/tranche-legal-facts.md`](../legal/tranche-legal-facts.md)) —
  NOT a principal guarantee. Keep it paired with the mechanism ("redeemable at par *while covered*"), never
  as "your money is safe."
- *Liquidity should be a public good* — **mission altitude only.**
- Honest verbs for anything unshipped: *designed to · built to · coming · in testing.*

**Never:**
- ❌ The mission line ("public good") as a product hero.
- ❌ **"Reputation-weighted DeFi"** as the top-line spine (reputation is a *pillar*; weighting is
  Growth-vault-only) — and never imply reputation-weighting is universal.
- ❌ Any **RWA** framing · ❌ token-reward / points **campaigns** (both shelved).
- ❌ **"Audited" / "fully audited"** (say *"independent audit pending"*).
- ❌ **"community-owned"** for the matched vault's team liquidity.
- ❌ **"risk-free" / "guaranteed" / fixed-APY** promises · ❌ vaults **"live" / "deposit now"** (undeployed).
- ❌ **"made whole" / "principal protected" / "fully backed" / "par-safe" / "your dollar is safe"** — any
  wording that implies a principal guarantee. Say the *mechanism* instead: senior is **redeemable at par
  while the treasury covers it**, the junior tranche **absorbs losses first**, and a tail event is a
  transparent **pro-rata haircut** — a waterfall, not a promise. And say *"spend from yield, not your
  position"* — never *"principal never touched / never moves."*
- ❌ Specific **TVL or wallet-count** stats (we don't publish them) · ❌ **"KYC-free"** as a selling point.
- ❌ Coined acronyms not yet earned (e.g. **"AWY"**).

---

## 5. Tone & voice

- **Confident and plain-spoken.** Concrete over clever; the specific claim beats the vague boast.
- **Precise over hype** — "the precise claim is the stronger claim." Honesty about status *builds*
  trust; it's a feature, not a hedge.
- **Say it once.** One loud idea per band; don't restate the thesis three ways.
- **Security is a real differentiator — lead with it, honestly:** built security-first (guardian
  kill-switch, MEV-resistant truncated-oracle hook, fuzz-tested invariants at 128k+ calls,
  gas-benchmarked hot path), **independent audit pending**. Non-custodial throughout.

---

## 6. Honest status (what's live vs. coming)

| Surface | Status — say exactly this |
|---|---|
| **Attribution** (score, explorer, 925, 100+ chains, EAS) | **Live.** |
| **AI Agents** (ERC-8004 + AIAttribution, Base) | **Live.** |
| **Swap** (LI.FI best-execution routing) | **Live UI on real data.** |
| **Vaults / ULV engine** | **Built & tested, in testing on Base Sepolia.** Never "live" / "deposit now." |
| **Liquid Sovereign Account** (YPN) | **Coming soon.** Payment core deployed + on-chain-verified on Base Sepolia; edge-auth + relayer built & proven; **deployed ≠ audited.** |

**Never** imply the vaults or the LSA hold real deposits today.

---

## 7. Per-page application (which proof each page leads with)

| Page | Leads with | Opening move |
|---|---|---|
| `/` (home) | **The whole thread** | Hero: *Never idle. Never locked. Always yours.* → the three proofs become the page's three bands → scorer as the "always yours / fairly earned" proof. |
| `/yield-payment-network` (LSA) | **Never locked** | Spendable yield; the blended model; the epic tech; coming-soon waitlist. (Already aligned.) |
| `/vaults` + `/defi` | **Never idle** | The engine — three income streams on one balance; reputation share + ownership as the "always yours" tie-in; vaults "coming / testnet"; security framing. |
| `/attribution` | **Always yours** | Reputation as the fairness layer — honestly scoped to the Growth vault; 925 / EAS / 100+ chains. |
| `/agents` | **Always yours** (extension) | Even autonomous agents earn by contribution. |
| `/teams` | Secondary hero (protocols) | Deep, sticky, fairly-shared launch liquidity (matched vault, blended seeding, on-chain proof-of-commitment). |
| `/about` | **The mission** | *Liquidity should be a public good* — the banner, the why, the founder's belief. |
| `/docs` | The whole model | Structured by the three proofs; reputation-first framing removed; center the liquidity thread + security. |

---

## 8. Elevator pitch (decks / social)

> DeFi makes you choose: your money earns — locked away, illiquid, next to mercenary capital — or it
> stays usable and earns nothing. Mintware ends the trade-off. Your liquidity is always working: **never
> idle** (it earns three ways at once — Aave lending, v4 market-making, recaptured MEV), **never
> locked** (the yield is spendable at the point of sale; you spend from yield, not your position), and **always yours**
> (the LPs who bring real, committed liquidity earn the most; you hold your share and your keys).
> Built security-first, independent audit pending. Because liquidity should be a public good.

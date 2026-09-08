# Bridge-Stripe DDQ — Line-by-Line Working Answers

Tags: ✅ answerable now (drafted below) · ❓ factual, only you know it — don't let me guess · ⏳ still genuinely open · 🔨 an action item to actually build (MLRO/board/policy), not a form field to fake.

**2026-09 update — Bridge replied:** *"Most of this will be covered by Bridge and Stripe — we just need
the completed form to begin our internal assessment on supportability."* This confirms the read from
earlier: the actual KYC/AML/sanctions-screening **infrastructure** is theirs, not something Mintware
builds from scratch. Every AML/Sanctions item below that's a "do you have a program/process for X"
question is now answerable — but phrased precisely as *"via Bridge/Stripe's infrastructure,"* not a bare
unqualified "Yes" that would imply an in-house program that doesn't exist. That distinction matters if
Bridge's reviewers ever cross-check the wording against what they actually provide.

**Two things this reply did NOT resolve, and shouldn't be assumed into "most":**
1. **SOC 2 (IS-5)** — a different category entirely, about *Mintware's own* infosec practices, not the
   KYC/AML program. Treating it as still open until confirmed directly.
2. **Items that are Mintware's own governance, not screening infrastructure** — board-approved policy
   (AML-8), internal AML/CFT training (AML-9), and the named MLRO (AML-10) are things *Mintware* has to
   do regardless of whose tooling runs the actual checks. "Most of this will be covered" logically means
   the screening/detection layer, not Mintware's own internal accountability structure sitting on top of
   it.

## Business Overview

| ID | Answer |
|---|---|
| BO-1 | ❓ Need the actual **legal entity name** (LLC/Corp) — "Mintware" is the brand/DBA, not necessarily the registered legal name. Same open question as the UFSF application's legal-entity checkbox — worth resolving once, not twice. |
| BO-2 | ❓ Registered business address — only you have this. |
| BO-3 | ✅ `https://mintware.finance` |
| BO-4 | ❓ Country/revenue split — genuinely don't know your revenue distribution; given pre-real-revenue/testnet status this may honestly be "primarily US-based, pre-material-revenue." Your call how to phrase it truthfully. |
| BO-5 | ✅ Draft: *"Mintware is a non-custodial DeFi treasury platform. Customers (teams/organizations) create an org, invite members, deposit USDC into a treasury vault position that earns yield while remaining spendable, and issue cards to members for spend against that position. Customer journey: connect a Privy wallet → create/join an org → fund the treasury (deposit senior capital; the org's own capital backs a first-loss junior tranche) → accept Terms of Service → issue a card → spend, authorized against a role-based cap and a live balance check."* |

## Service Offering

| ID | Answer |
|---|---|
| SO-1 | ✅ (drafted in RD-1, needs counsel sign-off on the custody characterization specifically) — the card funding wallet is the member's own non-custodial wallet; the underlying treasury position is a smart-contract-pooled vault, not a company-held account. |
| SO-2 | ✅ USDC on Base. |
| SO-3 | ✅ Direct-pull model: a capped on-chain ERC-20 allowance is drawn at swipe time, not a traditional prepaid top-up balance. Mintware also runs a top-up mechanism that keeps the funding wallet stocked ahead of time, but the authorization decision itself is made by Bridge/Stripe, not computed by Mintware in real time. |
| SO-4 | Same as SO-1 — needs counsel's actual custodial/non-custodial determination, not an engineering guess. |

## Legal

| ID | Answer |
|---|---|
| L-1 | ❓ Have you actually engaged a lawyer on money-transmission/card-issuing requirements specifically? Only you know. |
| L-2 | ❓ Same — needs a real legal determination, not a self-assessment. |
| L-3 | Likely **No** honestly — no dedicated age/location-verification system is built today. Confirm before answering. |
| L-4 | Blank/N/A if L-3 is No. |
| L-5 | An acknowledgment you're agreeing to (reverse-solicitation-only, no active marketing outside the US), not a fact to answer — just needs your read and sign-off. |

## AML/KYC

| ID | Answer |
|---|---|
| AML-1 | ✅ **Yes** — "AML/KYC controls are provided via Bridge/Stripe's compliance infrastructure, which Mintware relies on as its issuing partner." |
| AML-2 | ✅ **Yes** — "via Bridge/Stripe's AML program, covering the applicable operational geography." |
| AML-3 | ✅ **Yes** — KYC performed via Bridge/Stripe's tooling on all customers. |
| AML-4 | ✅ **Yes** — verification accuracy is handled within Bridge/Stripe's KYC flow. |
| AML-5 | ✅ Likely **Yes** — Bridge/Stripe's risk-rating almost certainly covers the four listed factors (geographic risk, PEP, transactional red flags, product usage). Worth a one-line confirmation from them before checking this box confidently, since it's a compound question. |
| AML-6 | ✅ **Yes** — transaction monitoring via Bridge/Stripe. |
| AML-7 | ✅ **Yes** — SAR/regulator-filing sits with Bridge/Stripe as the regulated party in this structure. Worth confirming this framing matches what they mean by "covered," since Mintware itself won't be the one filing SARs. |
| AML-8 | 🔨 **Mintware's own item — not covered by Bridge's reply.** This asks whether *your* AML/KYC policy is board-approved. Even with screening on Bridge's infra, you need a short written policy stating that reliance + your own escalation process, approved by your own founders-as-board. |
| AML-9 | 🔨 Same category as AML-8 — annual AML/CFT training for your own team is still something *you* run, on top of Bridge's infrastructure. Achievable: one short annual session, documented. |
| AML-10 | 🔨 **Designate a real MLRO now** — doesn't need a hire, needs one of you to formally take the role in writing. Not resolved by Bridge's reply — this is Mintware's own named person regardless of whose tooling does the screening. |
| AML-11 / AML-12 | ✅ Likely **Yes**, via Bridge/Stripe's own source-tracing/sanctions-list tooling — worth a one-line confirmation this specific capability (wallet/source tracing, not just customer KYC) is included in "most of this." |

## Sanctions Compliance

| ID | Answer |
|---|---|
| SC-1 | ✅ **No** — Mintware does not support or conduct transactions involving sanctioned countries/persons. Safe to answer directly regardless of tooling. |
| SC-2 | Likely **No** (no full-time Sanctions Compliance Officer today) — this is a headcount fact, not a tooling one, so Bridge's reply doesn't change it. Confirm the honest number. |
| SC-3 | ✅ **Yes** — via Bridge/Stripe's screening at the point customers move funds/purchase. |
| SC-4 | ✅ Likely **No** — if Bridge/Stripe screens everyone regardless of transaction size, there's no unscreened tier. Worth a one-line confirmation there's no minimum-threshold exemption in their process. |
| SC-5 | ✅ Likely covers the standard lists (SDN, UN, UK HMT) via Bridge/Stripe — confirm which specific lists their screening covers before selecting all boxes. |
| SC-6 | ✅ Likely **"at onboarding" + "as lists are updated"** via Bridge/Stripe's ongoing rescreening — confirm their actual cadence. |
| SC-7 | ⏳ Geo-blocking specifically may or may not be something Bridge/Stripe handles vs. something expected at Mintware's own app layer — worth a direct one-line check, since this is more of a product/frontend control than a KYC-tooling one. |
| SC-8 / SC-9 | ✅ Likely **Yes**, via Bridge/Stripe's wallet-screening tooling — confirm it's included, same caveat as AML-11/12. |
| SC-10 | 🔨 Sanctions training for *your own* employees is Mintware's item, same category as AML-9 — not resolved by Bridge's reply. |

## Financial Crimes — General

| ID | Answer |
|---|---|
| FC-1 | ❓ Almost certainly **No** given the company's age and history, but this is a factual attestation about you and your co-founders personally — needs your direct confirmation, not my assumption. |
| FC-3 | ❓ Needs the real headcount number (likely 0 dedicated compliance FTEs today — fine to state honestly, especially now that the actual screening runs through Bridge/Stripe). |

## Information Security

| ID | Answer |
|---|---|
| IS-1 | ⏳ Worth checking — does Privy enforce 2FA/account-takeover protection by default? Confirm the actual auth configuration before answering. |
| IS-2 | ❓ Factual about your own internal tooling/practices — only you know. |
| IS-3 | ❓ Factual — almost certainly No given the company's age, but needs your direct confirmation. |
| IS-5 | **No** — no SOC 2 report exists. **Still open — Bridge's reply didn't address this specifically.** Worth a direct, separate follow-up (see below) rather than assuming it's folded into "most of this." |

## Consumer Disclosures

| ID | Answer |
|---|---|
| CD-1 | ✅ **Yes** — `https://mintware.finance/terms` already exists. |
| CD-2 | ✅ **Yes** — `https://mintware.finance/risk-disclosures` and `https://mintware.finance/legal` already exist and cover crypto risk disclosures. Real, already-built asset. |
| CD-3 | ❓ Needs your real number (likely near-zero given pre-launch status — state it honestly). |
| CD-4 | ❓ Almost certainly No, needs your confirmation. |
| CD-6 | ❓ Needs the real support headcount number. |

## Required Documents

| ID | Status |
|---|---|
| RD-1 | ✅ First draft done — see `RD-1-funds-flow-diagram.md`. |
| RD-2 | ❓ Regulatory registrations/licenses — depends entirely on L-1/L-2's real answer; if none exist yet, this section is honestly blank, not something to paper over. |
| RD-3 | Ties to L-3 — likely doesn't exist yet. |
| RD-4 / RD-5 | ✅ Drafted — `RD-4-BSA-AML-Policy.pdf` / `RD-5-Sanctions-Policy.pdf`, ~90% real content. Two genuine blanks left, flagged in red on the PDF itself: the MLRO name and board signatures. Fill those in once AML-8/9/10 are actually done — don't submit with placeholders still showing. |
| RD-6 | Needs an actual independent assessor — can't be self-produced, and only makes sense once RD-4/RD-5 are finalized (blanks filled). |
| RD-7 | ✅ Drafted and built — `RD-7-Funding-Plans.pdf`. |
| RD-8 | ✅ First draft done — see `RD-8-fraud-prevention-program.md`. |

---

**Suggested quick follow-up to Bridge** (separate from the big form, just to close the two real gaps their reply left open):

> "Thanks — that's really helpful. Two quick follow-ups before we finalize: (1) is SOC 2 covered by
> 'most of this,' or does that specifically need to sit on our side — and if so, is there an accepted
> interim path for an early-stage team? (2) For sanctions screening specifically — does your tooling
> cover wallet/source-of-funds tracing (SC-8/9, AML-11/12) and geo-blocking (SC-7), or are those expected
> at our application layer?"

**Bottom line: with Bridge's confirmation, roughly 15 more fields just became answerable (most of AML +
Sanctions), leaving three real categories: (1) purely factual items only you can confirm, (2) Mintware's
own governance actions regardless of Bridge's tooling — MLRO, board sign-off, internal training — and
(3) the two things Bridge's reply didn't resolve — SOC 2, and a couple of screening-scope specifics
worth nailing down with the follow-up above.**

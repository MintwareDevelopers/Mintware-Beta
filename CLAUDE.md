# Mintware — Claude Code Context

## What is Mintware?

Mintware is a DeFi liquidity coordination protocol built on **Base** (Coinbase's L2) using **Uniswap V4** infrastructure. It is the community monetization layer for Web3 — a B2B2C model that lets Web3 communities activate their user bases as liquidity.

**Core positioning:** Mintware sits between communities (supply) and DeFi liquidity markets (demand), using behavioral reputation as the coordination primitive.

---

## Architecture Overview

### Three-Role Model
- **Teams** — Protocol/project teams that create liquidity vaults and incentivize community participation
- **Communities** — DAOs, guilds, and social groups whose members provide liquidity
- **Referrers** — Distribution agents who onboard LPs and earn referral rewards

### V4 Hook Infrastructure
Mintware is built on Uniswap V4 hooks. Key hook responsibilities:
- **Vault enforcement** — Hook-enforced vault liquidity ensures LP positions meet protocol requirements
- **Oracle-anchored price bands** — Prevent predatory LP positioning; keep liquidity concentrated in valid ranges
- **Idle capital routing** — Uninvested vault capital routes to yield protocols (e.g., Morpho) while awaiting deployment
- **Reward distribution** — Hook triggers behavioral reward payouts based on MW Score events

### MW Score (Behavioral Reputation Primitive)
The MW Score is Mintware's core innovation — an on-chain reputation system that scores LP behavior across three dimensions:
- **Terminal Score** — Position quality, range accuracy, duration consistency
- **Referral Score** — Quality and retention of referred LPs
- **Social LP Score** — Community affiliation and cross-community activity

MW Score drives: reward multipliers, vault access tiers, institutional LP risk intelligence, and referrer compensation.

### Treasury Flywheel
Protocol fees → Treasury → Buyback/burn + liquidity incentives → TVL growth → more fees. MW Score modulates reward distribution within this loop.

---

## LP Tiers

### Community LPs
Individual community members providing liquidity. Rewarded via MW Score multipliers.

### Partner LPs (Brokers / Syndicates)
Distribution networks that aggregate LP flow. Treated as BD channels.

### Institutional LPs (Family Offices / Funds)
TVL foundation layer. MW Score serves as risk intelligence for their underwriting decisions.

---

## Tech Stack

- **Chain:** Base (Coinbase L2)
- **AMM:** Uniswap V4
- **Hooks:** Custom Solidity hooks (V4 hook interface)
- **Yield:** Morpho integration for idle capital
- **Oracle:** Price band anchoring (Chainlink or equivalent)
- **Docs:** docs.mintware.org

---

## Brand & Design System

- **Primary font:** Plus Jakarta Sans
- **Data/labels font:** DM Mono
- **Background:** Lavender-white `#F7F6FF`
- **Primary button:** Solid periwinkle `#3A5CE8`
- **Badges/tags:** Pastel palette
- **Gradients:** Decorative only — never structural

---

## Key Decisions & Conventions

- Protocol is **B2B2C** — Teams are the B2B customer, community members are the end users
- MW Score is **behavioral**, not just capital-weighted — this is the core differentiator from generic LP incentive systems
- Hooks enforce **vault rules at the contract level** — not reliant on off-chain enforcement
- Idle capital yield is **non-custodial** — routed through Morpho with vault-level accounting
- External documents (partner-facing) use **partner-focused framing**, not commercial/sales tone

---

## Active Workstreams

- Protocol architecture (V4 hooks, vault logic, MW Score)
- docs.mintware.org — brand identity applied to documentation site
- Business development — Firma Labs partnership (funding + resident entrepreneur arrangement)
- Institutional LP strategy

---

## Notes for Claude

- Always assume Base L2 context unless told otherwise
- MW Score components are distinct — don't conflate Terminal, Referral, and Social LP scores
- "Cold-start problem" is a known concern: bootstrapping initial TVL before network effects kick in
- The Firma Labs partnership is a potential solution to the cold-start problem — treat as high-priority context
- Prefer precise DeFi terminology; Nicolas has strong technical fluency

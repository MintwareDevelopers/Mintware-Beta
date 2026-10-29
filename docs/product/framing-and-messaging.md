# Mintware — Narrative and technical guardrails

This file preserves the platform's mission, tagline, and marketing voice while keeping product claims tied to
current code. Product status and technical behavior live in [`.claude/STATE.md`](../../.claude/STATE.md) and the
topic rules it links.

## Golden thread

**Mission:** *Liquidity should be a public good.*

**Tagline:**

> Never idle. Never locked. Always yours.

Keep these lines and the V1/V2 distinction. Use the tagline as the brand promise; do not turn it into an unqualified
claim that every Mintware product is earning yield or available for card spending.

## Current products and honest language

- **MarketEngine V1:** one quote-valued share for a curated Uniswap v4 pool; capital sits in a resting band plus
  per-token adapters. Robinhood Chain testnet adapters are idle custody, held ready without earning yield. Deposits
  need a fresh mark and nearby spot; withdrawals are pro-rata in-kind and remain available with a stale mark.
- **Earn:** `MintwareYieldVault` (`mwEARN`) is an ERC-4626 vault over one yield adapter. A pause blocks deposits and
  mints only. Illiquid exits pay what is obtainable; unpaid shares remain with the holder.
- **Cards:** Bridge + Stripe are pre-enable. `MintwarePaymentGateway` only refills a member-registered buffer by
  redeeming Earn shares. It does not authorize purchases, settle merchants, or spend from vault NAV.
- **Discover:** GeckoTerminal data and risk scores rank pools; they never certify safety.
- **RWA demo:** remains a testnet demo, not a live real-world asset service.

Every current contract product is testnet-only and unaudited; external audit gates real value.

## Retired claims

Do not present as current: stage → deploy → harvest → compound/restake; Gateway PositionManager/Staging; staged
yield; fee ledgers or cost-basis RPCs; spend-in-place YPN; Arc/CCTP; Lithic; campaigns; Treasury senior/junior new
issuance; matched launch; lock tiers; or ULV/JIT/MEV as a live feature. MarketEngine V3/JIT is parked. Historical
technical records live under [`docs/archive/retired-mechanics/`](../archive/retired-mechanics/).

## Wording guardrails

- Preserve established taglines, page order, marketing voice, and the V1/V2 split.
- State technical behavior directly and add a short status line where it is missing.
- Keep Discover's risk score described as a ranking, never a certification.
- Never frame the product as deposit, savings, guaranteed yield, or fixed APY.
- Use *testnet*, *unaudited*, and *external audit gates real value* for current on-chain products.
- Describe features that do not exist as retired or parked, not as an active design or live capability.

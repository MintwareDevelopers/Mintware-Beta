# Ethereum UX Adoption Report

Mintware report based on Ethereum builder best-practice guidance from:

- `approvals-SKILL.md`
- `signing-SKILL.md`
- `gas-SKILL.md`
- `multichain-SKILL.md`
- `onboarding-SKILL.md`
- `safety-SKILL.md`
- `wallets-SKILL.md`

This report is intentionally adoption-first.

The goal is not to implement Ethereum patterns for their own sake. The goal is to make Mintware easier to start, easier to trust, easier to complete actions in, and more likely to convert users into repeat swappers, traders, earners, and LPs.

The detailed source-by-source notes live in `docs/developers/ethereum-builder-review.md`. This file is the platform-level report and roadmap.

---

## Implementation Status

The first major Ethereum UX adoption pass is now implemented and pushed on `origin/claude/elastic-booth`.

This means the report is no longer only a roadmap. Part of it is now shipped code, while part remains future-facing.

### Implemented now

#### Swap / Trading

Implemented on:
- `app/(web3)/swap/page.tsx`
- `components/rewards/swap/SwapWidget.tsx`
- `components/rewards/swap/SwapConfirmSheet.tsx`
- `hooks/useSwap.ts`
- `lib/web2/providers/lifi.ts`

What landed:
- pre-wallet confirmation flow
- fiat-first network fee display
- gas sufficiency warning
- route and chain clarity
- readiness checklist and delayed wallet-help guidance
- preflight call before LI.FI transaction submission

#### Claims / Campaign Funding

Implemented on:
- `components/rewards/campaigns/ClaimCard.tsx`
- `components/rewards/creator/Step5Review.tsx`

What landed:
- safer batch-claim behavior
- clearer plain-language claim/funding copy
- allowance pre-check before campaign funding approval
- spender visibility and permission-vs-action guidance
- preflight simulation before EVM claim and `depositCampaign()` writes
- better wallet-state guidance during multi-step flows

#### Vaults / LP

Implemented on:
- `lib/web3/vault/useSocialVault.ts`
- `app/(rewards)/vault/[id]/page.tsx`
- `app/(rewards)/vault/create/page.tsx`

What landed:
- allowance checks before deposit and seed approvals
- zero-first fallback behavior for problematic approval flows
- preflight simulation before deposit and seed writes
- clearer progress, recovery, and permission messaging
- corrected vault-create success copy after seeded flows

#### Onboarding / Connect Language

Implemented on:
- `app/page.tsx`
- `components/web2/MwNav.tsx`

What landed:
- lower-anxiety landing copy
- stronger “explore first, connect when ready” framing
- `Connect to trade` style CTA language

### Improved, but not finished

- Approval hygiene is much better in campaign and vault flows, but Mintware still does not have an approval management / revoke UI.
- Transaction summaries are now strong for swap/trading, but not yet a single shared confirmation pattern across every value-moving flow.
- Multi-step progress and wallet guidance are much better, but interrupted flows still do not persist across refresh.
- Simulation/preflight now exists for the most important app-owned writes, but not every conceivable transaction path in the product.

### Not built yet

- ERC-20 gas payment
- Mintware approval management / revoke UI
- persistent resumable state across refresh for every multi-step flow
- EIP-7702 / batched wallet calls
- ERC-7730 metadata
- deeper ERC-7683-style chain abstraction / intent routing

### Explicit non-goal

- Company-paid gas sponsorship is not the default Mintware strategy.
- If Mintware adopts paymaster-style infrastructure later, it should primarily support user-paid token-denominated gas rather than blanket company-paid gas.

---

## Executive Summary

The strongest product opportunity is the swap and trading path.

That is where:
- first impressions are formed
- trust is either won or lost
- fees and revenue are created
- the largest number of users will feel friction first

Across all Ethereum guidance reviewed so far, the same conclusion keeps repeating:

Mintware should prioritize a safer, clearer, more guided transaction experience before adding more raw protocol capability.

The highest-value moves are:
1. Better wallet and onboarding UX
2. Better swap/trade confirmation, fee, approval, and progress UX
3. Better chain-awareness and network handling
4. Better safety cues and plain-language explanations
5. Then advanced optimizations like batching, paymasters, Permit2, and richer typed-data metadata

---

## Adoption Principles

These principles should guide every future implementation decision:

1. Show value before asking for commitment.
2. Explain actions before the wallet popup appears.
3. Use plain language in the default UI.
4. Reduce hidden failure points such as wrong chain, missing gas, surprise approvals, and stale estimates.
5. Keep swap/trading UX as a first-class surface, not a side effect of campaigns.
6. Make advanced power-user features opt-in, not required.
7. Prefer trust-building detail over raw technical detail.

---

## Where This Matters Most

### 1. Swap / Trading

Primary files:
- `app/(web3)/swap/page.tsx`
- `components/rewards/swap/SwapWidget.tsx`
- `components/rewards/swap/MintwareSwap.tsx`
- `lib/swap/lifi.ts`

Why this matters most:
- This is the main revenue surface.
- This is the most likely repeated action.
- This is the place where wallet friction, fee uncertainty, network mismatch, and unclear confirmations directly hurt conversion.

Main opportunities:
- pre-wallet transaction summary
- approval visibility
- fee preview in fiat
- gas sufficiency checks
- route and chain clarity
- multi-step progress
- strong failure recovery
- simple-mode language

### 2. Wallet / Onboarding

Primary files:
- `components/web2/providers.tsx`
- `components/web2/MwNav.tsx`
- `app/page.tsx`
- `lib/web3/useMintwareIdentity.ts`

Why this matters:
- New users need a low-anxiety entry point.
- Existing users need fast reconnection and clear session state.
- Embedded-wallet and email onboarding can become a major adoption advantage if handled carefully.

Main opportunities:
- better connect-state messaging
- clearer external wallet vs email wallet choices
- simpler terminology
- stronger mobile wallet/deep-link support
- clearer chain and wallet identity in persistent UI

### 3. Campaigns / Claims

Primary files:
- `components/rewards/creator/Step5Review.tsx`
- `components/rewards/campaigns/ClaimCard.tsx`

Why this matters:
- These flows involve value and trust.
- They are often multi-step.
- They are vulnerable to unclear approvals and confusing transaction states.

Main opportunities:
- allowance checks
- better approval explanations
- pre-wallet transaction summary
- simulation before submission
- resumable multi-step progress

### 4. Vaults / LP

Primary files:
- `lib/web3/vault/useSocialVault.ts`
- `app/(rewards)/vault/create/page.tsx`

Why this matters:
- LP and vault actions are higher-trust actions with more user caution.
- These flows especially benefit from preview, staged progress, and safety explanations.

Main opportunities:
- approval hygiene
- step-by-step progress
- simulation before deposit/seeding
- better risk messaging

---

## Standards And Patterns To Adopt

### EIP-712

Status:
- Already used well in several backend/oracle flows.

Where Mintware already uses it:
- `lib/web3/onchainPublisher.ts`
- `app/api/(web3)/agents/campaigns/record/route.ts`
- `app/api/(rewards)/vault/attribution-snapshot/route.ts`
- `lib/web3/vault/rangeProposer.ts`

Recommendation:
- Keep EIP-712 as the default standard for future off-chain Ethereum signatures.
- Require domain separation, deadlines, and human-readable message fields for any new signing flow.

### ERC-7730

Status:
- Not implemented today.

Recommendation:
- Treat as a later UX enhancement on top of EIP-712, especially where hardware-wallet readability matters.
- Good fit for high-trust typed-data prompts, but not a day-one adoption blocker.

### EIP-5792 / EIP-7702

Status:
- Not implemented today.

Recommendation:
- Good later-stage optimization for batching approve + action or multi-step flows.
- Do not prioritize before baseline clarity, preview, and fallback behavior are solid.

### ERC-7677 Paymasters

Status:
- Not implemented today.

Recommendation:
- Relevant as infrastructure, but not as a default company-paid gas strategy.
- Mintware should not position itself around subsidizing user gas as a business.
- If paymaster-style infrastructure is adopted, it should mainly support token-denominated user-paid fees or tightly scoped onboarding cases rather than blanket subsidies.

### ERC-20 Gas Payment

Status:
- Not implemented today.

Recommendation:
- High-value medium-term feature, especially for swap and trading flows.
- Mintware should strongly consider letting users pay fees in supported tokens like USDC instead of requiring native gas tokens.
- This is a better strategic fit than company-paid sponsorship because it reduces friction without forcing Mintware to absorb transaction costs.

### ERC-7683

Status:
- Not implemented today.

Recommendation:
- Relevant if Mintware evolves toward richer intent-based cross-chain transfers.
- Lower priority than making current swap/trading flows excellent.

### ERC-7930 / Address Validation / ENS

Status:
- Partially present in scattered form.

Recommendation:
- Strengthen address validation, ENS display, and chain-aware address handling where users paste or confirm identities.
- Especially important for future transfer, cross-chain, or approval-management surfaces.

---

## Implement Now

These are the best first-wave changes for Mintware.

### 1. Build a universal pre-wallet confirmation layer

Apply to:
- swaps
- claims
- campaign funding
- vault deposit
- vault seeding

What it should show:
- action verb
- asset amounts
- expected outcome
- spender / contract / destination
- chain
- estimated network fee in fiat
- important warnings

Why now:
- This improves trust, clarity, and conversion immediately.

### 2. Add approval hygiene everywhere Mintware owns the flow

Apply to:
- campaign funding
- vault deposit
- vault seeding
- treasury policy decision

What to add:
- allowance pre-checks
- exact-amount default approvals
- zero-first support for problematic tokens
- clear approval vs action separation

Why now:
- Approval friction and approval fear are major adoption killers.

### 3. Add proper fee UX

Apply first to:
- swaps
- claims
- campaign funding
- vault deposit/seeding

What to add:
- fiat fee display
- native balance sufficiency checks
- re-estimation before submission
- actual fee paid after confirmation
- high-fee warnings when fee-to-value ratio is unreasonable

Why now:
- Fee uncertainty creates abandonment.

### 3b. Set the gas-payment policy explicitly

Policy:
- Mintware should not pay user gas by default.
- Mintware should explore user-paid gas in supported ERC-20s, especially USDC.

Why now:
- This product constraint should shape all later wallet, fee, and paymaster work before implementation begins.

### 4. Improve transaction progress and recovery

Apply to:
- approve + action flows
- claim flows
- high-value vault actions

What to add:
- explicit step status
- waiting-for-wallet helper text
- retry and cancel options
- interrupted-flow recovery when practical

Why now:
- Unknown transaction state is one of the most frustrating crypto UX problems.

### 5. Make the default language much simpler

Apply across:
- landing page
- swap
- wallet connection
- claims
- rewards
- vault flows

What to replace:
- “approve” -> “give permission”
- “gas” -> “network fee”
- “sign” -> “confirm”
- “transaction” -> “payment” or “transfer” where appropriate

Why now:
- Ease of adoption depends on reducing jargon and anxiety.

### 6. Strengthen wallet/connect UX

Apply to:
- `components/web2/providers.tsx`
- `components/web2/MwNav.tsx`
- `app/page.tsx`

What to improve:
- clearer wallet choices
- better connecting/loading states
- better disconnect and reconnect state
- clearer “email wallet” vs external wallet framing
- stronger mobile wallet behavior

Why now:
- Better connection UX helps every downstream product surface.

### 7. Make chain context visible and automatic

Apply first to:
- swap/trading
- claim
- any chain-specific action

What to improve:
- persistent chain indicator
- automatic network switching
- chain-specific action summaries
- clear “from chain / on chain” language

Why now:
- Wrong-chain confusion is a constant source of dropped transactions.

---

## Implement Later

These are good ideas, but should follow the first-wave adoption improvements.

### 1. ERC-20 gas payment

Priority:
- High-value medium-term

Best first scope:
- swap and trading flows
- stablecoin-first users, especially USDC holders without native gas

Why here:
- This is one of the strongest post-foundation adoption upgrades for Mintware.
- It should follow baseline swap clarity, fee UX, and wallet-state improvements so it lands on top of a trustworthy flow.

### 2. Mintware approval management and revoke UI

Best first scope:
- Mintware-owned spenders only

### 3. Permit2

Use only if:
- repeat-user flows clearly benefit
- spender display and phishing safeguards are excellent

### 4. EIP-7702 batching

Use when:
- the baseline multi-step UX is already strong

### 5. ERC-7677 paymaster sponsorship

Use when:
- it is used as plumbing for token-paid gas or very tightly scoped onboarding support
- not as a blanket company subsidy model

### 6. ERC-7730 metadata

Use when:
- Mintware wants best-in-class hardware-wallet signing clarity

### 7. Full cross-chain aggregation and richer intent routing

Use when:
- Mintware leans harder into multichain portfolio and bridge-style experiences

---

## Not A Fit Right Now

These are valid Ethereum ideas, but should not distract from the core Mintware opportunity today.

### SIWE as a priority auth shift

Reason:
- Mintware already relies on wallet identity and Privy-assisted onboarding.
- SIWE is not the most important adoption unlock right now compared with swap UX, fee clarity, and transaction trust.

### Full-blown ERC-7683 intent infrastructure immediately

Reason:
- Interesting strategically, but less valuable than improving the current swap/trading flow first.

### Heavy advanced-mode exposure in the default UI

Reason:
- The Ethereum guidance strongly supports progressive disclosure.
- Mintware should stay simple by default and reveal technical detail on demand.

---

## Product-Surface Implementation Map

### Swap / Trading

Implement now:
- transaction summary panel
- fiat fee panel
- gas sufficiency check
- chain and route clarity
- multi-step progress
- stronger warnings for risky approvals or unusual fees
- simpler wording in default mode

Implement later:
- batching
- sponsorship for low-balance users
- richer cross-chain intent UX

### Wallet / Onboarding

Implement now:
- clearer connection choices
- better loading and recovery states
- stronger plain-language copy
- persistent chain and wallet identity cues
- better mobile connect behavior

Implement later:
- deeper embedded-wallet backup and recovery flows
- more internationalization breadth

### Campaigns / Claims

Implement now:
- approval hygiene
- claim previews
- simulation/preflight
- better progress and recovery states

Implement later:
- richer advanced transaction detail panels

### Vaults / LP

Implement now:
- approval hygiene
- simulation/preflight
- stronger step-by-step progress
- clearer risk and permission explanations

Implement later:
- batching
- enhanced typed-data metadata where useful

---

## Suggested Build Sequence

### Phase 1 — Adoption Foundation

- Shared transaction summary component
- Shared fee estimation/presentation layer
- Shared warning tier system
- Shared multi-step progress state model
- Shared jargon/terminology map

### Phase 2 — Revenue Surface Upgrade

- Apply the shared system to swap/trading first
- Improve chain visibility and network switching
- Add safer approval handling where swap-adjacent flows need it

### Phase 3 — Trust Surface Upgrade

- Apply the same system to claims, campaign funding, and vaults

### Phase 4 — Power UX

- batching
- ERC-20 gas payment
- limited paymaster infrastructure where needed
- Permit2 where justified
- richer typed-data metadata

---

## Bottom Line

If Mintware wants to be the best version of itself, the Ethereum guidance points in one direction very clearly:

Make the app feel safer, simpler, clearer, and more predictable before asking users to commit money or trust.

For Mintware specifically, that means:
- win the swap/trading UX
- reduce wallet and fee anxiety
- make approvals and confirmations understandable
- make multichain behavior feel automatic, not confusing
- keep advanced crypto complexity behind progressive disclosure

That is the path most likely to improve both user adoption and platform revenue.

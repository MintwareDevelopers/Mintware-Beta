# Ethereum UX Upgrades

Last updated: 2026-04-04
Status: shipped — live on `main`, deployed to production

---

## What This Is

Between late March and early April 2026, Mintware shipped a coordinated set of UX improvements across its four main transaction surfaces: **swap**, **campaign funding**, **reward claiming**, and **vault operations**.

The work was driven by guidance from the [Ethereum Foundation's ethux.design spec](ethereum-ux-adoption-report.md) and a [builder review pass](ethereum-builder-review.md) against Mintware's own surfaces.

The core principle across all of it: **users should understand what is about to happen before their wallet popup opens**, not after.

---

## Changed Files

| File | Surface | Type |
|---|---|---|
| `components/rewards/swap/SwapConfirmSheet.tsx` | Swap | New component |
| `components/rewards/swap/SwapWidget.tsx` | Swap | Modified |
| `lib/web2/providers/lifi.ts` | Swap | Modified |
| `components/rewards/creator/Step5Review.tsx` | Campaign funding | Modified |
| `components/rewards/campaigns/ClaimCard.tsx` | Reward claiming | Modified + bug fix |
| `lib/web3/vault/useSocialVault.ts` | Vault deposit / approval | Modified |
| `app/(rewards)/vault/[id]/page.tsx` | Vault deposit UX | Modified |
| `app/(rewards)/vault/create/page.tsx` | Vault create / seed UX | Modified |

---

## Surface 1 — Swap

### Problem

The swap widget went straight from "Swap" button to wallet popup. Users had no opportunity to review the trade before signing. Network fees were shown in native token only (ETH, CORE, etc.) — a poor signal for most users making cost decisions.

### What Changed

**`SwapConfirmSheet.tsx` — new component**

A full-screen confirmation panel that appears between the "Review Swap" click and the wallet opening. It shows:

- token sent (symbol, amount, USD value from `quote.fromAmountUSD`)
- estimated token received
- network name
- network fee — **fiat-first**: `~$0.05 (~0.00003 ETH)` when the LI.FI estimate is available; falls back to ETH-only
- platform fee as a percentage plus estimated USD cost
- price impact (red if above 2%)
- route (`LI.FI aggregator`)
- high-impact yellow warning when price impact is high
- plain-language explainer: "your wallet will open to confirm this swap — amounts are estimates and may differ slightly"
- Cancel path always available

**`SwapWidget.tsx` — updated flow**

- Button copy changed from `Swap` → `Review Swap`
- Clicking `Review Swap` opens `SwapConfirmSheet` — does **not** open the wallet immediately
- Clicking `Open wallet to confirm →` inside the sheet calls `executeSwap`
- Gas insufficiency warning banner added: appears when `nativeBalance < gasCostWei + txValue`
- Inline route strip shows `~$0.05 fee` fiat-first, falls back to ETH amount
- `sellAmountUSD` is now real — derived from `quote.fromAmountUSD` (was hardcoded null)
- `gasCostUSD` memoized from `quote.gasCostUSD`

**`lib/web2/providers/lifi.ts` — updated quote shape**

Two new optional fields added to `LifiQuote`:

```ts
gasCostUSD?:          string   // estimate.gasCosts[0].amountUSD — fiat fee display
nativeTokenPriceUSD?: string   // estimate.gasCosts[0].token.priceUSD — native spot price
```

`getQuote()` now extracts both from the LI.FI response.

---

## Surface 2 — Campaign Funding

### Problem

`Step5Review.tsx` (the campaign creator funding step) always showed a 3-step or 5-step approval + deposit flow, even when the wallet already had sufficient allowance for the campaign contract. Users were asked to approve tokens they had already approved. Approval language ("Approve token spend") didn't distinguish permission from transfer.

### What Changed

**Allowance pre-check** using `useReadContract`:

```ts
const { data: allowanceRaw } = useReadContract({
  address: form.token?.address,
  abi: erc20AllowanceAbi,
  functionName: 'allowance',
  args: [address, DISTRIBUTOR_ADDRESS],
})
const hasEnoughAllowance = allowanceRaw !== undefined && allowanceRaw >= requiredAmount
```

- If allowance is sufficient → `handleFund()` skips straight to `writeFund` (1-step)
- If allowance is insufficient → normal approve → deposit flow (3-step)

**Language changes**

- "Approve token spend" → "Give permission to use tokens"
- Explainer block adapts: tells the user whether they need 1 step or 2 before they act
- Per-step context panels shown while each tx is in-flight

**Step list adapts to context**

- 1-step path: `["Deposit tokens into campaign"]`
- 2-step path: `["Give permission", "Deposit tokens into campaign"]`

---

## Surface 3 — Reward Claiming

### Bug Fix

**`ClaimCard.tsx` — batch claim proof fetch address**

`handleBatchClaim` was building the proof fetch URL with `r.token_address` instead of `wallet`:

```ts
// Before (broken):
`/api/claim?address=${encodeURIComponent(r.token_address ?? '')}&...`

// After (fixed):
`/api/claim?address=${encodeURIComponent(wallet)}&...`
```

Proofs were being fetched for the token contract address rather than the user wallet. The proof would always return empty or wrong, causing all batch claims to fail silently.

### UX Improvements

**Button copy** — reflects actual state at each step:

| State | Old copy | New copy |
|---|---|---|
| Idle | `Claim` | `Check your wallet →` |
| Loading proof | `Claiming…` | `Getting proof…` |
| Waiting for signature | `Claiming…` | `Waiting for confirmation…` |
| Wrong network | (no state) | `Switching network…` |

**Pre-claim context line**

Before the wallet opens, a line appears: `0.25 USDC on Base → your wallet`. Users see what is arriving and where before they sign.

**Batch claim** copy updated to match: `Claim All (N) — check your wallet →`

---

## Surface 4 — Vault Deposit and Approval

### Problem

Vault deposit and approval flows used the same generic confirm-then-sign pattern. No separation between giving token permission and completing the deposit. No chain context before submission.

### What Changed

- `useSocialVault.ts` now separates approval and deposit concerns more explicitly in the live hook path
- Vault page UX surfaces the permission-versus-deposit distinction more clearly before submission
- Vault creation / seed flow messaging was updated so the success path no longer implies users still need to call a follow-up seeding action manually after a successful seed
- "Approve" language replaced with "Give permission" throughout vault flows
- Zero-first approval fallback added for USDT-style tokens (avoids `approve(nonzero)` revert when current allowance is nonzero)
- Chain context surfaced before submission — shows which network the vault is on
- Pre-submission checks added before calling write functions

---

## What Was Not Changed

These are deliberate scope decisions, not omissions:

| Item | Reason |
|---|---|
| In-app approval revocation | Planned for later — best first version covers Mintware-owned spenders only |
| EIP-5792 batched approve + action | Good UX win but not required for safe baseline |
| Permit2 | Useful only for repeat power-user flows; adds complexity and phishing surface |
| Treasury sweep unlimited approval | Ops tradeoff; should be explicitly documented before changing |
| Single shared approval review surface | Step after the per-surface work lands cleanly |

---

## Commits

The original implementation work was developed on `claude/elastic-booth` and then replayed onto `main` through the production-ready merge path. The five hashes below are the original feature-development commits, not the exact commit IDs that now exist on `main`.

| Original hash | Description |
|---|---|
| `01648536` | `feat(ux): Ethereum UX improvements — swap confirmation, fee clarity, approval hygiene` |
| `37d4946b` | `fix(swap): fiat-first gas fee display + batch claim wallet address fix` |
| `0a0654c1` | `feat(ux): strengthen swap and onboarding guidance` |
| `c14cd96f` | `feat(ux): harden claim and campaign funding flows` |
| `e8e71b8a` | `feat(ux): harden vault approval and deposit flows` |

The replayed production path on `main` begins with [`92724fae`](/Users/nicolasrobinson/Downloads/Mintware%20Phase%201%20app%20Build) (`feat: ship Ethereum UX upgrades`) and the subsequent production-fix commits that kept the deploy healthy.

---

## Design Principles Applied

These guided every decision across the five commits:

1. **Transaction context before wallet** — explain the action in product UI before the wallet popup opens
2. **Fiat-first fees** — show `~$0.05` prominently; show `0.00003 ETH` as secondary context
3. **Distinguish permission from transfer** — approval UX language must not imply money is moving
4. **Skip unnecessary steps** — check allowance; skip approve if sufficient
5. **Reflect real state in button copy** — "Getting proof…", "Waiting for confirmation…" beats a spinner
6. **Always give a cancel path** — no modal or sheet traps the user without a visible exit

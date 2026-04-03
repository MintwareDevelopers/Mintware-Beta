# Ethereum Builder Review

Working document for evaluating external Ethereum builder guidance against Mintware's actual platform.

Goal: review each recommendation before implementation and sort it into one of:
- `Adopt now`
- `Adopt later`
- `Not a fit`
- `Already covered`

Status legend:
- `Open` — reviewed at a high level, not yet converted into implementation tickets
- `Planned` — accepted in principle, waiting for scoped build work
- `Done` — implemented
- `Rejected` — intentionally not adopting

---

## Review Framework

For each source, capture:
1. What the guidance recommends
2. Where it applies in Mintware today
3. What we should change, if anything
4. Whether the recommendation belongs to `Web2`, `Web3`, or `Rewards`
5. Priority, risk, and implementation notes

---

## Source 1 — Token Approvals

- Source file: `/Users/nicolasrobinson/Downloads/ETH AGENT BUILD SKILLS/approvals-SKILL.md`
- Theme: safer ERC-20 approval UX and allowance handling
- Primary Mintware surfaces:
  - Campaign funding
  - Vault deposit
  - Vault seeding
  - Treasury sweep automation

### Overall Verdict

High-value guidance. Mintware should adopt the allowance hygiene and approval transparency recommendations first, then consider batching or Permit2 later.

### Recommendation Review

| Recommendation | Mintware status | Verdict | Priority | Notes |
|---|---|---|---|---|
| Exact-amount approvals by default | Strong partial coverage | `Adopt now` | High | User-facing campaign and vault flows now approve only the action amount and skip approval when allowance is already sufficient. Treasury sweep still uses unlimited approval. |
| Check allowance before requesting approval | Covered in key user flows | `Already covered` | High | Campaign funding and vault deposit/seed flows now perform allowance pre-checks before prompting. |
| Human-readable approval display | Strong partial coverage | `Adopt now` | High | Campaign funding and vault flows now explain spender permissions much more clearly, but Mintware still lacks a single shared approval review surface across every approval-capable action. |
| Zero-first handling for tokens like USDT | Partial | `Adopt now` | High | Vault approval flows now include a zero-first fallback, and campaign funding now warns about USDT-style approval edge cases. This should still become a shared reusable helper. |
| In-app approval revocation | Missing | `Adopt later` | Medium | Best first version should cover Mintware-owned spenders only. |
| Distinct approval vs action confirmation treatment | Covered in key user flows | `Already covered` | Medium | Campaign funding and vault flows now separate permission-vs-action language and step context more clearly. |
| EIP-5792 batched approve + action | Missing | `Adopt later` | Medium | Good UX improvement for approve + deposit flows, but not required for the safe baseline. |
| Permit2 support | Missing | `Adopt later` | Low | Useful only if we intentionally optimize for power-user repeat flows. Adds complexity and phishing surface. |
| Re-simulate after approval before action | Partial | `Adopt later` | Low | Campaign funding and vault flows now preflight the action call before the final write, but the pattern is not yet universal. |
| Unlimited approvals by default | Present in treasury only | `Reject as default` | High | Replace treasury `MAX_UINT256` unless we explicitly document an ops tradeoff. |

### Concrete Mintware Touchpoints

#### 1. Campaign funding

- File: `components/rewards/creator/Step5Review.tsx`
- Current behavior:
  - Creates the campaign record
  - Calls `approve(spender, amount)`
  - Waits for receipt
  - Calls `depositCampaign()`
- Gaps:
  - No allowance pre-check
  - No zero-first token handling
  - No explicit approval review surface with spender address/name
  - Approval and funding steps are visually distinct in button text, but not fully explained as separate permissions vs action

#### 2. Vault deposit and seeding

- File: `lib/web3/vault/useSocialVault.ts`
- Current behavior:
  - Deposit flow: `approve(USDC, SocialVault)` then `deposit()`
  - Seed flow: `approve(projectToken, SocialVault)` then `seedTeamTokens()`
- Gaps:
  - No allowance pre-check
  - No zero-first token handling
  - No spender explanation in UI
  - No revoke path

#### 3. Treasury sweep automation

- File: `lib/rewards/treasury/sweep.ts`
- Current behavior:
  - Checks allowance to LI.FI router
  - If insufficient, approves `MAX_UINT256`
- Gaps:
  - Uses unlimited approval
  - No explicit documentation explaining why unlimited approval is acceptable here

### Suggested Upgrade Backlog

| Item | Grouping | Status | Notes |
|---|---|---|---|
| Add reusable allowance-check helper for app-owned ERC-20 spenders | `Web3` | Planned | Core behavior now exists in campaign and vault flows, but it should still be centralized into one reusable helper. |
| Update campaign funding flow to skip approval when allowance is already sufficient | `Web3` | Done | Campaign funding now skips the approval step when allowance already covers the deposit amount. |
| Update vault deposit and seed flows with allowance pre-checks | `Web3` | Done | Vault deposit and seed flows now check allowance before prompting for approval. |
| Add known-token zero-first allowance handling list | `Web3` | Planned | Vaults now attempt zero-first fallback and campaign funding warns about USDT-style approval rules, but the token list/policy is not yet centralized. |
| Add approval disclosure UI block with spender name/address, token, amount | `Web2` + `Web3` | Done | Campaign funding now shows spender context and permission-vs-action guidance, and vault flows add clearer approval messaging. |
| Decide whether treasury sweeps should use exact-amount approval or documented unlimited approval | `Web3` | Open | Ops tradeoff decision needed before implementation. |
| Add basic Mintware approval management / revoke screen | `Web2` + `Web3` | Open | First scope should include only Mintware-owned spenders. |
| Evaluate EIP-5792 batching for approve + deposit flows | `Web3` | Open | Only after the baseline approval hygiene is in place. |
| Evaluate Permit2 for repeat-user flows | `Web3` | Open | Defer unless product direction makes it worthwhile. |

### Implementation Order

1. Allowance checks and zero-first support
2. Approval disclosure UI
3. Treasury approval policy decision
4. Mintware-only approval management
5. Optional batching and Permit2 exploration

---

## Next Sources

Add future Ethereum guidance below using the same structure:

## Source 2 — Transaction Signing

- Source file: `/Users/nicolasrobinson/Downloads/ETH AGENT BUILD SKILLS/signing-SKILL.md`
- Theme: typed-data signing, transaction preview, multi-step signing UX, SIWE
- Primary Mintware surfaces:
  - Reward claim submission
  - Campaign funding
  - Vault deposit and seed flows
  - Oracle-signed backend flows
  - Solana wallet linking message flow

### Overall Verdict

Strong guidance. Mintware already does several of the hard backend pieces correctly, especially EIP-712, deadlines, and replay resistance. The biggest gaps are in wallet-facing UX: pre-sign explanations, human-readable summaries, transaction simulation, and resumable multi-step flows.

### Recommendation Review

| Recommendation | Mintware status | Verdict | Priority | Notes |
|---|---|---|---|---|
| Use EIP-712 for off-chain structured signatures | Strong partial coverage | `Already covered` | Medium | Mintware already uses EIP-712 for distributor root signing, vault attribution snapshots, vault range proposals, and agent campaign action signatures. |
| Set reasonable expiry / deadline on signed messages | Covered in key backend flows | `Already covered` | Medium | Distributor, vault, and agent signing paths already use deadlines. |
| Human-readable transaction summary before wallet popup | Partial | `Adopt now` | High | Swap now has a real pre-wallet confirmation sheet, and campaign/claim/vault flows have clearer plain-language guidance, but Mintware still lacks one shared summary system across every value-moving action. |
| Transaction simulation / preview before value-moving txs | Covered in key user flows | `Already covered` | High | Swap, claim, campaign funding, and vault deposit/seed flows now preflight their key value-moving writes before submission. |
| Multi-step progress for multi-tx flows | Strong partial coverage | `Adopt now` | High | Campaign funding and vault flows now have materially better progress, wallet guidance, and permission-vs-action context, but interrupted flows are still not durable across refresh. |
| Resume / recovery state for interrupted multi-step signing | Missing | `Adopt later` | Medium | Especially useful for approve + deposit flows if users refresh or abandon midway. |
| EIP-7702 / sendCalls batching | Missing | `Adopt later` | Medium | Nice future UX improvement after baseline preview/progress work. |
| SIWE / personal_sign for auth with nonce + server verification | Not used for EVM auth | `Not a fit right now` | Low | Mintware currently uses wallet connection, not EVM SIWE, for session identity. No clear immediate need to add SIWE. |
| Avoid raw/unstructured signing | Mostly covered | `Already covered` | Medium | No EVM `eth_sign` usage found in app code. |
| ERC-7730 metadata for EIP-712 | Missing | `Adopt later` | Low | Worth considering where hardware-wallet clarity matters, but not a first-wave item. |

### Concrete Mintware Touchpoints

#### 1. Distributor / rewards signing infrastructure

- Files:
  - `lib/web3/onchainPublisher.ts`
  - `app/api/(rewards)/claim/route.ts`
  - `contracts/MintwareDistributor.sol`
- Current behavior:
  - Oracle signs typed structured data with EIP-712
  - Signature includes `deadline`
  - Contract verifies chain-specific typed data and rejects expired or replayed signatures
- Verdict:
  - This is a strong implementation and already aligns with the guidance on typed structured signing and expiry.

#### 2. Agent campaign signing

- File: `app/api/(web3)/agents/campaigns/record/route.ts`
- Current behavior:
  - Reads nonce on-chain
  - Signs typed structured data with deadline
  - Only updates Supabase after signing succeeds
- Verdict:
  - Strong backend discipline. Good example to preserve.

#### 3. Reward claim UX

- File: `components/rewards/campaigns/ClaimCard.tsx`
- Current behavior:
  - Fetches Merkle proof and oracle signature
  - Sends `claim()` directly once data is ready
  - Shows loading and confirmation states after submission
- Gaps:
  - No explicit pre-wallet summary of what the user is about to claim, on which contract, and on which chain
  - No simulation/preflight to catch obvious reverts before the wallet popup
  - Error handling is acceptable, but not yet a full signing-preview UX

#### 4. Campaign funding UX

- File: `components/rewards/creator/Step5Review.tsx`
- Current behavior:
  - Shows a staged multi-step button state
  - Runs create record -> approve -> deposit
- Gaps:
  - No full transaction summary before each wallet-triggering step
  - No simulation/preflight for `depositCampaign()`
  - Progress is not resumable after refresh or interruption

#### 5. Vault deposit and seeding UX

- File: `lib/web3/vault/useSocialVault.ts`
- Current behavior:
  - Tracks simple local stages like `approving`, `approved`, `depositing`, `seeding`
- Gaps:
  - The hooks are stateful, but not durable across refreshes
  - No transaction summary UI on their own
  - No simulation/preflight path before write submission

#### 6. Solana wallet linking message flow

- Files:
  - `app/(rewards)/profile/page.tsx`
  - `app/api/(web3)/wallet-link/route.ts`
- Current behavior:
  - User signs a human-readable message with timestamp
  - Server verifies signature and timestamp window
- Verdict:
  - Not Ethereum signing, but the overall pattern is healthy: human-readable message, bounded time window, server-side verification.

### Suggested Upgrade Backlog

| Item | Grouping | Status | Notes |
|---|---|---|---|
| Add reusable transaction summary panels before app-owned writes | `Web2` + `Web3` | Planned | Swap now has a strong dedicated confirmation sheet, but claim/campaign/vault still need a more unified reusable summary treatment. |
| Add `simulateContract` or equivalent preflight for app-owned value-moving writes | `Web3` | Done | Implemented for swap, claim, campaign funding, and vault deposit/seed paths. |
| Upgrade multi-step UX to show clearer step status and recovery options | `Web2` + `Web3` | Done | Campaign funding, swaps, claims, and vault flows now expose materially clearer step states, wallet guidance, and error context. |
| Persist interrupted multi-step flow state where practical | `Web2` | Open | Good later improvement for approve + deposit sequences. |
| Evaluate EIP-7702 / `wallet_sendCalls` batching after baseline UX fixes | `Web3` | Open | Defer until summaries and fallback paths are in place. |
| Decide whether any future EVM auth flow should use SIWE | `Web2` + `Web3` | Open | Not needed now, but worth keeping explicit if auth evolves. |
| Investigate ERC-7730 metadata support for key typed-data prompts | `Web3` | Open | Low priority enhancement for better wallet rendering. |
| Evaluate ERC-20 gas payment for swap/trading flows | `Web2` + `Web3` | Open | Prefer user-paid fees in tokens like USDC over company-paid sponsorship. |
| Keep paymaster usage scoped to token-paid gas plumbing, not blanket subsidies | `Web3` | Open | Product policy: Mintware should not default to paying user gas as a company. |

### Implementation Order

1. Pre-wallet transaction summaries
2. Simulation/preflight on value-moving writes
3. Better multi-step progress and failure recovery
4. Optional resumable flows
5. Optional batching and advanced signing metadata

---

## Next Sources

Add future Ethereum guidance below using the same structure:

### Source N — [Title]

- Source file:
- Theme:
- Primary Mintware surfaces:

### Overall Verdict

TBD

### Recommendation Review

| Recommendation | Mintware status | Verdict | Priority | Notes |
|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD |

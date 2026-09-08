# RD-1 — Funds Flow Document

**Status: first draft, grounded directly in the live codebase (`lib/cards/bridge.ts`, `lib/org/cardAuthorize.ts`, `contracts-v4/src/payments/MintwareTreasuryVault.sol`).**
**⚠ Before this goes to Bridge: have real legal/compliance counsel review the custody characterization
section specifically — "custodial vs. non-custodial" carries real money-transmission-licensing weight,
and that call shouldn't be made by an AI drafting a compliance document. Everything else here describes
verified, real mechanics.**

## Diagram

```mermaid
flowchart TD
    A["Member's Privy embedded wallet<br/>(self-custodied, non-custodial signer)"] -->|"capped ERC-20 approve()<br/>sized to daily cap x coverage days,<br/>hard-capped at $50,000"| B["Bridge / Stripe Issuing<br/>per-program spender address"]
    C["Mintware Treasury Vault<br/>(senior tranche, USDC, pooled)"] -->|"buffer top-up<br/>(refill, sized/tuned)"| A
    D["Junior tranche<br/>(team-capitalized, first-loss)"] -.->|"absorbs shortfall<br/>before senior ever touched"| C
    B -->|"pulls exact swipe amount<br/>via the allowance at auth time"| E["Card swipe at merchant"]
    E --> F{"decideCardSwipe()<br/>belt + suspenders"}
    F -->|"belt: role daily cap<br/>+ standing tier (widen-only)"| F
    F -->|"suspenders (mode A):<br/>flat buffer balance check"| G["Approve / Decline"]
    F -->|"suspenders (mode B):<br/>live edge-auth NAV hold<br/>fail-closed if unconfigured"| G
    G -->|approved| H["Settlement:<br/>settleSpend / burnForPayment<br/>via oracle signer, RELAYER_ROLE"]
    H --> C
```

## Narrative walkthrough

1. **Funding wallet.** Each card is funded from the member's own Privy embedded wallet — one wallet, one card (Bridge's own rule, which matches how `card_spend_buffers` is scoped 1:1 per card). The member holds the wallet; Mintware never holds a private key that can move 100% of a member's balance unilaterally.

2. **The allowance, not a balance transfer.** The funding wallet grants a plain ERC-20 `approve(spender, allowance)` on USDC to a per-program Bridge-provisioned spender address. This is a **capped standing pull-right**, not an unlimited approval: the allowance is sized to `dailyCapAtomic × coverageDays` (default 7 days), floored at one day's cap, and — critically — hard-ceilinged at **$50,000 absolute maximum**, and further scoped down to a multiple of the intended buffer target when one is configured. Bridge can never pull more than this capped amount, regardless of what else sits in the wallet.

3. **At swipe time**, Bridge/Stripe pulls the exact authorized amount via that allowance — it reads the wallet's real on-chain USDC balance, never a vault NAV computation (a live AMM-priced NAV read cannot complete inside a card network's ~6-second authorization window, which is why the buffer model exists at all).

4. **The authorization decision** (`decideCardSwipe`) runs belt-and-suspenders, checked in this order:
   - **Belt:** the member's role-based daily spend cap (from a fixed role-preset policy), summed against that member's actual approved spend so far *that day* — not just the current swipe — plus an optional "standing" tier that can only ever *widen* a limit within the existing hard cap, never remove or bypass it.
   - **Suspenders — two modes, mutually exclusive per card:**
     - **Buffer mode** (flag-gated): an atomic, row-locked check-and-reserve against a pre-funded flat balance — deterministic, meets card-network latency.
     - **Edge-auth mode** (default): a live NAV-based hold against the member's actual vault equity, computed by the Rust edge-auth service. **Fails closed** if edge-auth isn't configured — a card never silently default-approves because a downstream service is unreachable.

5. **Where the buffer/vault money actually sits.** The USDC the buffer draws from originates in `MintwareTreasuryVault` — a senior/junior tranche structure. Community-facing senior capital is the par-protected, spendable claim; the team's own junior capital is contractually first-loss and is drawn down **before** senior capital in any shortfall (code-enforced, not discretionary — see the vault's own redemption-waterfall ordering).

6. **Settlement** (the actual on-chain burn-shares-and-pay leg, `settleSpend`/`burnForPayment`) is executed by a designated oracle signer holding a specific on-chain role, not an arbitrary hot wallet.

## Custody characterization (needs counsel sign-off, not just engineering description)

- The **card funding wallet** is the member's own Privy-embedded wallet — self-custodied in the sense that no single Mintware-controlled key can move it unilaterally, though Privy itself provides the underlying key-management infrastructure (worth being precise about that distinction rather than a blanket "fully non-custodial" claim).
- The **treasury vault** is a smart-contract-pooled position — depositors receive shares against pooled principal, governed by contract logic (and, for specific risk parameters, a timelocked oracle signer) rather than held in a Mintware-controlled bank account. Whether this is the right side of the custodial/non-custodial line for DDQ purposes (SO-1) is a determination for actual counsel, not something to assert here.

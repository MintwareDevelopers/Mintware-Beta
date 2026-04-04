# Reviewing Transactions

Mintware is designed to explain important on-chain actions before your wallet opens — not inside the wallet popup where the description is often truncated or technical.

---

## Swap — Review Panel

When you click **Review Swap**, a confirmation panel appears before your wallet opens. It shows:

- the token you are sending and the exact amount, with its USD value
- the estimated token and amount you will receive
- which network the swap will happen on
- the estimated network fee — shown as **`~$0.05`** (fiat) with the native token amount as secondary context (`~0.00003 ETH`)
- the Mintware platform fee as a percentage with an estimated dollar amount
- price impact — highlighted in red if it exceeds 2%
- a plain-language explanation of what will happen next

After reviewing, click **Open wallet to confirm** to open your wallet. You can cancel at any point before that.

> **Low gas warning:** If your wallet balance does not appear to cover the estimated fee, a warning appears before you reach the confirmation panel.

---

## Approval vs Final Action

Some actions involve two distinct steps:

1. **Giving permission** — a contract is authorised to use a specific token and amount on your behalf. No funds move at this step.
2. **Final action** — the actual transfer, deposit, or execution happens.

Mintware distinguishes these steps clearly. Language like "Give permission to use tokens" means step 1. The follow-up confirmation — funding, depositing, or claiming — means step 2.

**Allowance pre-check:** Mintware checks whether the contract already has sufficient allowance before asking you to approve. If your wallet has already approved enough, the permission step is skipped automatically. You only see an approval prompt when one is actually needed.

---

## Campaign Funding

When funding a campaign as a sponsor, Mintware shows:

- whether an approval is needed or will be skipped
- a clear label: "Give permission to use tokens" (not "Approve token spend")
- a "What will happen" summary showing 1 step or 2 steps depending on your current allowance
- per-step context while the transaction is in-flight

---

## Claiming Rewards

Before a claim transaction is submitted:

- a context line shows what will arrive and where: `0.25 USDC on Base → your wallet`
- the button reflects the actual state: `Getting proof…` → `Check your wallet →` → `Waiting for confirmation…`

If you are on the wrong network for the claim, the app will prompt you to switch before the wallet opens.

---

## Vault Actions

Vault deposit and approval flows separate permission and deposit steps explicitly. The network the vault operates on is shown before any confirmation. A zero-first approval path is used for USDT-style tokens that reject a non-zero approval while one is already active.

---

## Why This Matters

Wallet prompts contain limited context. Mintware adds product-level explanations before the popup so you can:

- confirm you are interacting with the right network
- understand whether you are giving permission or transferring value
- see the full cost of the action (fees in fiat + native token)
- make the call quickly and confidently

The goal is that nothing in the wallet popup should surprise you.

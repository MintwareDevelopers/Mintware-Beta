# Social Liquidity Vaults

> **Status: Coming Soon — Phase 2**
>
> Social Vaults are built and in final testing on Base Sepolia. The nav tab is visible but locked. Public launch date TBC.

---

## What Are Social Vaults?

Social Liquidity Vaults are Uniswap V4 LP positions managed collectively through Mintware — but with one fundamental difference from standard LP: **your share of the fee pool is weighted by your Attribution score and referral network.**

Two wallets depositing the exact same amount earn different yields. The wallet with the stronger on-chain reputation earns more.

This creates a new kind of LP primitive: one where your DeFi history has direct economic value beyond your capital.

---

## How It Works

```
You deposit assets into a Social Vault
        ↓
The vault deploys your liquidity into a Uniswap V4 pool
        ↓
A Mintware hook captures dynamic fees + MEV on price deviation
        ↓
Fees accumulate in the FeeVault throughout the epoch
        ↓
Weekly epoch close — FeeVault distributes fees to depositors
        ↓
Your share = deposit × lock tier multiplier × Attribution multiplier × referral multiplier
        ↓
Claim your allocation on-chain
```

---

## Three Multipliers on Your Yield

### 1 — Lock Tier Multiplier
Committing your liquidity for longer earns a higher base multiplier. Early exits are penalised — the penalty is distributed back to remaining LPs.

| Lock Tier | Duration | Fee Multiplier |
|---|---|---|
| Flexible | No lock | 1.0× |
| Committed | 30 days | 1.25× |
| Loyal | 90 days | 1.5× |
| Dedicated | 180 days | 2.0× |

### 2 — Attribution Multiplier
Your Mintware Attribution score percentile determines an additional multiplier on top of your lock tier:

| Attribution Percentile | Additional Multiplier |
|---|---|
| 0–33% | 1.0× |
| 34–66% | 1.25× |
| 67–100% | 1.5× |

### 3 — Referral Multiplier
Your Sharing score — the depth and activity of your referral network — applies a further multiplier on your yield:

| Sharing Percentile | Additional Multiplier |
|---|---|
| 0–33% | 1.0× |
| 34–66% | 1.15× |
| 67–100% | 1.3× |

All three multipliers apply together. A dedicated depositor in the top Attribution and Sharing percentiles earns the maximum combined yield on their position.

---

## The Fee Engine

Fees are not just collected — they're actively captured. The Mintware V4 hook applies a dynamic fee that scales with price deviation from the previous block. When price moves significantly, a larger fee is captured. This is designed to capture value that would otherwise go to MEV bots exploiting LP positions.

The captured fees flow into the FeeVault, which holds them until epoch close and then distributes to depositors according to their weighted shares.

---

## Weekly Epoch Distribution

At the end of each weekly epoch:

1. The vault's total accumulated fees are tallied
2. Each depositor's weighted share is calculated (deposit × lock tier × Attribution × referral)
3. A Merkle distribution is built and signed by the Mintware oracle
4. Depositors can claim their allocation on-chain

The oracle signature model means Mintware never pays gas to publish distributions. Depositors pay their own claim gas.

---

## Rebalancing

Vault liquidity is concentrated within a tick range. When the price moves outside that range, the vault needs to rebalance. Mintware uses an AI Range Optimizer to propose new tick ranges based on on-chain price volatility data.

Rebalancing is **permissionless** — anyone can submit a valid oracle-signed range proposal to the vault contract. The contract verifies the oracle signature before executing. This avoids centralisation: Mintware can propose ranges, but so can any party with a valid signed proposal.

---

## Withdrawal

Withdrawals are subject to the lock tier you selected at deposit. Flexible depositors can withdraw at any time. Locked depositors who exit early pay a penalty — the penalty amount is immediately redistributed to remaining LPs in the same vault.

After a vault is closed, a cooldown period allows final claims before the creator can recover remaining funds.

---

## Smart Contracts (Base Sepolia — Testnet)

| Contract | Address | Role |
|---|---|---|
| SocialVault | `0xb9FB965Caa7197932b52631e0121Ea54586e2B88` | Manages LP deposits, liquidity position, withdrawals |
| FeeVault | `0x4Deb74E9D50Ebbf9bD883E0A2dcD0a1b4b9Db9BE` | Accumulates fees + MEV capture; distributes at epoch close |
| MWSocialHook | `0x8e7e05f5b6ed07acAa7Ac41D74a0d86a50AA8aC4` | Uniswap V4 hook — dynamic fees, MEV capture on price deviation |

Mainnet deployment is a separate step ahead of public launch.

> **Note:** No Mintware protocol fee is currently implemented. All fees collected flow entirely to depositors and referrers. A protocol fee will be added before mainnet launch.

---

## Why This Is Different from Standard LP

| | Standard Uniswap V4 LP | Mintware Social Vault |
|---|---|---|
| Yield source | Swap fees only | Swap fees + MEV capture |
| Yield distribution | Proportional to capital | Weighted by reputation + lock tier |
| Rebalancing | Manual or bot-driven | Oracle-signed, permissionless |
| Early exit | No penalty | Penalty redistributed to remaining LPs |
| Score benefit | None | Attribution + Sharing multipliers apply |

---

## Stay Updated

Social Vaults are coming in Phase 2. Follow the Mintware dashboard — the Vaults tab will unlock when the product launches publicly.

When vaults open publicly, Mintware plans to keep higher-trust actions like approvals, deposits, and seeded launches clearer by separating permission steps from final actions and by surfacing stronger pre-submission guidance.

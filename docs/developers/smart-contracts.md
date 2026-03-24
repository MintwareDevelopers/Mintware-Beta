# Smart Contracts

## MintwareDistributor

The MintwareDistributor contract handles campaign reward distribution. Participants call `claim()` with a Merkle proof and oracle signature to receive their allocation.

### Deployments

| Network | Address |
|---|---|
| Base Mainnet | `0x4Deb74E9D50Ebbf9bD883E0A2dcD0a1b4b9Db9BE` |

### Overview

The distributor uses a **zero-oracle-gas** model:

1. At epoch end, Mintware computes the distribution off-chain (who gets what)
2. A Merkle tree is built from the allocations
3. The oracle signs the Merkle root using EIP-712 — no on-chain transaction, no gas
4. Users submit `claim()` with their proof and the oracle signature
5. The contract verifies the signature and proof, then transfers tokens

This means Mintware never pays gas to publish distributions — all gas costs are paid by the claimer.

### Claim Function

```solidity
function claim(
    string calldata campaignId,
    uint256 epochNumber,
    bytes32 merkleRoot,
    bytes calldata oracleSignature,
    uint256 deadline,
    uint256 amount,
    bytes32[] calldata merkleProof
) external
```

| Parameter | Description |
|---|---|
| `campaignId` | Campaign identifier string |
| `epochNumber` | Epoch number (1-indexed) |
| `merkleRoot` | Root of the distribution Merkle tree |
| `oracleSignature` | EIP-712 signature from Mintware's oracle |
| `deadline` | Unix timestamp — claim must be submitted before this |
| `amount` | Your token allocation in wei |
| `merkleProof` | Merkle inclusion proof for your wallet + amount |

### Batch Claim

```solidity
function batchClaim(ClaimParams[] calldata claims) external
```

Claim multiple distributions in a single transaction.

### Security

- **Reentrancy guard** on all state-changing functions
- **Double-claim protection** — each `(campaignId, epochNumber, wallet)` combination can only be claimed once
- **Oracle signature expiry** — all distributions have a deadline; expired claims revert
- **Chain-specific signatures** — EIP-712 domain includes `chainId` and `verifyingContract`, preventing replay across chains

### Campaign Lifecycle

Campaigns follow a defined lifecycle enforced by the contract:

```
depositCampaign()   ← anyone; first depositor becomes the campaign creator
        ↓
  (campaign runs — epochs distributed, users claim)
        ↓
closeCampaign()     ← Mintware only — marks campaign as closed
        ↓
  (7-day withdrawal cooldown — users submit any remaining claims)
        ↓
withdrawCampaign()  ← campaign creator only — recovers remaining balance
```

**Emergency path:** If the contract is paused, `emergencyWithdraw()` allows recovery outside the normal lifecycle.

Key properties:
- `depositCampaign()` uses balance-diff accounting — safe for fee-on-transfer tokens
- Only Mintware (contract owner) can close campaigns
- Only the original creator (first depositor) can withdraw remaining funds after the cooldown
- `campaigns[id].closed` and `campaigns[id].closedAt` are set on close

### Oracle Rotation

The oracle signer key can be rotated with a 48-hour timelock:

```
proposeOracleSigner(newAddr)   ← onlyOwner
        ↓  (wait 48 hours)
confirmOracleSigner()          ← onlyOwner — activates new signer
```

`cancelOracleRotation()` can abort the rotation at any point before confirmation. This prevents an attacker who compromises the owner key from immediately replacing the oracle — they would need to hold control for 48 hours.

### Source Code

The contract source is available in the project repository under `contracts/MintwareDistributor.sol`.

---

## Phase 2 — Social Vault Contracts

> **Network: Base Sepolia (testnet).** Mainnet deployment is a separate step ahead of public launch.

Three contracts power the Social Vault system:

| Contract | Address (Base Sepolia) | Role |
|---|---|---|
| `SocialVault` | `0xb9FB965Caa7197932b52631e0121Ea54586e2B88` | Holds LP deposits, manages V4 liquidity position |
| `FeeVault` | `0x4Deb74E9D50Ebbf9bD883E0A2dcD0a1b4b9Db9BE` | Accumulates swap fees + MEV capture; distributes to LPs at epoch close |
| `MWSocialHook` | `0x8e7e05f5b6ed07acAa7Ac41D74a0d86a50AA8aC4` | Uniswap V4 hook — dynamic fees + MEV capture on price deviation |

### Fee Flow

```
Swap occurs in V4 pool
        ↓
MWSocialHook captures % of deviation → FeeVault
        ↓
Early exit penalties → FeeVault
        ↓
Epoch close (weekly) → FeeVault distributes to LPs
        weighted by: deposit × lock tier × Attribution score × referral multiplier
```

### Protocol Fee

> ⚠️ **No Mintware protocol fee is currently implemented.**
>
> All fees collected by FeeVault are distributed entirely to LPs and referrers. There is no treasury cut or platform percentage taken from vault activity at this time.
>
> A protocol fee (e.g. a % of FeeVault at epoch close routed to the Mintware treasury) is planned for a future contract upgrade before mainnet launch.

### Rebalancing

The AI Range Optimizer (T4.x) proposes new tick ranges based on Pyth price volatility data. Rebalancing is **permissionless** — anyone can submit a valid oracle-signed `RangeProposal` to `SocialVault.rebalanceWithProposal()`. The contract verifies the EIP-712 signature and nonce before executing.

The owner-only `rebalance()` function also exists for manual overrides.

### Source Code

Phase 2 contract sources are in `contracts-v4/src/` in the project repository.

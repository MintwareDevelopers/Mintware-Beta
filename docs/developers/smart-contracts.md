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

### Source Code

The contract source is available in the project repository under `contracts/MintwareDistributor.sol`.

# EAS Attestations

Mintware publishes offchain EAS (Ethereum Attestation Service) attestations on Base for key on-chain events. Attestations are cryptographically signed by Mintware's oracle and verifiable by anyone through the EAS network.

---

## What Is EAS?

EAS is a standard for making verifiable, structured claims about anything on-chain. An attestation is a signed statement: *"Mintware attests that wallet X has score Y as of date Z."*

Attestations are:
- **Offchain** — no gas cost to publish
- **Verifiable** — signed by Mintware's oracle; anyone can verify the signature
- **Portable** — any protocol integrating EAS can read and trust Mintware attestations

---

## Schemas

Mintware uses four attestation schemas on Base mainnet:

### AttributionScore
Records a wallet's Attribution score at a point in time.

**Schema UID:** `0x98ccb8e2d62e47da0ba7c87302670862a91f18dbbe4712045bf9d0e4176bbdbf`

**Fields:**
```
address wallet
uint256 score
string tier
uint8 percentile
uint32 attestedAt
```

---

### SwapActivity
Records a qualifying swap for campaign reward purposes.

**Schema UID:** `0x6dea22620c8ccce001d64dd6963aa35a7723b83e445c835753ad9d562bdfa5f8`

**Fields:**
```
address wallet
string campaignId
bytes32 txHash
uint256 amountUsd
uint32 swappedAt
```

---

### ReferralLink
Records a referral relationship between two wallets.

**Schema UID:** `0x1795148579c7dda67159f6e2a9cc601ed5d51373bb2328d0b766be3977d34901`

**Fields:**
```
address referrer
address referred
string refCode
uint32 linkedAt
```

---

### CampaignReward
Records a campaign reward payout to a wallet.

**Schema UID:** `0xa80e58af1ba7cfa989bca5952bd9f6ada08ecc955d180b3712292b6102bbe48a`

**Fields:**
```
address wallet
string campaignId
uint256 epochNumber
uint256 amountWei
string tokenSymbol
uint32 distributedAt
```

---

## Viewing Attestations

All Mintware attestations are viewable on [base.easscan.org](https://base.easscan.org). Search by wallet address or schema UID.

---

## Oracle

All Mintware attestations are signed by the Mintware oracle wallet:

```
0xc75D4b4bdB4D7ac103671f45E99D2FA6107B2e93
```

You can verify any attestation independently by checking the signer against this address.

---

## Integrating EAS Attestations

If you're building a protocol that wants to read Mintware Attribution scores or verify referral/reward history, you can query EAS attestations directly using the EAS SDK.

```typescript
import { EAS } from '@ethereum-attestation-service/eas-sdk'

const eas = new EAS('0x4200000000000000000000000000000000000021') // Base mainnet
eas.connect(provider)

// Fetch attestations for a wallet by schema
const attestations = await eas.getAttestations({
  schema: '0x98ccb8e2d62e47da0ba7c87302670862a91f18dbbe4712045bf9d0e4176bbdbf',
  recipient: walletAddress,
})
```

Contact the team if you're building an integration — we can provide additional support.

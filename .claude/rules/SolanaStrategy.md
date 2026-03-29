# Solana Strategy

## Key Insight

The Attribution API already scores Solana wallets. Jupiter appears in UV opportunities output.
The scoring backend is chain-agnostic across 100+ chains including Solana.
The data layer is done — the infrastructure layer needs work.

---

## What Already Works

- Attribution score for any Solana address (API handles it today)
- Referral system (address-based, chain-agnostic — `referral_records` just stores addresses)
- Campaign engine off-chain layer (Supabase, epoch state, activity table — all chain-agnostic)

---

## What Needs Building

### Easy — 1-2 weeks
**Solana wallet connection** — wagmi/RainbowKit is EVM-only. Add in parallel:
```
@solana/wallet-adapter-react
@solana/wallet-adapter-wallets  ← Phantom, Backpack, Solflare
```
Two wallet contexts side by side — one EVM (wagmi), one Solana (wallet-adapter).
Additive, not a replacement. Unlocks: score display, profile, referrals for Solana wallets.

### Medium — 3-5 weeks
**Points campaigns on Solana** — the off-chain campaign engine is fully chain-agnostic.
Solana swap txs verified on-chain, credited to same points/epoch system. No new contracts needed.
Unlocks: Jupiter, Raydium, Orca campaigns via existing infrastructure.

### Hard — 6-10 weeks
**Token reward distribution on Solana** — full rebuild of MintwareDistributor:
- Anchor program (Rust) — Solana's equivalent of Solidity
- SPL token interactions instead of ERC-20
- Different Merkle library (`@solana/spl-account-compression`)
- Ed25519 signing instead of EIP-712
Defer until Solana protocol partners are actively requesting it.

---

## The Strategic Position

**Not** "Mintware on Solana."

**Yes** — "Cross-chain identity bridge — link your EVM and Solana wallets into one Attribution score."

Most DeFi users have both. Their Solana trading history and Ethereum LP history are currently
invisible to each other. Mintware has data on both sides. A unified score across both chains
is something neither Solana-native nor EVM-native platforms can offer. That's a real moat.

---

## Identity Model — Unified Profile

One Mintware identity owns multiple wallet addresses. EVM address is primary (current auth session),
Solana wallet gets linked to it.

```
Profile: 0x46bb...42d7
├── EVM wallets:    [0x46bb...42d7 ✓ primary]
├── Solana wallets: [8xKp...mN3q  ✓ linked]
└── Combined Score: 247
    ├── EVM contribution:    103 pts
    └── Solana contribution: 144 pts
```

---

## Linking Flow — How It Works

Both wallets must sign. Only one new signature needed (EVM session is already authenticated).

```
1. User logged in via EVM wallet (already done)
2. User clicks "Link Solana Wallet" on profile page
3. Phantom/Backpack connects
4. Solana wallet signs:
   "Link wallet to Mintware: evm=0x46bb...42d7 ts=1743000000"
5. Server verifies:
   - Ed25519 signature valid
   - Message matches authenticated EVM address
   - Timestamp within 5 minutes (replay protection)
6. wallet_links row inserted, status = verified
```

Reverse (Solana-primary linking EVM) uses same flow — for Phase 4.

---

## Score Aggregation

**Do not simply add scores.** Two approaches:

**Option A — Signal pooling (long-term, best)**
Both addresses contribute their signals independently into the same buckets:
```
Volume signal:   EVM volume $12k  +  Solana volume $34k  → combined input
Trading signal:  EVM 24 pts       +  Solana 41 pts       → combined input
Holding signal:  max of both (can't hold same asset twice)
Sharing signal:  unified referral tree
```
Requires Attribution API to accept multiple addresses per query.

**Option B — Weighted max (Phase 1 ship, simpler)**
```
combined = max(evm_score, sol_score) + (min * 0.4)
```
Dominant chain carries the score, secondary chain boosts it.

**Ship Option B for Phase 2, evolve to Option A when API supports it.**

---

## Referral Tree — Unified Across Chains

The tree spans chains. Referring a Solana-only user still counts in your tree.
`referral_records` is already address-based and chain-agnostic — no schema change needed.

**ref_code edge case:** Current formula `"mw_" + address.slice(2,8)` strips `0x`.
For Solana (base58, no `0x`): `"mw_" + address.slice(0,6).toLowerCase()`.
Handle in `generateRefCode()` with chain detection.

---

## Auth Session Model

**Short term (Phase 1-3):** EVM primary, Solana linked. Session = EVM wallet.
All rewards, campaigns, claims under EVM address. Solana activity attributed via link.

**Long term (Phase 4+):** Either wallet can be primary. Abstract current `useAccount()` into:
```ts
// today
const { address } = useAccount()  // EVM only

// future
const { address, chain, linkedWallets } = useMintwareIdentity()
// returns primary wallet address regardless of chain
```

**The Solana-native user problem:** Users with only Phantom and zero EVM history can't use
Mintware today. That's a large segment. Phase 1 fix: allow Solana-as-primary for read-only
access (score, referrals). Phase 4 fix: full Solana-primary auth.

---

## Database Schema

```sql
CREATE TABLE wallet_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_address text NOT NULL,   -- EVM address (0x...)
  linked_address  text NOT NULL,   -- Solana address (base58)
  linked_chain    text NOT NULL,   -- 'solana' | future chains
  link_signature  text NOT NULL,   -- Ed25519 sig from linked wallet
  link_message    text NOT NULL,   -- signed message for audit
  verified_at     timestamptz DEFAULT now(),
  status          text DEFAULT 'verified',
  UNIQUE(primary_address, linked_address)
);

-- For Solana-primary users (Phase 4)
ALTER TABLE wallet_profiles ADD COLUMN chain text DEFAULT 'evm';
```

---

## Phased Roadmap

| Phase | Work | Time | Unlocks |
|---|---|---|---|
| 1 | Solana wallet connect + score read + referrals | 1-2 weeks | Solana users on platform |
| 2 | Linking flow UI — connect both, sign once, unified profile | 2-3 weeks | Cross-chain identity |
| 3 | Score aggregation Option B (weighted max) | 1 week | Combined Attribution score |
| 4 | Solana-as-primary auth (`useMintwareIdentity`) | 2-3 weeks | Solana-native users |
| 5 | Points campaigns on Solana, unified referral tree | 3-4 weeks | Jupiter/Raydium/Orca campaigns |
| 6 | Signal pooling Option A (requires API update) | 2-3 weeks | True unified score |
| 7 | Anchor distribution program, full claims on Solana | 6-10 weeks | Token rewards on Solana |

---

## Protocol Targets

- **Jupiter** — already in Attribution UV opportunities, biggest Solana DEX
- **Raydium** — AMM, large LP base
- **Orca** — concentrated liquidity, quality user base
- **Marinade** — liquid staking, governance-heavy (high Attribution scores)
- **Backpack** — wallet + exchange, natural Base-Solana bridge audience

---

## Solana RPC

Use **Helius** — best enhanced APIs for parsed transaction history on Solana.
Likely a new Cloudflare Worker (`solana-scorer.workers.dev`) mirroring existing attribution worker.
Verify Solana swaps via: `getTransaction` → check program ID against known DEX program IDs
(Jupiter aggregator: `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`).

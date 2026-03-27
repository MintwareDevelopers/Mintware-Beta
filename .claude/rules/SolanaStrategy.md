# Solana Strategy

## Key Insight

The Attribution API already scores Solana wallets. Jupiter appears in UV opportunities output.
The scoring backend is chain-agnostic across 100+ chains including Solana.
The data layer is done — the infrastructure layer needs work.

## What Already Works

- Attribution score for any Solana address (API handles it today)
- Referral system (address-based, chain-agnostic)
- Campaign engine off-chain layer (Supabase, epoch state, activity table — all chain-agnostic)

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

## The Strategic Position

**Not** "Mintware on Solana."

**Yes** — "Cross-chain identity bridge — link your EVM and Solana wallets into one Attribution score."

Most DeFi users have both. Their Solana trading history and Ethereum LP history are currently
invisible to each other. Mintware has data on both sides. A unified score across both chains
is something neither Solana-native nor EVM-native platforms can offer. That's a real moat.

## Phased Roadmap

| Phase | Work | Time | Unlocks |
|---|---|---|---|
| 1 | Solana wallet connect + score read | 1-2 weeks | Solana users see score, use referrals |
| 2 | Points campaigns on Solana | 3-4 weeks | Jupiter/Raydium/Orca campaigns |
| 3 | Cross-chain identity link | 2-3 weeks | One score combining EVM + Solana wallets |
| 4 | Solana token distribution (Anchor program) | 6-10 weeks | Full reward claims on Solana |

Phases 1-3 reuse almost all existing infrastructure.
Phase 4 is a separate engineering project — only build when protocol partners pull for it.

## Protocol Targets

- **Jupiter** — already in Attribution UV opportunities, biggest Solana DEX
- **Raydium** — AMM, large LP base
- **Orca** — concentrated liquidity, quality user base
- **Marinade** — liquid staking, governance-heavy users (high Attribution scores)
- **Backpack** — wallet + exchange, Base-Solana bridge audience

## Open Questions

- [ ] How do we handle one user having both an EVM and Solana wallet — same profile or linked?
- [ ] Does cross-chain linking require a signature from both wallets, or just opt-in?
- [ ] Should Solana swap verification go through a dedicated RPC or reuse existing worker?
- [ ] Sharing score / referral tree — does it span chains or stay chain-specific?

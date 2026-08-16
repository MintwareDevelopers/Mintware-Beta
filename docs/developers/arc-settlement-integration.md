# Arc Settlement Integration — YPN on Circle's Arc

> **Status: foundation SHIPPED (2026-08-16); Arc-native deploy + Circle-rail integrations gated on Arc
> testnet access.** This is the canonical map for putting YPN's spend side on Arc. The earn side (Uniswap-v4
> ETH pools) stays on Base; Arc is the USDC settlement + card layer; CCTP bridges them.

## ✅ LIVE on Arc testnet (2026-08-16)

The YPN spend stack is **deployed and verified on Arc testnet** (chain 5042002), running on **real Arc USDC**
+ **real CCTP** contracts. A deposit→earn smoke passed on-chain: 5 USDC flowed deployer → vault → adapter →
yield source, shares minted, funds idling. Explorer: `https://testnet.arcscan.app/address/<addr>`.

| Contract | Address |
|---|---|
| MintwareYieldVault | `0x11Ef2c7D84b755f02f3652ca8b16e6E81A96C421` |
| MintwarePaymentGateway | `0x1D075cB38f5c126D9c23f1f91faC0A9C8d135399` |
| MintwareERC4626YieldAdapter | `0xb9FB965Caa7197932b52631e0121Ea54586e2B88` |
| MintwareCctpDepositRouter | `0xDB9DB7008cfFb09bD1D943C237f57327383DFc03` |
| Yield source (mock 4626, placeholder) | `0x4Deb74E9D50Ebbf9bD883E0A2dcD0a1b4b9Db9BE` |
| USDC (real Arc testnet) | `0x3600000000000000000000000000000000000000` |
| CCTP MessageTransmitter (real) | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

Wiring verified on-chain: vault↔adapter↔gateway↔router all cross-reference; vault.usdc = real Arc USDC. The
only placeholder is the yield source (swap in Arc's real primitive when it's live). **Learned:** on Arc the
native gas balance and the ERC-20 USDC are the SAME unified balance (USDC *is* the gas token).

## The topology — one clean separation

```
     BASE / mainnet  (Uniswap v4)                       ARC  (Circle rails)
  ┌───────────────────────────────┐                ┌──────────────────────────────┐
  │ EARN side                     │                │ SPEND side                   │
  │  · ETH-collateral + pair vaults│                │  · MintwareYieldVault (USDC) │
  │  · v4 JIT hook + MEV capture   │── CCTP (USDC) ─▶│  · MintwarePaymentGateway    │
  │  · batchSettleEth (ETH→USDC)   │                │    settleSpend → burnForPayment│
  │  · Aave idle buffer            │                │  · USDC gas (Paymaster)      │
  │  "where USDC earns"            │◀── CCTP ───────│  · card off-ramp → CPN        │
  └───────────────────────────────┘                └──────────────────────────────┘
```

**Why the split:** the earn side needs Uniswap v4 + deep ETH liquidity, which live on Base. The spend side
is USDC-only (no pool) and belongs where USDC is the gas token and settlement is sub-second — Arc. CCTP
(native burn-mint) is the connective tissue, no wrapped-asset risk.

## Per-contract mapping — stays on Base vs. moves to Arc

| Contract | Home | Why |
|---|---|---|
| `MintwareDeFiPairVault`, JIT hook, MEV engine | **Base** | Need a v4 PoolManager + ETH depth |
| `MintwareEthSettlement` (`batchSettleEth`) | **Base** | It IS a v4 swap (ETH→USDC) |
| `AaveV3YieldAdapter` | **Base** | Aave's Base deployment |
| `MintwareYieldVault` (single-asset USDC) | **Arc** ✅ portable | No pool — pure USDC |
| `MintwarePaymentGateway` (`settleSpend`) | **Arc** ✅ portable | No pool — verifies permit + edge sig, pays USDC |
| **`MintwareERC4626YieldAdapter`** (this work) | **Arc** ✅ built | Arc's yield primitive slots in as the 4626 source |
| `services/edge-auth`, `services/relayer` | chain-agnostic | Point `EDGE_CHAIN_ID` / RPC at Arc |

Nothing is rewritten: the contracts are chain-agnostic (EIP-712 domain reads `block.chainid`), and yield is
a pluggable `IYieldAdapter` — Base uses the Aave adapter, Arc uses the 4626 adapter, same interface.

## What's SHIPPED now (this work, testable today)

- **`MintwareERC4626YieldAdapter`** (`contracts-v4/src/vaults/`) — the Arc yield seam. Wraps ANY ERC-4626
  source (Arc's native USDC-yield primitive, or a Circle reserve/T-bill product) behind the exact
  `IYieldAdapter` the vault already idles into. Mirrors the Aave adapter's safety: `onlyVault`, one-time
  `setVault`, **best-effort never-reverting withdraw**, per-block drain cap, constructor asset-match guard.
  **9 Forge tests green** (supply/withdraw round-trip · yield accrual · stalled-source best-effort · per-block
  cap · access + wiring guards).
- **`DeployArcSpendStack.s.sol`** — deploys the whole spend stack (USDC → 4626 source → adapter → vault →
  Gateway, fully wired). Parameterized: real Arc `ARC_USDC` / `ARC_YIELD_SOURCE` / `ARC_CPN_TREASURY` if set,
  else mocks. **Dry-runs clean today**; broadcasts to Arc the moment there's an RPC.
- **`MintwareCctpDepositRouter`** (`contracts-v4/src/payments/`) — Arc-side **bridge-and-deposit**: completes
  a Circle CCTP transfer (USDC burned on Base) via `MessageTransmitter.receiveMessage` and, in the same tx,
  deposits the minted USDC into the vault crediting the user. Relayer-gated (safe recipient binding — see the
  contract NatSpec; a permissionless CCTP-v2-hookData variant can follow). Balance-diff accounting. **6 Forge
  tests green** against the REAL spend stack (router → vault → 4626 adapter → yield source).
- **`config/arc.ts`** — the Arc settlement config home: chain id `5042002`, env-driven addresses (incl. CCTP),
  `CCTP_DOMAIN`, `isArcConfigured()` fail-safe gate, and the `EDGE_CHAIN_ID=5042002` wiring note.

## Gas in USDC on Arc — already native (no paymaster code needed)

On Arc, **USDC is the gas token**, so the relayer's existing EIP-1559 submit path pays gas in USDC *natively*
— no Circle Paymaster integration is required for settlement on Arc. The only thing to confirm with Circle is
Arc's **fee model**: if Arc is EIP-1559-compatible, `services/relayer/src/submit.rs` works unchanged; if Arc
uses a non-1559 fee mechanism, the relayer needs a tx-type tweak. (Circle Paymaster / ERC-4337 is a separate,
user-facing *gasless-UX-on-non-Arc-chains* concern — not on the Arc settlement critical path.)

## Arc testnet is PUBLIC + live — verified on-chain (2026-08)

Almost none of this needs a Circle relationship; it's public developer infra. Verified live via `cast`:
chain `5042002`, RPC `https://rpc.testnet.arc.io` responding (block ~57.3M), and real bytecode at the USDC
+ both CCTP contracts. All wired into `config/arc.ts` + `foundry.toml` (`--rpc-url arc`) + the deploy script.

| Value | Public address / setting | Status |
|---|---|---|
| RPC / chain id | `https://rpc.testnet.arc.io` / `5042002` | ✅ verified live |
| Faucet / explorer | `faucet.circle.com` / `testnet.arcscan.app` | ✅ public |
| USDC | `0x3600000000000000000000000000000000000000` | ✅ verified (real bytecode) |
| CCTP domain | `26` | ✅ public |
| CCTP MessageTransmitter v2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | ✅ verified (real bytecode) |
| CCTP TokenMessenger v2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | ✅ verified (real bytecode) |

The deploy script auto-uses the real Arc USDC + CCTP MessageTransmitter when broadcasting to Arc.

## What actually remains

| Piece | Blocker | Who |
|---|---|---|
| **Broadcast the spend stack to Arc** | Fund the deployer via the **public** `faucet.circle.com` (testnet USDC for gas) | trivial — public faucet |
| **The real yield source** | Confirm Arc's native USDC-yield 4626 (or wrap a Circle reserve product) | public lookup / Circle |
| **Relayer fee model** | Arc is EVM + <1s finality; confirm EIP-1559 vs. a fee variant | public docs |
| **CPN card off-ramp** | `cpnTreasury` → Visa/MC settlement | **genuinely Circle** — the card partnership + issuer |
| **The grant** | — | **Circle relationship** |

Net: the **only genuinely relationship-gated items are the CPN card off-ramp and the grant**. Everything else
is public and wired; deploying to Arc testnet is one funded `forge script` away.

## Deploy sequence (when Arc testnet is up)

1. Set `ARC_RPC_URL`, `ARC_USDC`, `ARC_YIELD_SOURCE`, `ARC_CPN_TREASURY`.
2. `forge script DeployArcSpendStack.s.sol --rpc-url arc --broadcast --slow` → gateway + vault addresses.
3. Grant `RELAYER_ROLE` + `EDGE_SIGNER_ROLE` on the Gateway to the operational keys.
4. Point the edge at Arc: `EDGE_CHAIN_ID=5042002`, `EDGE_GATEWAY_ADDRESS`, `EDGE_VAULT_ADDRESS`; relayer RPC → Arc.
5. Add the CCTP deposit adapter + (optionally) Paymaster sponsorship.
6. Smoke: deposit USDC → confirm yield accrues → authorize via edge → `settleSpend` via relayer → USDC to CPN.

## Open questions for Circle

- [ ] Arc's native USDC-yield primitive — is it a 4626, or do we wrap a Circle reserve/T-bill product?
- [ ] CCTP contract addresses + finality on Arc for the deposit path.
- [ ] Paymaster: sponsored (relayer pays) vs. user-pays-in-USDC — and the Arc Paymaster interface.
- [ ] CPN: settlement interface for the card off-ramp + the issuing relationship (Rain vs. a Circle-blessed issuer).
- [ ] Is Uniswap v4 (or equivalent depth) on Arc? If yes, some USDC-pair earn could also run on Arc; ETH depth still favors Base.

## Related
`config/arc.ts` · `contracts-v4/src/vaults/MintwareERC4626YieldAdapter.sol` ·
`contracts-v4/script/DeployArcSpendStack.s.sol` · `docs/developers/eth-settlement-swap-spec.md` (the Base
earn-side settlement swap that feeds USDC into this) · `docs/developers/ypn-v1-foundation-spec.md` (the
chain-agnostic settlement foundation) · `docs/product/framing-and-messaging.md` (the settlement stack).
